const crypto = require('crypto');
const { getPaytrCredentials } = require('../lib/_paytr-config');

const SUPPORTED_CURRENCIES = new Set(['TL', 'USD', 'EUR', 'GBP']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


const IPV4_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function normalizeIp(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return '';

  if (candidate.includes(',')) {
    return normalizeIp(candidate.split(',')[0]);
  }

  const mappedIpv4 = candidate.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mappedIpv4) {
    return mappedIpv4[1];
  }

  if (IPV4_PATTERN.test(candidate)) {
    const parts = candidate.split('.').map(Number);
    if (parts.every((part) => part >= 0 && part <= 255)) {
      return candidate;
    }
  }

  return '';
}

function getClientIp(req) {
  const xForwardedFor = normalizeIp(req.headers['x-forwarded-for']);
  if (xForwardedFor) return xForwardedFor;

  const xRealIp = normalizeIp(req.headers['x-real-ip']);
  if (xRealIp) return xRealIp;

  const socketIp = normalizeIp(req.socket?.remoteAddress || req.connection?.remoteAddress);
  if (socketIp) return socketIp;

  return '127.0.0.1';
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return EMAIL_PATTERN.test(email) ? email : '';
}

function sanitizeRedirectUrl(value, fallback) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  try {
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol)) return fallback;
    return url.toString();
  } catch {
    return fallback;
  }
}

function buildPaytrBasket(items) {
  const basket = items.map((item) => {
    const name = String(item.name || 'Ürün').slice(0, 200);
    const quantity = Math.max(1, Math.round(Number(item.qty || 1)));
    const unitPrice = Number(item.price || 0);

    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      throw new Error('Ürün fiyatı geçersiz.');
    }

    return [name, unitPrice.toFixed(2), quantity];
  });

  return Buffer.from(JSON.stringify(basket), 'utf8').toString('base64');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Sadece POST desteklenir.' });
  }

  const { action } = req.query || {};
  if (action !== 'create-paytr-token') {
    return res.status(400).json({ error: 'Geçersiz işlem.' });
  }

  const { merchantId, merchantKey, merchantSalt, hasRequiredCredentials } = getPaytrCredentials();

  if (!hasRequiredCredentials) {
    return res.status(500).json({
      error: 'PAYTR_MERCHANT_ID, PAYTR_MERCHANT_KEY ve PAYTR_MERCHANT_SALT ortam değişkenleri tanımlı değil.'
    });
  }

  try {
    const {
      items = [],
      customer = {},
      successUrl,
      cancelUrl,
      currency = 'TL',
      orderNote = '',
      shippingAddress = '',
      userName = ''
    } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Ödeme için en az bir ürün gereklidir.' });
    }

    const normalizedCurrency = String(currency).toUpperCase();
    if (!SUPPORTED_CURRENCIES.has(normalizedCurrency)) {
      return res.status(400).json({ error: 'Desteklenmeyen para birimi.' });
    }

    const totalAmount = items.reduce((sum, item) => {
      const price = Number(item.price || 0);
      const qty = Number(item.qty || 1);
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty) || qty <= 0) {
        throw new Error('Ürün fiyatı veya adedi geçersiz.');
      }
      return sum + price * qty;
    }, 0);

    const paymentAmount = Math.round(totalAmount * 100);
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      return res.status(400).json({ error: 'Ödeme tutarı geçersiz.' });
    }

    const userBasket = buildPaytrBasket(items);
    const merchantOid = `GP${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const testMode = process.env.PAYTR_TEST_MODE === '1' ? '1' : '0';
    const debugOn = process.env.PAYTR_DEBUG_ON === '1' ? '1' : '0';
    const noInstallment = '0';
    const maxInstallment = '0';
    const timeoutLimit = '30';
    const userIp = getClientIp(req);
    const userEmail = normalizeEmail(customer.email) || 'musteri@example.com';
    const customerName = String(userName || customer.name || 'Müşteri').slice(0, 60);
    const customerPhone = String(customer.phone || '05000000000').replace(/\D/g, '').slice(0, 20) || '05000000000';
    const customerAddress = String(shippingAddress || orderNote || 'Adres belirtilmedi').trim().slice(0, 400);
    const merchantOkUrl = sanitizeRedirectUrl(successUrl, 'https://example.com/?payment=success');
    const merchantFailUrl = sanitizeRedirectUrl(cancelUrl, 'https://example.com/?payment=cancel');

    const hashStr = `${merchantId}${userIp}${merchantOid}${userEmail}${paymentAmount}${userBasket}${noInstallment}${maxInstallment}${normalizedCurrency}${testMode}`;
    const paytrToken = crypto
      .createHmac('sha256', merchantKey)
      .update(`${hashStr}${merchantSalt}`)
      .digest('base64');

    const params = new URLSearchParams();
    params.set('merchant_id', merchantId);
    params.set('email', userEmail);
    params.set('payment_amount', String(paymentAmount));
    params.set('merchant_oid', merchantOid);
    params.set('user_name', customerName);
    params.set('user_address', customerAddress);
    params.set('user_phone', customerPhone);
    params.set('merchant_ok_url', merchantOkUrl);
    params.set('merchant_fail_url', merchantFailUrl);
    params.set('user_basket', userBasket);
    params.set('user_ip', userIp);
    params.set('timeout_limit', timeoutLimit);
    params.set('debug_on', debugOn);
    params.set('test_mode', testMode);
    params.set('lang', 'tr');
    params.set('no_installment', noInstallment);
    params.set('max_installment', maxInstallment);
    params.set('currency', normalizedCurrency);
    params.set('paytr_token', paytrToken);
    params.set('iframe_v2', '1');
    params.set('iframe_v2_dark', '0');
    // Hosted PayTR iFrame akışında kart bilgileri yalnızca PayTR tarafında girilir.
    // non_3d=0 ile 3D Secure akışı zorunlu tutulur.
    params.set('non_3d', '0');

    const paytrResponse = await fetch('https://www.paytr.com/odeme/api/get-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });

    const responseText = await paytrResponse.text();
    let data = null;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { status: 'failed', reason: responseText || 'INVALID_PAYTR_RESPONSE' };
    }

    if (!paytrResponse.ok || data?.status !== 'success' || !data?.token) {
      return res.status(502).json({
        error: data?.reason || data?.err_msg || 'PayTR ödeme tokenı oluşturulamadı.',
        paytr: data
      });
    }

    return res.status(200).json({
      success: true,
      provider: 'paytr',
      iframe_token: data.token,
      checkout_url: `https://www.paytr.com/odeme/guvenli/${data.token}`,
      merchant_oid: merchantOid,
      secure_mode: '3d'
    });
  } catch (err) {
    console.error('Payment error:', err.message);
    return res.status(500).json({ error: 'Sunucu hatası: ' + err.message });
  }
};
