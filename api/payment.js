const crypto = require('crypto');
const { getPaytrCredentials } = require('./_paytr-config');

const SUPPORTED_CURRENCIES = new Set(['TL', 'USD', 'EUR', 'GBP']);

function getClientIp(req) {
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (typeof xForwardedFor === 'string' && xForwardedFor.trim()) {
    return xForwardedFor.split(',')[0].trim();
  }
  const xRealIp = req.headers['x-real-ip'];
  if (typeof xRealIp === 'string' && xRealIp.trim()) {
    return xRealIp.trim();
  }
  return req.socket?.remoteAddress || req.connection?.remoteAddress || '127.0.0.1';
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
    const userEmail = String(customer.email || '').trim().toLowerCase() || 'musteri@example.com';
    const customerName = String(userName || customer.name || 'Müşteri').slice(0, 60);
    const customerPhone = String(customer.phone || '05000000000').replace(/[^\d+]/g, '').slice(0, 20) || '05000000000';
    const customerAddress = String(shippingAddress || orderNote || 'Adres belirtilmedi').slice(0, 400);

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
    params.set('merchant_ok_url', successUrl || 'https://example.com/?payment=success');
    params.set('merchant_fail_url', cancelUrl || 'https://example.com/?payment=cancel');
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

    const paytrResponse = await fetch('https://www.paytr.com/odeme/api/get-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });

    const data = await paytrResponse.json();

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
      merchant_oid: merchantOid
    });
  } catch (err) {
    console.error('Payment error:', err.message);
    return res.status(500).json({ error: 'Sunucu hatası: ' + err.message });
  }
};
