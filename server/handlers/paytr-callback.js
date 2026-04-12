const crypto = require('crypto');
const { getPaytrCredentials } = require('../lib/_paytr-config');

function normalizeCallbackBody(body) {
  if (!body) return {};

  if (typeof body === 'string') {
    const params = new URLSearchParams(body);
    return Object.fromEntries(params.entries());
  }

  if (body instanceof URLSearchParams) {
    return Object.fromEntries(body.entries());
  }

  if (typeof body === 'object') {
    return body;
  }

  return {};
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('METHOD_NOT_ALLOWED');
  }

  const { merchantKey, merchantSalt, hasRequiredCredentials } = getPaytrCredentials();

  if (!hasRequiredCredentials) {
    return res.status(500).send('ENV_MISSING');
  }

  try {
    const callback = normalizeCallbackBody(req.body);

    if (!callback.merchant_oid || !callback.status || !callback.total_amount || !callback.hash) {
      return res.status(400).send('BAD_REQUEST');
    }

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
