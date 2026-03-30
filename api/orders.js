const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ADMIN_API_KEY = 'gocmen1993';
const ORDER_STATUSES = ['Beklemede', 'Hazırlanıyor', 'Kargoda', 'Teslim Edildi', 'İptal'];
const DEFAULT_ADMIN_EMAIL = 'muhammedeminturk.16@gmail.com';

let cachedEmailColumn = null;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  try {
    if (action === 'create' && req.method === 'POST') {
      const { name, phone, email, address, note, payment, items, total } = req.body || {};
      if (!name || !phone || !address || !Array.isArray(items) || total === undefined || total === null) {
        return res.status(400).json({ error: 'Eksik bilgi.' });
      }

      let musteri_id = null;
      try {
        const auth = req.headers.authorization;
        if (auth && auth.startsWith('Bearer ')) {
          const decoded = JSON.parse(Buffer.from(auth.slice(7), 'base64').toString());
          musteri_id = decoded.id || null;
        }
      } catch {}

      const cleanEmail = normalizeEmail(email);
      const insertResult = await insertOrder({
        musteri_id,
        name,
        phone,
        email: cleanEmail,
        address,
        payment,
        items,
        total,
        note,
      });

      const emailResult = await sendOrderCreatedEmails({
        orderId: insertResult.rows[0].id,
        customer: { name, phone, email: cleanEmail, address },
        note,
        payment,
        items,
        total,
      });

      return res.status(201).json({
        success: true,
        order_id: insertResult.rows[0].id,
        email: emailResult,
      });
    }

    if (action === 'my-orders' && req.method === 'GET') {
      const user = verifyToken(req);
      if (!user) return res.status(401).json({ error: 'Oturum geçersiz.' });
      const result = await pool.query(
        'SELECT id, musteri_adi, telefon, adres, odeme_yontemi, urunler, toplam, durum, siparis_notu, created_at FROM siparisler WHERE musteri_id = $1 ORDER BY created_at DESC',
        [user.id]
      );
      return res.status(200).json({ success: true, orders: result.rows });
    }

    if (action === 'all' && req.method === 'GET') {
      if (req.headers['x-admin-key'] !== ADMIN_API_KEY) {
        return res.status(403).json({ error: 'Yetkisiz.' });
      }
      const result = await pool.query('SELECT * FROM siparisler ORDER BY created_at DESC');
      return res.status(200).json({ success: true, orders: result.rows });
    }

    if (action === 'update-status' && req.method === 'POST') {
      if (req.headers['x-admin-key'] !== ADMIN_API_KEY) {
        return res.status(403).json({ error: 'Yetkisiz.' });
      }
      const { id, durum } = req.body || {};
      if (!id || !ORDER_STATUSES.includes(durum)) {
        return res.status(400).json({ error: 'Geçersiz veri.' });
      }

      const beforeResult = await pool.query('SELECT * FROM siparisler WHERE id = $1 LIMIT 1', [id]);
      if (!beforeResult.rows.length) {
        return res.status(404).json({ error: 'Sipariş bulunamadı.' });
      }
      const order = beforeResult.rows[0];
      const oldStatus = order.durum || 'Beklemede';

      await pool.query('UPDATE siparisler SET durum = $1 WHERE id = $2', [durum, id]);

      if (oldStatus !== durum) {
        await sendOrderStatusEmail({
          order,
          previousStatus: oldStatus,
          newStatus: durum,
        });
      }

      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Geçersiz işlem.' });
  } catch (err) {
    console.error('Orders error:', err.message);
    return res.status(500).json({ error: 'Sunucu hatası: ' + err.message });
  }
};

async function insertOrder({ musteri_id, name, phone, email, address, payment, items, total, note }) {
  const emailColumn = await getOrderEmailColumn();
  const serializedItems = JSON.stringify(items);

  if (emailColumn) {
    return pool.query(
      `INSERT INTO siparisler (musteri_id, musteri_adi, telefon, ${emailColumn}, adres, odeme_yontemi, urunler, toplam, siparis_notu)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, created_at`,
      [musteri_id, name, phone, email || null, address, payment, serializedItems, total, note || '']
    );
  }

  return pool.query(
    'INSERT INTO siparisler (musteri_id, musteri_adi, telefon, adres, odeme_yontemi, urunler, toplam, siparis_notu) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, created_at',
    [musteri_id, name, phone, address, payment, serializedItems, total, note || '']
  );
}

async function getOrderEmailColumn() {
  if (cachedEmailColumn !== null) return cachedEmailColumn;
  const candidates = ['email', 'musteri_email', 'eposta'];
  try {
    const result = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='siparisler'"
    );
    const available = new Set(result.rows.map((r) => String(r.column_name || '').toLowerCase()));
    cachedEmailColumn = candidates.find((c) => available.has(c)) || '';
    return cachedEmailColumn;
  } catch (err) {
    console.warn('Siparisler tablosu kolonları okunamadı:', err.message);
    cachedEmailColumn = '';
    return cachedEmailColumn;
  }
}

async function sendOrderCreatedEmails({ orderId, customer, note, payment, items, total }) {
  const customerHtml = buildOrderEmailHtml({
    title: 'Siparişiniz Alındı',
    subtitle: `Sipariş #${orderId} başarıyla oluşturuldu.`,
    accent: '#c9a84c',
    customer,
    payment,
    items,
    total,
    note,
  });

  const adminHtml = buildOrderEmailHtml({
    title: 'Yeni Sipariş Geldi',
    subtitle: `Yeni sipariş numarası: #${orderId}`,
    accent: '#0f0e0d',
    customer,
    payment,
    items,
    total,
    note,
  });

  const jobs = [];
  if (customer.email) {
    jobs.push(sendTransactionalEmail({
      to: customer.email,
      subject: `Göçmen Perde | Sipariş Onayı #${orderId}`,
      html: customerHtml,
    }));
  }

  const adminEmail = process.env.ADMIN_ORDER_EMAIL || DEFAULT_ADMIN_EMAIL;
  jobs.push(sendTransactionalEmail({
    to: adminEmail,
    subject: `Yeni Sipariş #${orderId} — ${customer.name}`,
    html: adminHtml,
  }));

  const results = await Promise.all(jobs);
  const sent = results.filter((result) => result.ok).length;
  const skipped = results.filter((result) => result.skipped).map((result) => result.reason);
  const failed = results.filter((result) => !result.ok && !result.skipped);

  if (failed.length) {
    console.warn(`Sipariş #${orderId} için ${failed.length} e-posta görevi başarısız oldu.`);
  }

  return {
    sent,
    failed: failed.length,
    skipped,
  };
}

async function sendOrderStatusEmail({ order, previousStatus, newStatus }) {
  const customerEmail = extractOrderEmail(order);
  if (!customerEmail) return;

  const items = parseOrderItems(order.urunler);
  const html = buildOrderEmailHtml({
    title: 'Sipariş Durumu Güncellendi',
    subtitle: `Sipariş #${order.id} durumu "${newStatus}" olarak güncellendi.`,
    accent: '#2471a3',
    customer: {
      name: order.musteri_adi,
      phone: order.telefon,
      email: customerEmail,
      address: order.adres,
    },
    payment: order.odeme_yontemi,
    items,
    total: order.toplam,
    note: order.siparis_notu,
    extra: `<p style="margin:0 0 10px;color:#4a4743"><strong>Önceki Durum:</strong> ${escapeHtml(previousStatus)}</p><p style="margin:0;color:#4a4743"><strong>Yeni Durum:</strong> ${escapeHtml(newStatus)}</p>`,
  });

  await sendTransactionalEmail({
    to: customerEmail,
    subject: `Göçmen Perde | Sipariş #${order.id} Durumu: ${newStatus}`,
    html,
  });
}

function parseOrderItems(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function extractOrderEmail(order) {
  return normalizeEmail(order?.email || order?.musteri_email || order?.eposta || '');
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function paymentLabel(payment) {
  const labels = {
    kapida: 'Kapıda Ödeme',
    havale: 'Havale / EFT',
    kredikarti: 'Kredi Kartı',
  };
  return labels[payment] || payment || 'Belirtilmedi';
}

function buildOrderEmailHtml({ title, subtitle, accent, customer, payment, items, total, note, extra = '' }) {
  const rows = (items || [])
    .map((item) => {
      const qty = Number(item.qty || item.quantity || item.adet || 1);
      const price = Number(item.price || 0);
      const subtotal = Number(item.sub || (qty * price));
      return `
        <tr>
          <td style="padding:10px;border-bottom:1px solid #f0ece3;color:#1e1c1a">${escapeHtml(item.name || item.ad || 'Ürün')}</td>
          <td style="padding:10px;border-bottom:1px solid #f0ece3;color:#5a5652;text-align:center">${qty}</td>
          <td style="padding:10px;border-bottom:1px solid #f0ece3;color:#1e1c1a;text-align:right">${formatCurrency(subtotal)}</td>
        </tr>`;
    })
    .join('');

  return `
  <div style="margin:0;padding:24px;background:#f7f4ef;font-family:Arial,sans-serif;color:#1e1c1a">
    <div style="max-width:700px;margin:0 auto;background:#fff;border:1px solid #ece6db;border-radius:16px;overflow:hidden">
      <div style="padding:24px;background:${accent};color:#fff">
        <h1 style="margin:0 0 8px;font-size:24px">${escapeHtml(title)}</h1>
        <p style="margin:0;font-size:14px;opacity:.95">${escapeHtml(subtitle)}</p>
      </div>
      <div style="padding:24px">
        <h2 style="margin:0 0 12px;font-size:18px;color:#0f0e0d">Müşteri Bilgileri</h2>
        <p style="margin:0 0 8px"><strong>Ad Soyad:</strong> ${escapeHtml(customer?.name || '-')}</p>
        <p style="margin:0 0 8px"><strong>Telefon:</strong> ${escapeHtml(customer?.phone || '-')}</p>
        <p style="margin:0 0 8px"><strong>E-posta:</strong> ${escapeHtml(customer?.email || '-')}</p>
        <p style="margin:0 0 16px"><strong>Adres:</strong> ${escapeHtml(customer?.address || '-')}</p>
        <p style="margin:0 0 8px"><strong>Ödeme:</strong> ${escapeHtml(paymentLabel(payment))}</p>
        <p style="margin:0 0 20px"><strong>Sipariş Notu:</strong> ${escapeHtml(note || '-')}</p>
        ${extra}
        <h2 style="margin:22px 0 12px;font-size:18px;color:#0f0e0d">Sipariş Detayları</h2>
        <table style="width:100%;border-collapse:collapse;border:1px solid #f0ece3;border-radius:10px;overflow:hidden">
          <thead>
            <tr style="background:#faf8f3">
              <th style="padding:10px;text-align:left;font-size:12px;letter-spacing:.5px;color:#5a5652">ÜRÜN</th>
              <th style="padding:10px;text-align:center;font-size:12px;letter-spacing:.5px;color:#5a5652">ADET</th>
              <th style="padding:10px;text-align:right;font-size:12px;letter-spacing:.5px;color:#5a5652">TUTAR</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="3" style="padding:12px;color:#5a5652">Ürün bilgisi bulunamadı.</td></tr>'}
          </tbody>
        </table>
        <p style="margin:16px 0 0;font-size:17px"><strong>Toplam:</strong> ${formatCurrency(total)}</p>
      </div>
    </div>
  </div>`;
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  return `${amount.toLocaleString('tr-TR')} TL`;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const FALLBACK_RESEND_API_KEY = 're_c4EEGk7p_KvYLe2RR19gjuBkyd354v1Td';

async function sendTransactionalEmail({ to, subject, html }) {
  const apiKey = String(process.env.RESEND_API_KEY || FALLBACK_RESEND_API_KEY || '').trim();
  const from = resolveFromAddress();
  if (!apiKey) {
    console.warn('RESEND_API_KEY tanımlı değil. E-posta gönderimi atlandı.');
    return { ok: false, skipped: true, reason: 'missing_api_key' };
  }
  if (!to) {
    return { ok: false, skipped: true, reason: 'missing_recipient' };
  }
  if (!from) {
    return { ok: false, skipped: true, reason: 'invalid_from_address' };
  }

  try {
    if (from.includes('onboarding@resend.dev')) {
      console.warn(
        'ORDER_FROM_EMAIL onboarding@resend.dev olarak ayarlı. Bu adres test amaçlıdır; üretimde doğrulanmış domain adresi kullanın.'
      );
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.warn('Mail gönderilemedi:', response.status, body);
      return { ok: false, skipped: false, status: response.status };
    }
    return { ok: true, skipped: false };
  } catch (err) {
    console.warn('Mail servisi hatası:', err.message);
    return { ok: false, skipped: false, error: err.message };
  }
}

function resolveFromAddress() {
  const configuredFrom = String(process.env.ORDER_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || '').trim();
  const fallbackFrom = 'Göçmen Perde <noreply@gocmenperde.com.tr>';
  const from = configuredFrom || fallbackFrom;
  const emailMatch = from.match(/<?([^<>\s]+@[^<>\s]+)>?$/);
  const email = emailMatch ? emailMatch[1].toLowerCase() : '';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.warn('ORDER_FROM_EMAIL geçersiz. Örn: "Göçmen Perde <bilgi@gocmenperde.com.tr>"');
    return '';
  }

  return from;
}

function verifyToken(req) {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return null;
    const decoded = JSON.parse(Buffer.from(auth.slice(7), 'base64').toString());
    if (!decoded.id || !decoded.email) return null;
    return decoded;
  } catch {
    return null;
  }
}
