const crypto = require('crypto');
const net = require('net');
const { getPaytrCredentials } = require('../lib/_paytr-config');

function safeString(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function normalizeEmail(value = '') {
  const email = safeString(value).toLowerCase();
  if (!email) return 'bilgi@gocmenperde.com.tr';
  return email.length > 120 ? email.slice(0, 120) : email;
}

function normalizePhone(value = '') {
  const digits = safeString(value).replace(/\D+/g, '');
  if (!digits) return '05000000000';
  if (digits.length === 10) return `0${digits}`;
  if (digits.length > 11) return digits.slice(-11);
  return digits;
}

function normalizeAddress(value = '') {
  return safeString(value, 'Türkiye')
    .replace(/\n+/g, ', ')
    .replace(/\s+/g, ' ')
    .slice(0, 200);
}

function toMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.round(number * 100) / 100;
}

function formatMoney(value) {
  return toMoney(value).toFixed(2);
}

function buildPaytrBasket(items = []) {
  const basket = items.map((item) => [
    safeString(item?.name, 'Ürün').slice(0, 100),
    formatMoney(item?.price),
    Math.max(1, Number(item?.qty || 1)),
  ]);
  return Buffer.from(JSON.stringify(basket), 'utf8').toString('base64');
}

function pickClientIp(req) {
  const rawForwarded = safeString(req.headers['x-forwarded-for']);
  const forwardedIps = rawForwarded ? rawForwarded.split(',').map((v) => safeString(v)).filter(Boolean) : [];
  const raw = forwardedIps[0] || safeString(req.socket?.remoteAddress);
  const normalized = raw.replace('::ffff:', '');
  if (net.isIP(normalized) === 4) return normalized;
  if (normalized === '::1') return '127.0.0.1';
  const configuredFallback = safeString(process.env.PAYTR_FALLBACK_CLIENT_IP, '127.0.0.1');
  return net.isIP(configuredFallback) === 4 ? configuredFallback : '127.0.0.1';
}

async function parsePaytrResponse(response) {
  const rawBody = await response.text();
  if (!rawBody) {
    return { payload: null, parseError: 'empty_response', rawBody: '' };
  }
  try {
    return { payload: JSON.parse(rawBody), parseError: null, rawBody };
  } catch (error) {
    return { payload: null, parseError: safeString(error.message, 'invalid_json'), rawBody };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { merchantId, merchantKey, merchantSalt, hasRequiredCredentials } = getPaytrCredentials();
  if (!hasRequiredCredentials) return res.status(500).json({ error: 'PayTR anahtarları eksik.' });

  try {
    const { items = [], customer = {}, successUrl, cancelUrl, currency = 'TL', shippingAddress = '' } = req.body || {};
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Sepet boş görünüyor.' });

    const normalizedItems = items
      .map((item) => ({
        name: safeString(item?.name, 'Ürün'),
        qty: Math.max(1, Number(item?.qty || 1)),
        price: toMoney(item?.price),
      }))
      .filter((item) => item.price > 0);
    if (!normalizedItems.length) return res.status(400).json({ error: 'Sepette geçerli ürün bulunamadı.' });

    const paymentAmount = normalizedItems.reduce((sum, item) => sum + Math.round(item.price * 100) * item.qty, 0);
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      return res.status(400).json({ error: 'Ödeme tutarı hesaplanamadı.' });
    }

    const userIp = pickClientIp(req);
    const merchantOid = `GP${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const userBasket = buildPaytrBasket(normalizedItems);
    const userEmail = normalizeEmail(customer.email);
    const userName = safeString(customer.name, 'Müşteri').slice(0, 60);
    const userPhone = normalizePhone(customer.phone);
    const userAddress = normalizeAddress(shippingAddress || customer.address || 'Türkiye');
    const okUrl = safeString(successUrl, 'https://gocmenperde.com.tr');
    const failUrl = safeString(cancelUrl, 'https://gocmenperde.com.tr');

    const testMode = '0';
    const debugOn = process.env.NODE_ENV === 'production' ? '0' : '1';
    const noInstallment = '0';
    const maxInstallment = '0';
    const timeoutLimit = '30';
    const paytrCurrency = safeString(currency, 'TL').toUpperCase();

    const hashString =
      merchantId +
      userIp +
      merchantOid +
      userEmail +
      String(paymentAmount) +
      userBasket +
      noInstallment +
      maxInstallment +
      paytrCurrency +
      testMode +
      merchantSalt;
    const paytrToken = crypto.createHmac('sha256', merchantKey).update(hashString).digest('base64');

    const params = new URLSearchParams({
      merchant_id: merchantId,
      user_ip: userIp,
      merchant_oid: merchantOid,
      email: userEmail,
      payment_amount: String(paymentAmount),
      paytr_token: paytrToken,
      user_basket: userBasket,
      debug_on: debugOn,
      test_mode: testMode,
      no_installment: noInstallment,
      max_installment: maxInstallment,
      user_name: userName,
      user_address: userAddress,
      user_phone: userPhone,
      merchant_ok_url: okUrl,
      merchant_fail_url: failUrl,
      timeout_limit: timeoutLimit,
      currency: paytrCurrency,
    });

    const response = await fetch('https://www.paytr.com/odeme/api/get-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const { payload: result, parseError, rawBody } = await parsePaytrResponse(response);
    if (parseError) {
      return res.status(502).json({
        error: 'PayTR cevabı okunamadı. Lütfen mağaza yöneticisine bildirin.',
        detail: parseError,
        paytr_http_status: response.status,
        paytr_raw_preview: safeString(rawBody).slice(0, 500),
      });
    }

    if (result?.status === 'success' && result?.token) {
      return res.status(200).json({
        success: true,
        token: result.token,
        checkout_url: `https://www.paytr.com/odeme/guvenli/${result.token}`,
      });
    }

    const reason = safeString(result?.reason || result?.err_msg || 'PayTR hata döndürdü.');
    return res.status(response.ok ? 400 : 502).json({
      error: `PayTR Reddi: ${reason}`,
      paytr: result || null,
      paytr_http_status: response.status,
    });
  } catch (err) {
    console.error('create-paytr-token error:', err);
    return res.status(500).json({ error: `Ödeme altyapısı hatası: ${safeString(err.message, 'unknown_error')}` });
  }
};
