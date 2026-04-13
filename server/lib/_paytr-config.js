// server/lib/_paytr-config.js

const PAYTR_ENV_ALIASES = {
  id: [
    'PAYTR_MERCHANT_ID',
    'PAYTR_MERCHANT_NO',
    'MERCHANT_NO',
    'PAYTR_MERCHANTID',
    'PAYTR_ID',
    'MERCHANT_ID',
    'merchant_id',
    'NEXT_PUBLIC_PAYTR_MERCHANT_ID'
  ],
  key: [
    'PAYTR_MERCHANT_KEY',
    'PAYTR_MERCHANT_PASSWORD',
    'MERCHANT_PASSWORD',
    'PAYTR_API_KEY',
    'PAYTR_KEY',
    'MERCHANT_KEY',
    'merchant_key',
    'NEXT_PUBLIC_PAYTR_MERCHANT_KEY'
  ],
  salt: [
    'PAYTR_MERCHANT_SALT',
    'PAYTR_MERCHANT_SECRET',
    'MERCHANT_SECRET',
    'PAYTR_API_SALT',
    'PAYTR_SALT',
    'MERCHANT_SALT',
    'merchant_salt',
    'NEXT_PUBLIC_PAYTR_MERCHANT_SALT'
  ]
};

function pickFirstEnvValue(keys = []) {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) {
      return { value, source: key };
    }
  }
  return { value: '', source: '' };
}

module.exports = {
  getPaytrCredentials: () => {
    const id = pickFirstEnvValue(PAYTR_ENV_ALIASES.id);
    const key = pickFirstEnvValue(PAYTR_ENV_ALIASES.key);
    const salt = pickFirstEnvValue(PAYTR_ENV_ALIASES.salt);

    return {
      merchantId: id.value,
      merchantKey: key.value,
      merchantSalt: salt.value,
      hasRequiredCredentials: !!(id.value && key.value && salt.value),
      debugSources: {
        id: id.source || null,
        key: key.source || null,
        salt: salt.source || null
      }
    };
  }
};
