const fs = require('fs');
const path = require('path');

let cachedDotEnvValues = null;

const DEFAULT_PAYTR_CREDENTIALS = {
  merchantId: '690414',
  merchantKey: 'qiyTzuAETF2mB8pk',
  merchantSalt: '4o3qjuMhFhc7DpQH'
};


function stripInlineComment(value) {
  let quote = null;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if ((char === '"' || char === "'") && (i === 0 || value[i - 1] !== '\\')) {
      if (!quote) {
        quote = char;
      } else if (quote === char) {
        quote = null;
      }
    }
    if (char === '#' && !quote) {
      return value.slice(0, i).trim();
    }
  }
  return value.trim();
}

function unquote(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function parseDotEnv(content) {
  const values = {};
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;

    let key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (key.startsWith('export ')) {
      key = key.slice('export '.length).trim();
    }

    value = unquote(stripInlineComment(value));
    values[key] = value;
  }

  return values;
}

function loadDotEnvValues() {
  if (cachedDotEnvValues) {
    return cachedDotEnvValues;
  }

  const envFiles = ['.env.local', '.env'];
  const mergedValues = {};

  for (const fileName of envFiles) {
    const filePath = path.join(process.cwd(), fileName);
    if (!fs.existsSync(filePath)) continue;

    try {
      const parsed = parseDotEnv(fs.readFileSync(filePath, 'utf8'));
      Object.assign(mergedValues, parsed);
    } catch {
      // ignore parse/read errors and keep trying other sources
    }
  }

  cachedDotEnvValues = mergedValues;
  return cachedDotEnvValues;
}

function resolveEnvValue(...keys) {
  const dotEnvValues = loadDotEnvValues();

  for (const key of keys) {
    const processValue = process.env[key];
    if (typeof processValue === 'string' && processValue.trim()) {
      return processValue.trim();
    }

    const dotEnvValue = dotEnvValues[key];
    if (typeof dotEnvValue === 'string' && dotEnvValue.trim()) {
      return dotEnvValue.trim();
    }
  }

  return '';
}
function getPaytrCredentials() {
  const merchantId = resolveEnvValue(
    'PAYTR_MERCHANT_ID',
    'PAYTR_MERCHANT_NO',
    'MERCHANT_NO',
    'PAYTR_MERCHANTID',
    'PAYTR_ID',
    'MERCHANT_ID',
    'merchant_id'
  );

  const merchantKey = resolveEnvValue(
    'PAYTR_MERCHANT_KEY',
    'PAYTR_MERCHANT_PASSWORD',
    'MERCHANT_PASSWORD',
    'PAYTR_API_KEY',
    'PAYTR_KEY',
    'MERCHANT_KEY',
    'merchant_key'
  );

  const merchantSalt = resolveEnvValue(
    'PAYTR_MERCHANT_SALT',
    'PAYTR_MERCHANT_SECRET',
    'MERCHANT_SECRET',
    'PAYTR_API_SALT',
    'PAYTR_SALT',
    'MERCHANT_SALT',
    'merchant_salt'
  );

  const resolvedMerchantId = merchantId || DEFAULT_PAYTR_CREDENTIALS.merchantId;
  const resolvedMerchantKey = merchantKey || DEFAULT_PAYTR_CREDENTIALS.merchantKey;
  const resolvedMerchantSalt = merchantSalt || DEFAULT_PAYTR_CREDENTIALS.merchantSalt;

  return {
    merchantId: resolvedMerchantId,
    merchantKey: resolvedMerchantKey,
    merchantSalt: resolvedMerchantSalt,
    hasRequiredCredentials: Boolean(resolvedMerchantId && resolvedMerchantKey && resolvedMerchantSalt)
  };
}

module.exports = {
  getPaytrCredentials
};
