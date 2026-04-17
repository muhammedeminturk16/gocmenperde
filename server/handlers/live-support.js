const fs = require('fs/promises');
const path = require('path');
const { pool } = require('../lib/_db');

const FILE_NAME = 'live-support-messages.json';
const ADMIN_API_KEY = 'gocmen1993';
const DEFAULT_NOTIFY_EMAIL = 'muhammedeminturk.16@gmail.com';
const FALLBACK_RESEND_API_KEY = 're_c4EEGk7p_KvYLe2RR19gjuBkyd354v1Td';
let resolvedDataFilePath = '';
let dbSchemaReady = false;

function isDbEnabled() {
  return Boolean(String(process.env.DATABASE_URL || '').trim());
}

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
  if (digits.length === 10) return `0${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return digits;
  return '';
}

function ensureText(value, maxLength = 500) {
  const text = String(value || '').trim();
  return text.slice(0, maxLength);
}

function mapRowToItem(row = {}) {
  return {
    id: Number(row.id) || 0,
    ticketNo: String(row.ticket_no || ''),
    firstName: String(row.first_name || ''),
    lastName: String(row.last_name || ''),
    fullName: String(row.full_name || ''),
    phone: String(row.phone || ''),
    email: String(row.email || ''),
    message: String(row.message || ''),
    channel: String(row.channel || 'live-support'),
    status: String(row.status || 'new'),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    repliedAt: row.replied_at ? new Date(row.replied_at).toISOString() : null,
    replySubject: String(row.reply_subject || ''),
    replyMessage: String(row.reply_message || ''),
  };
}

async function ensureDbSchema() {
  if (dbSchemaReady || !isDbEnabled()) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS live_support_messages (
      id SERIAL PRIMARY KEY,
      ticket_no TEXT NOT NULL UNIQUE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      message TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'live-support',
      status TEXT NOT NULL DEFAULT 'new',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      replied_at TIMESTAMPTZ,
      reply_subject TEXT NOT NULL DEFAULT '',
      reply_message TEXT NOT NULL DEFAULT ''
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_live_support_created_at ON live_support_messages (created_at DESC)');
  dbSchemaReady = true;
}

async function readItems() {
  if (isDbEnabled()) {
    try {
      await ensureDbSchema();
      const result = await pool.query(`
        SELECT id, ticket_no, first_name, last_name, full_name, phone, email, message, channel, status, created_at, replied_at, reply_subject, reply_message
        FROM live_support_messages
        ORDER BY created_at DESC, id DESC
      `);
      return result.rows.map(mapRowToItem);
    } catch (err) {
      console.error('live-support db read fallback:', err.message);
    }
  }
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

function normalizeRecipients(to) {
  const list = Array.isArray(to) ? to : [to];
  const clean = list
    .map((item) => normalizeEmail(item))
    .filter(Boolean);
  return Array.from(new Set(clean));
}

async function sendTransactionalEmail({ to, subject, html }) {
  const apiKey = String(process.env.RESEND_API_KEY || FALLBACK_RESEND_API_KEY || '').trim();
  const from = resolveFromAddress();
  const recipients = normalizeRecipients(to);
  if (!apiKey) {
    return { ok: false, skipped: true, reason: 'missing_api_key' };
  }
  if (!from) {
    return { ok: false, skipped: true, reason: 'invalid_from_address' };
  }
  if (!recipients.length) {
    return { ok: false, skipped: true, reason: 'missing_recipient' };
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
        to: recipients,
        subject,
        html,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return { ok: false, skipped: false, reason: 'provider_error', error: `${response.status}: ${body.slice(0, 220)}` };
    }

    return { ok: true, skipped: false };
  } catch (err) {
    return { ok: false, skipped: false, reason: 'mail_error', error: err.message || 'mail_error' };
  }
}

function buildAdminNotifyTemplate(item) {
  return `
  <div style="font-family:Inter,Segoe UI,Arial,sans-serif;background:#eff3fb;padding:28px 14px">
    <div style="max-width:720px;margin:0 auto;background:#ffffff;border-radius:20px;border:1px solid #dde5f5;overflow:hidden;box-shadow:0 24px 55px rgba(15,23,42,.12)">
      <div style="padding:24px 26px;background:radial-gradient(circle at 85% 5%,rgba(201,168,76,.24),transparent 45%),linear-gradient(140deg,#0f172a,#1e293b 58%,#19253e);color:#fff">
        <div style="display:inline-block;font-size:11px;letter-spacing:1.6px;text-transform:uppercase;padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.06)">Canlı Destek · Yeni Talep</div>
        <h2 style="margin:12px 0 0;font-size:25px;line-height:1.25">Yeni müşteri mesajı geldi</h2>
        <p style="margin:8px 0 0;color:rgba(255,255,255,.82);font-size:14px">Hızlı aksiyon için detaylar aşağıdadır.</p>
      </div>
      <div style="padding:24px 26px;color:#0f172a;line-height:1.7;font-size:14px">
        <table role="presentation" style="width:100%;border-collapse:separate;border-spacing:0 8px">
          <tr><td style="width:140px;color:#64748b;font-weight:600">Talep No</td><td style="font-weight:700;color:#0f172a">${escapeHtml(item.ticketNo)}</td></tr>
          <tr><td style="color:#64748b;font-weight:600">Ad Soyad</td><td>${escapeHtml(item.fullName)}</td></tr>
          <tr><td style="color:#64748b;font-weight:600">Telefon</td><td>${escapeHtml(item.phone)}</td></tr>
          <tr><td style="color:#64748b;font-weight:600">E-posta</td><td><a href="mailto:${escapeHtml(item.email)}" style="color:#1d4ed8;text-decoration:none">${escapeHtml(item.email)}</a></td></tr>
        </table>
        <div style="margin-top:16px;padding:16px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;white-space:pre-wrap;color:#1e293b;font-size:14px">${escapeHtml(item.message)}</div>
      </div>
    </div>
  </div>`;
}

function buildCustomerReplyTemplate({ item, subject, message }) {
  return `
  <div style="font-family:Inter,Segoe UI,Arial,sans-serif;background:linear-gradient(180deg,#edf2ff 0%,#f8fafd 100%);padding:30px 14px">
    <div style="max-width:720px;margin:0 auto;background:#ffffff;border:1px solid #d8e2ff;border-radius:24px;overflow:hidden;box-shadow:0 20px 54px rgba(34,58,124,.14)">
      <div style="padding:28px 26px 26px;background:radial-gradient(circle at 18% 22%,rgba(255,255,255,.32),transparent 34%),radial-gradient(circle at 78% 35%,rgba(255,255,255,.22),transparent 42%),linear-gradient(132deg,#10213f 0%,#1f3f84 52%,#325cc2 100%);color:#fff">
        <table role="presentation" style="border-collapse:collapse;margin:0 0 14px">
          <tr>
            <td style="vertical-align:middle">
              <div style="width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.22);border:1px solid rgba(255,255,255,.48);text-align:center;line-height:44px;font-size:15px;font-weight:800;letter-spacing:.4px">GP</div>
            </td>
            <td style="padding-left:10px;vertical-align:middle">
              <div style="font-size:15px;font-weight:700;line-height:1.2">Göçmen Perde</div>
              <div style="font-size:11px;opacity:.9;letter-spacing:1.2px;text-transform:uppercase">Canlı Destek Ekibi</div>
            </td>
          </tr>
        </table>
        <div style="display:inline-block;font-size:11px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;padding:7px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.12)">Yanıtınız Hazır</div>
        <h2 style="margin:12px 0 0;font-size:26px;line-height:1.34;color:#ffffff !important;text-shadow:0 1px 1px rgba(0,0,0,.12)">${escapeHtml(subject)}</h2>
      </div>
      <div style="padding:26px 26px 28px;color:#0b1220 !important;line-height:1.78;font-size:15px;background:#f8fbff">
        <p style="margin:0 0 12px;color:#0f172a !important">Merhaba <b>${escapeHtml(item.fullName)}</b>,</p>
        <p style="margin:0 0 14px;color:#1e293b !important">Talebiniz için teşekkür ederiz. Ekibimizin yanıtı aşağıda yer alıyor:</p>
        <div style="padding:16px;border-radius:16px;background:#ffffff;border:1px solid #cfdcf9;box-shadow:inset 0 0 0 1px rgba(255,255,255,.8);white-space:pre-wrap;color:#0b1220 !important;font-size:16px;line-height:1.7">${escapeHtml(message)}</div>
        <div style="margin-top:18px;padding:14px 16px;border-radius:14px;background:#ecf3ff;border:1px dashed #9cb8f7;font-size:13px;color:#1f2a44 !important">
          Talep No: <b style="color:#0f172a;font-size:15px">${escapeHtml(item.ticketNo)}</b>
        </div>
        <div style="margin-top:14px;font-size:12px;color:#334155 !important">
          Bu e-posta otomatik bilgilendirme amaçlı gönderilmiştir.
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
        let item;
        if (isDbEnabled()) {
          try {
            await ensureDbSchema();
            const sequenceResult = await pool.query(
              `SELECT nextval(pg_get_serial_sequence('live_support_messages', 'id')) AS id`
            );
            const nextId = Number(sequenceResult.rows[0]?.id || 0);
            const ticketNo = `DS-${now.getFullYear()}-${String(nextId).padStart(5, '0')}`;
            const insertResult = await pool.query(
              `INSERT INTO live_support_messages
                (id, ticket_no, first_name, last_name, full_name, phone, email, message, channel, status, created_at, replied_at, reply_subject, reply_message)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new', $10, NULL, '', '')
               RETURNING id, ticket_no, first_name, last_name, full_name, phone, email, message, channel, status, created_at, replied_at, reply_subject, reply_message`,
              [nextId, ticketNo, firstName, lastName, fullName, phone, email, message, channel, now.toISOString()]
            );
            item = mapRowToItem(insertResult.rows[0]);
          } catch (err) {
            console.error('live-support db create fallback:', err.message);
          }
        }

        if (!item) {
          const items = await readItems();
          const nextId = items.reduce((max, entry) => Math.max(max, Number(entry.id) || 0), 0) + 1;
          const ticketNo = `DS-${now.getFullYear()}-${String(nextId).padStart(5, '0')}`;
          item = {
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
        }

        const notifyEmail = String(process.env.LIVE_SUPPORT_NOTIFY_EMAIL || process.env.ORDER_NOTIFY_EMAIL || DEFAULT_NOTIFY_EMAIL).trim();
        const mailResult = await sendTransactionalEmail({
          to: notifyEmail,
          subject: `Yeni canlı destek talebi · ${item.ticketNo}`,
          html: buildAdminNotifyTemplate(item),
        });

        return res.status(201).json({
          success: true,
          ticketNo: item.ticketNo,
          mailSent: Boolean(mailResult.ok),
          mailError: mailResult.ok ? '' : (mailResult.error || mailResult.reason || 'unknown_mail_error'),
        });
      }


      if (action === 'query') {
        const ticketNo = ensureText(req.body?.ticketNo, 40).toUpperCase();
        if (!ticketNo || !/^DS-\d{4}-\d{5}$/.test(ticketNo)) {
          return res.status(400).json({ error: 'Geçerli bir talep numarası girin (örn: DS-2026-00004).' });
        }

        const items = await readItems();
        const item = items.find((entry) => String(entry.ticketNo || '').toUpperCase() === ticketNo);
        if (!item) {
          return res.status(404).json({ error: 'Talep bulunamadı.' });
        }

        return res.status(200).json({
          success: true,
          item: {
            ticketNo: item.ticketNo,
            status: item.status,
            createdAt: item.createdAt,
            repliedAt: item.repliedAt,
            replySubject: item.replySubject,
            replyMessage: item.replyMessage,
          },
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

        if (isDbEnabled()) {
          try {
            await ensureDbSchema();
            await pool.query(
              `UPDATE live_support_messages
               SET status = $1, replied_at = $2::timestamptz, reply_subject = $3, reply_message = $4
               WHERE id = $5`,
              [item.status, item.repliedAt, item.replySubject, item.replyMessage, id]
            );
          } catch (err) {
            console.error('live-support db reply fallback:', err.message);
            await writeItems(items);
          }
        } else {
          await writeItems(items);
        }

        return res.status(200).json({
          success: true,
          mailSent: Boolean(mailResult.ok),
          mailError: mailResult.ok ? '' : (mailResult.error || mailResult.reason || 'unknown_mail_error'),
          item,
        });
      }

      return res.status(400).json({ error: 'Geçersiz action.' });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('live-support error:', err.message);
    return res.status(500).json({ error: 'Sunucu hatası: ' + err.message });
  }
};
