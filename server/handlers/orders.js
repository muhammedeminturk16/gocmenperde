const { verifyAuthToken } = require('../lib/_auth-utils');
const fs = require('fs/promises');
const path = require('path');

const { pool } = require('../lib/_db');
const ADMIN_API_KEY = 'gocmen1993';
const ORDER_STATUSES = ['Beklemede', 'Hazırlanıyor', 'Kargoya Verildi', 'Yolda', 'Dağıtımda', 'Teslim Edildi', 'İptal'];
const ORDER_STATUS_ALIASES = {
  beklemede: 'Beklemede',
  hazirlaniyor: 'Hazırlanıyor',
  kargoyaverildi: 'Kargoya Verildi',
  kargoda: 'Yolda',
  yolda: 'Yolda',
  dagitimda: 'Dağıtımda',
  teslimedildi: 'Teslim Edildi',
  iptal: 'İptal',
};
const DEFAULT_ADMIN_EMAIL = 'muhammedeminturk.16@gmail.com';
const TRACKING_DIR = path.join(process.cwd(), 'server', '.data');
const TRACKING_FILE = path.join(TRACKING_DIR, 'order-tracking.json');
const ORDER_NO_DIGITS = 14;

let cachedEmailColumn = null;
let cachedCustomerEmailColumns = null;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  try {
    if (action === 'create' && req.method === 'POST') {
      const { name, phone, email, address, note, payment, items, total } = req.body || {};
      const validation = validateCreateOrderPayload({ name, phone, email, address, note, payment, items, total });
      if (!validation.ok) {
        return res.status(400).json({ error: validation.error });
      }

      let musteri_id = null;
      try {
        const auth = req.headers.authorization;
        if (auth && auth.startsWith('Bearer ')) {
          const decoded = verifyAuthToken(req);
          musteri_id = decoded?.id || null;
        }
      } catch (error) {
        console.warn('Auth token doğrulama atlandı:', error.message);
      }

      const cleanEmail = normalizeEmail(validation.value.email);
      const insertResult = await insertOrder({
        musteri_id,
        name: validation.value.name,
        phone: validation.value.phone,
        email: cleanEmail,
        address: validation.value.address,
        payment: validation.value.payment,
        items: validation.value.items,
        total: validation.value.total,
        note: validation.value.note,
      });
      const createdOrder = insertResult.rows[0] || {};
      const orderId = Number(createdOrder.id || 0);
      const orderNo = (await ensureOrderTrackingRecord({
        orderId,
        createdAt: createdOrder.created_at,
      })) || String(orderId);

      const emailResult = await sendOrderCreatedEmails({
        orderId,
        orderNo,
        customer: { name: validation.value.name, phone: validation.value.phone, email: cleanEmail, address: validation.value.address },
        note: validation.value.note,
        payment: validation.value.payment,
        items: validation.value.items,
        total: validation.value.total,
      });

      return res.status(201).json({
        success: true,
        order_id: orderId,
        order_no: orderNo,
        email: emailResult,
      });
    }

    if (action === 'my-orders' && req.method === 'GET') {
      const user = verifyAuthToken(req);
      if (!user) return res.status(401).json({ error: 'Oturum geçersiz.' });
      const result = await pool.query(
        'SELECT id, musteri_adi, telefon, adres, odeme_yontemi, urunler, toplam, durum, siparis_notu, created_at FROM siparisler WHERE musteri_id = $1 ORDER BY created_at DESC',
        [user.id]
      );
      const orders = await withTrackingData(result.rows);
      return res.status(200).json({ success: true, orders });
    }

    if (action === 'all' && req.method === 'GET') {
      if (req.headers['x-admin-key'] !== ADMIN_API_KEY) {
        return res.status(403).json({ error: 'Yetkisiz.' });
      }
      const result = await pool.query('SELECT * FROM siparisler ORDER BY created_at DESC');
      const orders = await withTrackingData(result.rows);
      return res.status(200).json({ success: true, orders });
    }

    if (action === 'track' && req.method === 'GET') {
      const rawOrderNo = String(req.query?.orderNo || '').trim();
      const resolved = await resolveOrderLookup(rawOrderNo);
      if (!resolved.ok) {
        return res.status(400).json({ error: 'Geçerli bir sipariş numarası girin.' });
      }

      const result = await pool.query(
        'SELECT id, musteri_adi, durum, created_at FROM siparisler WHERE id = $1 LIMIT 1',
        [resolved.orderId]
      );
      if (!result.rows.length) {
        return res.status(404).json({ error: 'Sipariş bulunamadı.' });
      }
      const order = (await withTrackingData(result.rows))[0];
      return res.status(200).json({ success: true, order });
    }

    if (action === 'update-status' && req.method === 'POST') {
      if (req.headers['x-admin-key'] !== ADMIN_API_KEY) {
        return res.status(403).json({ error: 'Yetkisiz.' });
      }
      const { id, durum, trackingNote, trackingCode } = req.body || {};
      const normalizedStatus = normalizeOrderStatus(durum);
      if (!id || !normalizedStatus || !ORDER_STATUSES.includes(normalizedStatus)) {
        return res.status(400).json({ error: 'Geçersiz veri.' });
      }

      const beforeResult = await pool.query('SELECT * FROM siparisler WHERE id = $1 LIMIT 1', [id]);
      if (!beforeResult.rows.length) {
        return res.status(404).json({ error: 'Sipariş bulunamadı.' });
      }
      const order = beforeResult.rows[0];
      const oldStatus = order.durum || 'Beklemede';

      await pool.query('UPDATE siparisler SET durum = $1 WHERE id = $2', [normalizedStatus, id]);
      await upsertTracking({
        orderId: Number(id),
        newStatus: normalizedStatus,
        createdAt: order.created_at,
        trackingNote,
        trackingCode,
      });

      if (oldStatus !== normalizedStatus) {
        await sendOrderStatusEmail({
          order,
          previousStatus: oldStatus,
          newStatus: normalizedStatus,
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

async function sendOrderCreatedEmails({ orderId, orderNo, customer, note, payment, items, total }) {
  const customerHtml = buildOrderEmailHtml({
    title: 'Siparişiniz Alındı',
    subtitle: `Sipariş numaranız: ${orderNo}. Bu numarayla siparişinizi kolayca sorgulayabilirsiniz.`,
    accent: '#c9a84c',
    orderNo,
    customer,
    payment,
    items,
    total,
    note,
  });

  const adminHtml = buildOrderEmailHtml({
    title: 'Yeni Sipariş Geldi',
    subtitle: `Yeni sipariş numarası: ${orderNo} (DB #${orderId})`,
    accent: '#0f0e0d',
    orderNo,
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
      subject: 'Göçmen Perde | Sipariş Özetiniz',
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
  const customerEmail = await resolveOrderCustomerEmail(order);
  if (!customerEmail) {
    console.warn(`Sipariş #${order?.id || '-'} için durum maili atlandı: müşteri e-postası bulunamadı.`);
    return;
  }

  const items = parseOrderItems(order.urunler);
  const html = buildOrderEmailHtml({
    title: 'Sipariş Durumu Güncellendi',
    subtitle: `Sipariş durumunuz "${newStatus}" olarak güncellendi.`,
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
    subject: `Göçmen Perde | Sipariş Durum Güncellemesi: ${newStatus}`,
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

async function resolveOrderCustomerEmail(order) {
  const fromOrder = extractOrderEmail(order);
  if (fromOrder) return fromOrder;

  const customerId = Number(order?.musteri_id || 0);
  if (!customerId) return '';

  try {
    const customerEmailColumns = await getCustomerEmailColumns();
    if (!customerEmailColumns.length) return '';
    const selectCols = customerEmailColumns.join(', ');
    const result = await pool.query(`SELECT ${selectCols} FROM musteriler WHERE id = $1 LIMIT 1`, [customerId]);
    if (!result.rows.length) return '';
    const row = result.rows[0] || {};
    for (const col of customerEmailColumns) {
      const email = normalizeEmail(row[col] || '');
      if (email) return email;
    }
    return '';
  } catch (err) {
    console.warn('Müşteri e-posta sorgusu başarısız:', err.message);
    return '';
  }
}

async function getCustomerEmailColumns() {
  if (cachedCustomerEmailColumns !== null) return cachedCustomerEmailColumns;
  const candidates = ['email', 'eposta', 'musteri_email'];
  try {
    const result = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='musteriler'"
    );
    const available = new Set(result.rows.map((r) => String(r.column_name || '').toLowerCase()));
    cachedCustomerEmailColumns = candidates.filter((c) => available.has(c));
    return cachedCustomerEmailColumns;
  } catch (err) {
    console.warn('Musteriler tablosu kolonları okunamadı:', err.message);
    cachedCustomerEmailColumns = [];
    return cachedCustomerEmailColumns;
  }
}

function normalizeStatusKey(value) {
  return String(value || '')
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeOrderStatus(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (ORDER_STATUSES.includes(raw)) return raw;
  return ORDER_STATUS_ALIASES[normalizeStatusKey(raw)] || '';
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function normalizePhone(value) {
  return String(value || '').replace(/[^\d+]/g, '').slice(0, 20);
}

function normalizePayment(value) {
  const allowed = new Set(['kapida', 'havale', 'kredikarti']);
  const candidate = String(value || '').trim().toLocaleLowerCase('tr-TR');
  return allowed.has(candidate) ? candidate : '';
}

function validateCreateOrderPayload(payload) {
  const name = String(payload?.name || '').trim().slice(0, 120);
  const phone = normalizePhone(payload?.phone);
  const email = normalizeEmail(payload?.email);
  const address = String(payload?.address || '').trim().slice(0, 1200);
  const note = String(payload?.note || '').trim().slice(0, 1500);
  const payment = normalizePayment(payload?.payment);
  const items = sanitizeOrderItems(payload?.items);
  const total = Number(payload?.total);

  if (!name || name.length < 2) return { ok: false, error: 'Geçerli bir ad soyad girin.' };
  if (!phone || phone.replace(/\D/g, '').length < 10) return { ok: false, error: 'Geçerli bir telefon numarası girin.' };
  if (payload?.email && !email) return { ok: false, error: 'Geçerli bir e-posta adresi girin.' };
  if (!address || address.length < 8) return { ok: false, error: 'Teslimat adresi eksik görünüyor.' };
  if (!payment) return { ok: false, error: 'Geçersiz ödeme yöntemi.' };
  if (!items.length) return { ok: false, error: 'Sipariş için en az bir ürün gereklidir.' };
  if (!Number.isFinite(total) || total <= 0) return { ok: false, error: 'Toplam tutar geçersiz.' };

  const computedTotal = items.reduce((sum, item) => sum + Number(item.sub || 0), 0);
  if (Math.abs(computedTotal - total) > 1) {
    return { ok: false, error: 'Sepet toplamı uyuşmuyor. Lütfen sepeti güncelleyip tekrar deneyin.' };
  }

  return {
    ok: true,
    value: {
      name,
      phone,
      email,
      address,
      note,
      payment,
      items,
      total: Number(total.toFixed(2)),
    },
  };
}

function sanitizeOrderItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const price = Number(item?.price || 0);
      const qty = Number(item?.qty || 1);
      const sub = Number(item?.sub || price * qty);
      if (!Number.isFinite(price) || price <= 0) return null;
      if (!Number.isFinite(qty) || qty <= 0) return null;
      if (!Number.isFinite(sub) || sub <= 0) return null;
      return {
        id: String(item?.id || '').slice(0, 120),
        name: String(item?.name || 'Ürün').trim().slice(0, 180),
        price: Number(price.toFixed(2)),
        qty: Number(qty.toFixed(3)),
        sub: Number(sub.toFixed(2)),
        image: String(item?.image || '').slice(0, 600),
        unitLabel: String(item?.unitLabel || item?.unit || 'adet').slice(0, 40),
        width: item?.width ?? null,
        height: item?.height ?? null,
      };
    })
    .filter(Boolean)
    .slice(0, 120);
}

function paymentLabel(payment) {
  const labels = {
    kapida: 'Kapıda Ödeme',
    havale: 'Havale / EFT',
    kredikarti: 'Kredi Kartı',
  };
  return labels[payment] || payment || 'Belirtilmedi';
}

function buildOrderEmailHtml({ title, subtitle, accent, orderNo = '', customer, payment, items, total, note, extra = '' }) {
  const siteUrl = resolveSiteUrl();
  const customerOrdersUrl = `${siteUrl}/hesabim.html?tab=orders`;
  const accentColor = String(accent || '#1f4f7a').trim() || '#1f4f7a';
  const accentSoft = accentColor === '#0f0e0d' ? '#2d2b29' : '#8c6d1f';
  const accentGlow = accentColor === '#0f0e0d' ? '#5a544f' : '#e0bf64';
  const isDarkAccent = accentColor === '#0f0e0d';
  const headerGradient = isDarkAccent
    ? 'linear-gradient(135deg,#111111 0%,#2f2c29 45%,#4b433e 100%)'
    : `linear-gradient(135deg,${accentColor} 0%,${accentSoft} 46%,${accentGlow} 100%)`;
  const headerText = isDarkAccent ? '#f8efe4' : '#ffffff';
  const chipBg = isDarkAccent ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.19)';
  const itemsSafe = Array.isArray(items) ? items : [];
  const itemCards = itemsSafe
    .map((item) => {
      const qty = Number(item.qty || item.quantity || item.adet || 1);
      const price = Number(item.price || 0);
      const subtotal = Number(item.sub || (qty * price));
      const rawImage = String(item.image || item.img || item.photo || '').trim();
      const imageUrl = normalizeAssetUrl(rawImage, siteUrl) || `${siteUrl}/resimler/logo.jpg`;
      const productId = item.id || item.productId || item.urun_id || '';
      const productName = escapeHtml(item.name || item.ad || 'Ürün');
      const productUrl = productId
        ? `${siteUrl}/?product=${encodeURIComponent(String(productId))}#products`
        : `${siteUrl}/#products`;
      const qtyLabel = qty > 1 ? `${qty} adet` : '1 adet';

      return `
        <a href="${escapeHtml(productUrl)}" style="display:block;text-decoration:none;color:#111827 !important;margin:0 0 12px;border:1px solid #d7dbe6;border-radius:18px;overflow:hidden;background:#ffffff;box-shadow:0 10px 24px rgba(15,23,42,.08);">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
            <tr>
              <td width="92" style="padding:12px;vertical-align:top;">
                <img src="${escapeHtml(imageUrl)}" alt="${productName}" width="92" height="92" style="display:block;width:92px;height:92px;object-fit:cover;border-radius:14px;border:1px solid #d8d7e5;background:#f8f8fd" />
              </td>
              <td style="padding:12px 12px 12px 0;vertical-align:top;">
                <p style="margin:0 0 6px;font-size:15px;font-weight:800;color:#0f172a !important">${productName}</p>
                <p style="margin:0 0 4px;font-size:12px;color:#374151 !important">${escapeHtml(qtyLabel)} · ${formatCurrency(price)} / birim</p>
                <p style="margin:0;font-size:14px;font-weight:800;color:#111827 !important">Ara Toplam: ${formatCurrency(subtotal)}</p>
                <p style="margin:8px 0 0;font-size:12px;color:#1d4ed8 !important;font-weight:700">Ürünü görüntülemek için tıklayın →</p>
              </td>
            </tr>
          </table>
        </a>`;
    })
    .join('');

  const noteText = String(note || '').trim() || '-';

  return `
  <div style="margin:0;padding:24px;background:linear-gradient(145deg,#f8fafc 0%,#eef2ff 100%);font-family:'Segoe UI',Arial,sans-serif;color:#111827">
    <div style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid #dfddee;border-radius:28px;overflow:hidden;box-shadow:0 18px 42px rgba(52,46,92,0.14)">
      <div style="padding:30px 24px 26px;background:${headerGradient};color:${headerText};position:relative;isolation:isolate">
        <div style="position:absolute;inset:0;background:linear-gradient(160deg,rgba(0,0,0,.28),rgba(0,0,0,.12) 45%,rgba(0,0,0,.24));z-index:-1"></div>
        <p style="margin:0 0 10px;display:inline-block;padding:7px 12px;border-radius:999px;background:${chipBg};font-size:11px;letter-spacing:.9px;font-weight:700;text-transform:uppercase;box-shadow:inset 0 0 0 1px rgba(255,255,255,.25),0 8px 20px rgba(0,0,0,.16);text-shadow:0 1px 1px rgba(0,0,0,.25)">Göçmen Perde Premium</p>
        <h1 style="margin:0 0 8px;font-size:29px;letter-spacing:.25px;text-shadow:0 2px 10px rgba(0,0,0,.42),0 1px 0 rgba(0,0,0,.35)">${escapeHtml(title)}</h1>
        <p style="margin:0;font-size:14px;opacity:.97;text-shadow:0 1px 8px rgba(0,0,0,.38)">${escapeHtml(subtitle)}</p>
      </div>
      <div style="padding:24px 24px 18px;">
        <div style="margin:0 0 16px;padding:18px;border-radius:20px;background:#ffffff;border:1px solid #d7dbe6;box-shadow:0 10px 20px rgba(30,41,59,.06)">
          <p style="margin:0 0 10px;font-size:14px;color:#374151 !important">Merhaba ${escapeHtml(customer?.name || 'Değerli müşterimiz')}, sipariş detaylarınızı aşağıda görebilirsiniz.</p>
          <a href="${escapeHtml(customerOrdersUrl)}" style="display:inline-block;padding:10px 16px;border-radius:999px;background:${headerGradient};color:${headerText};font-size:12px;font-weight:700;letter-spacing:.3px;text-decoration:none;box-shadow:0 10px 20px rgba(22,18,43,.24);text-shadow:0 1px 4px rgba(0,0,0,.45)">Müşteri paneline git</a>
        </div>

        <h2 style="margin:0 0 10px;font-size:18px;color:#111827 !important">Müşteri Bilgileri</h2>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0 8px;margin-bottom:14px">
          <tr><td style="width:130px;color:#4b5563 !important;font-size:13px">Ad Soyad</td><td style="font-size:14px;font-weight:700;color:#111827 !important">${escapeHtml(customer?.name || '-')}</td></tr>
          <tr><td style="color:#4b5563 !important;font-size:13px">Sipariş No</td><td style="font-size:14px;font-weight:800;color:#111827 !important">${escapeHtml(orderNo || '-')}</td></tr>
          <tr><td style="color:#4b5563 !important;font-size:13px">Telefon</td><td style="font-size:14px;color:#1f2937 !important">${escapeHtml(customer?.phone || '-')}</td></tr>
          <tr><td style="color:#4b5563 !important;font-size:13px">E-posta</td><td style="font-size:14px;color:#1d4ed8 !important;text-decoration:underline">${escapeHtml(customer?.email || '-')}</td></tr>
          <tr><td style="color:#4b5563 !important;font-size:13px">Ödeme</td><td style="font-size:14px;color:#1f2937 !important">${escapeHtml(paymentLabel(payment))}</td></tr>
          <tr><td style="color:#4b5563 !important;font-size:13px;vertical-align:top">Adres</td><td style="font-size:14px;line-height:1.6;color:#1f2937 !important">${escapeHtml(customer?.address || '-')}</td></tr>
          <tr><td style="color:#4b5563 !important;font-size:13px;vertical-align:top">Sipariş Notu</td><td style="font-size:14px;line-height:1.6;color:#1f2937 !important">${escapeHtml(noteText)}</td></tr>
        </table>

        ${extra}

        <div style="margin:20px 0 10px;padding:18px;border:1px solid #d7dbe6;border-radius:22px;background:#ffffff;box-shadow:0 14px 28px rgba(15,23,42,.08)">
          <h2 style="margin:0 0 12px;font-size:19px;color:#111827 !important;letter-spacing:.2px">Sipariş Özetiniz</h2>
          ${itemCards || '<p style="margin:0;color:#4b5563 !important;font-size:14px">Ürün bilgisi bulunamadı.</p>'}
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding-top:12px;border-top:1px dashed #cdc5ea;margin-top:10px;flex-wrap:wrap">
            <p style="margin:0;font-size:13px;color:#4b5563 !important">Ürün kartlarına dokunarak detay sayfasına geçebilirsiniz.</p>
            <p style="margin:0;font-size:20px;font-weight:800;color:#111827 !important">Toplam: ${formatCurrency(total)}</p>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}


function resolveSiteUrl() {
  const raw = String(
    process.env.SITE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.PUBLIC_SITE_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    'https://gocmenperde.com'
  ).trim();
  if (!raw) return 'https://gocmenperde.com';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/$/, '');
}

function normalizeAssetUrl(value, siteUrl) {
  const src = String(value || '').trim();
  if (!src) return '';
  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith('//')) return `https:${src}`;
  const prefixed = src.startsWith('/') ? src : `/${src}`;
  return `${siteUrl}${prefixed}`;
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


async function withTrackingData(orders = []) {
  if (!Array.isArray(orders) || !orders.length) return [];
  const store = await readTrackingStore();
  let storeDirty = false;
  const mapped = orders.map((order) => {
    const key = String(order.id || '');
    const ensured = ensureOrderNoRecord(store, key, Number(order.id || 0));
    const record = ensured.record;
    if (ensured.changed) storeDirty = true;
    return {
      ...order,
      order_no: String(record.orderNo || ''),
      tracking: {
        code: String(record.code || ''),
        history: buildTrackingHistory({
          createdAt: order.created_at,
          currentStatus: order.durum || 'Beklemede',
          storedHistory: record.history,
        }),
      },
    };
  });
  if (storeDirty) await writeTrackingStore(store);
  return mapped;
}

function buildTrackingHistory({ createdAt, currentStatus, storedHistory }) {
  const timeline = Array.isArray(storedHistory) ? storedHistory.filter(Boolean) : [];
  if (timeline.length) return timeline;
  return [{
    status: currentStatus || 'Beklemede',
    note: 'Sipariş kaydı oluşturuldu.',
    at: createdAt || new Date().toISOString(),
  }];
}

async function upsertTracking({ orderId, newStatus, createdAt, trackingNote, trackingCode }) {
  if (!Number.isInteger(orderId) || orderId <= 0) return;
  const store = await readTrackingStore();
  const key = String(orderId);
  const record = ensureOrderNoRecord(store, key, orderId).record;
  const prevHistory = Array.isArray(record.history) ? record.history : [];
  const safeNote = String(trackingNote || '').trim().slice(0, 350);
  const safeCode = String(trackingCode || '').trim().slice(0, 80);

  if (safeCode) record.code = safeCode;
  if (!prevHistory.length) {
    prevHistory.push({
      status: 'Beklemede',
      note: 'Sipariş kaydı oluşturuldu.',
      at: createdAt || new Date().toISOString(),
    });
  }
  const lastStatus = String(prevHistory[prevHistory.length - 1]?.status || '');
  if (lastStatus !== newStatus || safeNote) {
    prevHistory.push({
      status: newStatus,
      note: safeNote || `${newStatus} olarak güncellendi.`,
      at: new Date().toISOString(),
    });
  }
  record.history = prevHistory.slice(-40);
  store[key] = record;
  await writeTrackingStore(store);
}

async function ensureOrderTrackingRecord({ orderId, createdAt }) {
  if (!Number.isInteger(orderId) || orderId <= 0) return '';
  const store = await readTrackingStore();
  const key = String(orderId);
  const record = ensureOrderNoRecord(store, key, orderId).record;
  if (!Array.isArray(record.history) || !record.history.length) {
    record.history = [{
      status: 'Beklemede',
      note: 'Sipariş kaydı oluşturuldu.',
      at: createdAt || new Date().toISOString(),
    }];
  }
  store[key] = record;
  await writeTrackingStore(store);
  return String(record.orderNo || '');
}

async function resolveOrderLookup(rawValue) {
  const digits = String(rawValue || '').replace(/\D+/g, '');
  if (!digits) return { ok: false, orderId: 0 };
  const store = await readTrackingStore();
  const matchByOrderNo = Object.entries(store).find(([, record]) => {
    const normalizedOrderNo = String(record?.orderNo || '').replace(/\D+/g, '');
    return normalizedOrderNo && normalizedOrderNo === digits;
  });
  if (matchByOrderNo) {
    return { ok: true, orderId: Number(matchByOrderNo[0]) };
  }
  const PG_INT_MAX = 2147483647;
  if (digits.length > String(PG_INT_MAX).length) {
    return { ok: false, orderId: 0 };
  }
  const maybeId = Number(digits);
  if (!Number.isInteger(maybeId) || maybeId <= 0 || maybeId > PG_INT_MAX) {
    return { ok: false, orderId: 0 };
  }
  return { ok: true, orderId: maybeId };
}

function ensureOrderNoRecord(store, key, orderId) {
  const record = store[key] && typeof store[key] === 'object' ? store[key] : {};
  const current = String(record.orderNo || '').replace(/\D+/g, '');
  let changed = false;
  if (current.length !== ORDER_NO_DIGITS) {
    record.orderNo = generateOrderNo(orderId, store, key);
    changed = true;
  }
  if (!store[key] || store[key] !== record) changed = true;
  store[key] = record;
  return { record, changed };
}

function generateOrderNo(orderId, store, currentKey) {
  const used = new Set(
    Object.entries(store || {})
      .filter(([key]) => String(key) !== String(currentKey))
      .map(([, value]) => String(value?.orderNo || '').replace(/\D+/g, ''))
      .filter((value) => value.length === ORDER_NO_DIGITS)
  );
  const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
  const timePart = Date.now().toString().slice(-7);
  const idPart = String(Math.max(1, Number(orderId) || 1)).padStart(2, '0').slice(-2);
  let candidate = `${timePart}${idPart}${suffix}`;
  let tries = 0;
  while (used.has(candidate) && tries < 20) {
    tries += 1;
    candidate = `${Date.now().toString().slice(-7)}${String(Math.floor(Math.random() * 10000000)).padStart(7, '0')}`;
  }
  return candidate.slice(0, ORDER_NO_DIGITS);
}

async function readTrackingStore() {
  try {
    const raw = await fs.readFile(TRACKING_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    console.warn('Tracking verisi okunamadı:', err.message);
    return {};
  }
}

async function writeTrackingStore(store) {
  try {
    await fs.mkdir(TRACKING_DIR, { recursive: true });
    await fs.writeFile(TRACKING_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.warn('Tracking verisi yazılamadı:', err.message);
  }
}
