const fs = require('fs/promises');
const path = require('path');

const FILE_NAME = 'live-support-messages.json';
const ADMIN_API_KEY = 'gocmen1993';
const DEFAULT_NOTIFY_EMAIL = 'zeynelturkoglu@hotmail.com';
let resolvedDataFilePath = '';

function getDataDirectoryCandidates() {
  const customDir = String(process.env.LIVE_SUPPORT_DATA_DIR || process.env.DATA_DIR || '').trim();
  const cwd = process.cwd();
  const list = [
    customDir,
    path.join(cwd, 'server', 'data'),
    path.join(cwd, 'data'),
    path.join('/tmp', 'gocmenperde-data'),
  ].filter(Boolean);
  return Array.from(new Set(list));
}

async function resolveWritableDataFilePath() {
  if (resolvedDataFilePath) return resolvedDataFilePath;
  const candidates = getDataDirectoryCandidates();
  for (const dir of candidates) {
    try {
      await fs.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, FILE_NAME);
      resolvedDataFilePath = filePath;
      return filePath;
    } catch (_) {
      // Bir sonraki adayı dene
    }
  }
  throw new Error('Canlı destek verisi için yazılabilir dizin bulunamadı');
}

async function resolveReadableDataFilePath() {
  const writablePath = await resolveWritableDataFilePath();
  const candidates = [writablePath, ...getDataDirectoryCandidates().map((dir) => path.join(dir, FILE_NAME))];
  for (const filePath of candidates) {
    try {
      await fs.access(filePath);
      return filePath;
    } catch (_) {
      // Dosya yoksa sıradaki adaya geç
    }
  }
  return writablePath;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.length >= 10 && digits.length <= 13) return digits;
  return '';
}

function ensureText(value, maxLength = 500) {
  const text = String(value || '').trim();
  return text.slice(0, maxLength);
}

async function readItems() {
  try {
    const filePath = await resolveReadableDataFilePath();
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

async function writeItems(items) {
  const filePath = await resolveWritableDataFilePath();
  await fs.writeFile(filePath, JSON.stringify(items, null, 2), 'utf8');
}

function resolveFromAddress() {
  const configuredFrom = String(process.env.ORDER_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || '').trim();
  const fallbackFrom = 'Göçmen Perde <noreply@gocmenperde.com.tr>';
  const from = configuredFrom || fallbackFrom;
  const emailMatch = from.match(/<?([^<>\s]+@[^<>\s]+)>?$/);
  const email = emailMatch ? emailMatch[1].toLowerCase() : '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return from;
}

async function sendTransactionalEmail({ to, subject, html }) {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const from = resolveFromAddress();
  if (!apiKey || !from) {
    return { ok: false, skipped: true, reason: 'mail_config_missing' };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return { ok: false, skipped: false, error: `${response.status}: ${body.slice(0, 220)}` };
    }

    return { ok: true, skipped: false };
  } catch (err) {
    return { ok: false, skipped: false, error: err.message || 'mail_error' };
  }
}

function buildAdminNotifyTemplate(item) {
  return `
  <div style="font-family:Inter,Segoe UI,Arial,sans-serif;background:#f4f6fb;padding:24px">
    <div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:16px;border:1px solid #e6e9f2;overflow:hidden;box-shadow:0 16px 34px rgba(20,38,80,.08)">
      <div style="padding:20px 24px;background:linear-gradient(135deg,#0f172a,#1f2a44);color:#fff">
        <div style="font-size:12px;letter-spacing:1.4px;text-transform:uppercase;opacity:.78">Canlı Destek Hattı</div>
        <h2 style="margin:8px 0 0;font-size:23px">Yeni müşteri mesajı geldi</h2>
      </div>
      <div style="padding:22px 24px;color:#1f2937;line-height:1.65;font-size:14px">
        <p style="margin:0 0 12px"><b>Talep No:</b> ${escapeHtml(item.ticketNo)}</p>
        <p style="margin:0 0 8px"><b>Ad Soyad:</b> ${escapeHtml(item.fullName)}</p>
        <p style="margin:0 0 8px"><b>Telefon:</b> ${escapeHtml(item.phone)}</p>
        <p style="margin:0 0 16px"><b>E-posta:</b> ${escapeHtml(item.email)}</p>
        <div style="padding:14px;border-radius:12px;background:#f8fafc;border:1px solid #e5e7eb;white-space:pre-wrap">${escapeHtml(item.message)}</div>
      </div>
    </div>
  </div>`;
}

function buildCustomerReplyTemplate({ item, subject, message }) {
  return `
  <div style="font-family:Inter,Segoe UI,Arial,sans-serif;background:#eef2ff;padding:24px">
    <div style="max-width:700px;margin:0 auto;background:#fff;border:1px solid #dbe3ff;border-radius:18px;overflow:hidden;box-shadow:0 20px 36px rgba(38,52,90,.12)">
      <div style="padding:24px;background:linear-gradient(130deg,#111827,#1e3a8a);color:#fff">
        <div style="font-size:12px;letter-spacing:1.2px;text-transform:uppercase;opacity:.8">Göçmen Perde · Canlı Destek</div>
        <h2 style="margin:8px 0 0;font-size:24px">${escapeHtml(subject)}</h2>
      </div>
      <div style="padding:24px;color:#1f2937;line-height:1.75;font-size:15px">
        <p style="margin-top:0">Merhaba ${escapeHtml(item.fullName)},</p>
        <div style="padding:14px 16px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;white-space:pre-wrap">${escapeHtml(message)}</div>
        <div style="margin-top:18px;padding-top:12px;border-top:1px dashed #d1d5db;font-size:13px;color:#6b7280">
          Talep No: <b>${escapeHtml(item.ticketNo)}</b>
        </div>
      </div>
    </div>
  </div>`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      if (req.headers['x-admin-key'] !== ADMIN_API_KEY) {
        return res.status(403).json({ error: 'Yetkisiz.' });
      }
      const items = await readItems();
      items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return res.status(200).json({ success: true, items });
    }

    if (req.method === 'POST') {
      const action = String(req.body?.action || '').trim();

      if (action === 'create') {
        const firstName = ensureText(req.body?.firstName, 60);
        const lastName = ensureText(req.body?.lastName, 60);
        const fullName = `${firstName} ${lastName}`.trim();
        const phone = normalizePhone(req.body?.phone);
        const email = normalizeEmail(req.body?.email);
        const message = ensureText(req.body?.message, 2500);
        const channel = ensureText(req.body?.channel || 'live-support', 40);

        if (!firstName || !lastName || !phone || !email || message.length < 10) {
          return res.status(400).json({ error: 'Ad, soyad, telefon, e-posta ve en az 10 karakter mesaj zorunludur.' });
        }

        const now = new Date();
        const items = await readItems();
        const nextId = items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
        const ticketNo = `DS-${now.getFullYear()}-${String(nextId).padStart(5, '0')}`;

        const item = {
          id: nextId,
          ticketNo,
          firstName,
          lastName,
          fullName,
          phone,
          email,
          message,
          channel,
          status: 'new',
          createdAt: now.toISOString(),
          repliedAt: null,
          replySubject: '',
          replyMessage: '',
        };

        items.unshift(item);
        await writeItems(items);

        const notifyEmail = String(process.env.LIVE_SUPPORT_NOTIFY_EMAIL || process.env.ORDER_NOTIFY_EMAIL || DEFAULT_NOTIFY_EMAIL).trim();
        const mailResult = await sendTransactionalEmail({
          to: notifyEmail,
          subject: `Yeni canlı destek talebi · ${ticketNo}`,
          html: buildAdminNotifyTemplate(item),
        });

        return res.status(201).json({
          success: true,
          ticketNo,
          mailSent: Boolean(mailResult.ok),
        });
      }

      if (action === 'reply') {
        if (req.headers['x-admin-key'] !== ADMIN_API_KEY) {
          return res.status(403).json({ error: 'Yetkisiz.' });
        }

        const id = Number(req.body?.id);
        const subject = ensureText(req.body?.subject, 140);
        const replyMessage = ensureText(req.body?.replyMessage, 4000);
        if (!Number.isInteger(id) || id <= 0 || !subject || replyMessage.length < 5) {
          return res.status(400).json({ error: 'Geçersiz yanıt verisi.' });
        }

        const items = await readItems();
        const item = items.find((entry) => Number(entry.id) === id);
        if (!item) return res.status(404).json({ error: 'Talep bulunamadı.' });

        const mailResult = await sendTransactionalEmail({
          to: item.email,
          subject,
          html: buildCustomerReplyTemplate({ item, subject, message: replyMessage }),
        });

        item.status = mailResult.ok ? 'replied' : 'reply_pending_mail';
        item.repliedAt = new Date().toISOString();
        item.replySubject = subject;
        item.replyMessage = replyMessage;

        await writeItems(items);

        return res.status(200).json({ success: true, mailSent: Boolean(mailResult.ok), item });
      }

      return res.status(400).json({ error: 'Geçersiz action.' });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('live-support error:', err.message);
    return res.status(500).json({ error: 'Sunucu hatası: ' + err.message });
  }
};
