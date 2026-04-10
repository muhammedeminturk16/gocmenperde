const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('METHOD_NOT_ALLOWED');
  }

  const merchantKey = process.env.PAYTR_MERCHANT_KEY;
  const merchantSalt = process.env.PAYTR_MERCHANT_SALT;

  if (!merchantKey || !merchantSalt) {
    return res.status(500).send('ENV_MISSING');
  }

  try {
    const callback = req.body || {};
    const raw = `${callback.merchant_oid || ''}${merchantSalt}${callback.status || ''}${callback.total_amount || ''}`;
    const token = crypto.createHmac('sha256', merchantKey).update(raw).digest('base64');

    if (token !== callback.hash) {
      return res.status(400).send('BAD_HASH');
    }

    // TODO: Burada merchant_oid ile siparişi bulup status=success ise ödenmiş olarak işaretleyin.
    // TODO: Aynı sipariş için tekrarlı callback geldiğinde idempotent davranın.

    return res.status(200).send('OK');
  } catch (err) {
    console.error('PAYTR callback error:', err.message);
    return res.status(500).send('ERROR');
  }
};
