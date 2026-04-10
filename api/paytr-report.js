const crypto = require('crypto');
const { getPaytrCredentials } = require('./_paytr-config');

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const MAX_RANGE_MS = 3 * 24 * 60 * 60 * 1000;

function parseDateString(value) {
  if (!DATE_FORMAT.test(value)) return null;
  const normalized = value.replace(' ', 'T') + 'Z';
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  return date;
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
  if (action !== 'transaction-report') {
    return res.status(400).json({ error: 'Geçersiz işlem. action=transaction-report kullanın.' });
  }

  const { merchantId, merchantKey, merchantSalt, hasRequiredCredentials } = getPaytrCredentials();

  if (!hasRequiredCredentials) {
    return res.status(500).json({
      error: 'PAYTR_MERCHANT_ID, PAYTR_MERCHANT_KEY, PAYTR_MERCHANT_SALT ortam değişkenleri zorunludur.'
    });
  }

  try {
    const { start_date: startDate, end_date: endDate, dummy = 0 } = req.body || {};

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'start_date ve end_date zorunludur.' });
    }

    const parsedStart = parseDateString(String(startDate));
    const parsedEnd = parseDateString(String(endDate));

    if (!parsedStart || !parsedEnd) {
      return res.status(400).json({
        error: 'Tarih formatı geçersiz. YYYY-MM-DD hh:mm:ss formatında gönderin.'
      });
    }

    if (parsedEnd < parsedStart) {
      return res.status(400).json({ error: 'end_date, start_date değerinden küçük olamaz.' });
    }

    if (parsedEnd.getTime() - parsedStart.getTime() > MAX_RANGE_MS) {
      return res.status(400).json({ error: 'En fazla 3 günlük tarih aralığı gönderebilirsiniz.' });
    }

    const rawToken = `${merchantId}${startDate}${endDate}${merchantSalt}`;
    const paytrToken = crypto.createHmac('sha256', merchantKey).update(rawToken).digest('base64');

    const payload = new URLSearchParams({
      merchant_id: String(merchantId),
      start_date: String(startDate),
      end_date: String(endDate),
      paytr_token: paytrToken,
      dummy: String(Number(dummy) === 1 ? 1 : 0)
    });

    const response = await fetch('https://www.paytr.com/rapor/islem-dokumu', {
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

    if (data.status === 'failed') {
      return res.status(200).json({
        success: false,
        message: 'İlgili tarih aralığında işlem bulunamadı.',
        paytr: data
      });
    }

    return res.status(400).json({ success: false, error: data.err_msg || 'PayTR hata döndürdü.', paytr: data });
  } catch (error) {
    console.error('PayTR transaction report error:', error.message);
    return res.status(500).json({ error: 'Sunucu hatası: ' + error.message });
  }
};
