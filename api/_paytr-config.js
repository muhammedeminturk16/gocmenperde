function resolveEnvValue(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function getPaytrCredentials() {
  const merchantId = resolveEnvValue(
    'PAYTR_MERCHANT_ID',
    'PAYTR_MERCHANT_NO',
    'PAYTR_MERCHANTID',
    'PAYTR_ID',
    'MERCHANT_ID',
    'merchant_id'
  );

  const merchantKey = resolveEnvValue(
    'PAYTR_MERCHANT_KEY',
    'PAYTR_API_KEY',
    'PAYTR_KEY',
    'MERCHANT_KEY',
    'merchant_key'
  );

  const merchantSalt = resolveEnvValue(
    'PAYTR_MERCHANT_SALT',
    'PAYTR_API_SALT',
    'PAYTR_SALT',
    'MERCHANT_SALT',
    'merchant_salt'
  );

  return {
    merchantId,
    merchantKey,
    merchantSalt,
    hasRequiredCredentials: Boolean(merchantId && merchantKey && merchantSalt)
  };
}

module.exports = {
  getPaytrCredentials
};
