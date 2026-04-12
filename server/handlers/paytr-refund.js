const crypto = require('crypto');
const { getPaytrCredentials } = require('../lib/_paytr-config');

const REFUND_AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;
const ORDER_ID_MAX_LENGTH = 64;
const REFERENCE_NO_MAX_LENGTH = 64;
const REFERENCE_NO_PATTERN = /^[a-zA-Z0-9_-]+$/;

function normalizeRefundAmount(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim().replace(',', '.');
  if (!REFUND_AMOUNT_PATTERN.test(str)) return null;
  const amount = Number(str);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount.toFixed(2);
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
  if (action !== 'refund') {
    return res.status(400).json({ error: 'Geçersiz işlem. action=refund kullanın.' });
  }

  const { merchantId, merchantKey, merchantSalt, hasRequiredCredentials } = getPaytrCredentials();

  if (!hasRequiredCredentials) {
    return res.status(500).json({
      error: 'PAYTR_MERCHANT_ID, PAYTR_MERCHANT_KEY, PAYTR_MERCHANT_SALT ortam değişkenleri zorunludur.'
    });
  }

  try {
    const { merchant_oid: merchantOid, return_amount: returnAmount, reference_no: referenceNo } = req.body || {};

    if (!merchantOid) {
      return res.status(400).json({ error: 'merchant_oid zorunludur.' });
    }

    const normalizedMerchantOid = String(merchantOid).trim();
    if (normalizedMerchantOid.length === 0 || normalizedMerchantOid.length > ORDER_ID_MAX_LENGTH) {
      return res.status(400).json({
        error: `merchant_oid 1-${ORDER_ID_MAX_LENGTH} karakter aralığında olmalıdır.`
      });
    }

    const normalizedAmount = normalizeRefundAmount(returnAmount);
    if (!normalizedAmount) {
      return res.status(400).json({
        error: 'return_amount geçersiz. Pozitif ve en fazla 2 ondalıklı sayı girin (ör: 11.97).'
      });
    }

    let normalizedReferenceNo = '';
    if (referenceNo !== undefined && referenceNo !== null && String(referenceNo).trim() !== '') {
      normalizedReferenceNo = String(referenceNo).trim();
      if (normalizedReferenceNo.length > REFERENCE_NO_MAX_LENGTH) {
        return res.status(400).json({
          error: `reference_no en fazla ${REFERENCE_NO_MAX_LENGTH} karakter olabilir.`
        });
      }
      if (!REFERENCE_NO_PATTERN.test(normalizedReferenceNo)) {
        return res.status(400).json({
          error: 'reference_no sadece harf, rakam, alt çizgi (_) ve tire (-) içerebilir.'
        });
      }
    }

    const rawToken = `${merchantId}${normalizedMerchantOid}${normalizedAmount}${merchantSalt}`;
    const paytrToken = crypto.createHmac('sha256', merchantKey).update(rawToken).digest('base64');

    const payload = new URLSearchParams({
      merchant_id: String(merchantId),
      merchant_oid: normalizedMerchantOid,
      return_amount: normalizedAmount,
      paytr_token: paytrToken
    });

    if (normalizedReferenceNo) {
      payload.set('reference_no', normalizedReferenceNo);
    }

    const response = await fetch('https://www.paytr.com/odeme/iade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payload
    });

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(502).json({ error: 'PayTR cevabı JSON değil.', raw: text });
    }

    if (!response.ok) {
      return res.status(502).json({ error: 'PayTR isteği başarısız.', paytr: data });
    }

    if (data.status === 'success') {
      return res.status(200).json({ success: true, paytr: data });
    }

    return res.status(400).json({
      success: false,
      error: data.err_msg || 'PayTR iade işlemini başarısız döndürdü.',
      err_no: data.err_no || null,
      paytr: data
    });
  } catch (error) {
    console.error('PayTR refund error:', error.message);
    return res.status(500).json({ error: 'Sunucu hatası: ' + error.message });
  }
};
