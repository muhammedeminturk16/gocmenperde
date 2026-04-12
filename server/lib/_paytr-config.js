const fs = require('fs');
const path = require('path');

let cachedDotEnvValues = null;

function stripInlineComment(value) {
  let quote = null;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if ((char === '"' || char === "'") && (i === 0 || value[i - 1] !== '\\')) {
      if (!quote) quote = char;
      else if (quote === char) quote = null;
    }
    if (char === '#' && !quote) return value.slice(0, i).trim();
  }
  return value.trim();
}

function unquote(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return value.slice(1, -1);
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
    if (key.startsWith('export ')) key = key.slice('export '.length).trim();
    value = unquote(stripInlineComment(value));
    values[key] = value;
  }
  return values;
}

function loadDotEnvValues() {
  if (cachedDotEnvValues) return cachedDotEnvValues;
  const envFiles = ['.env.local', '.env'];
  const mergedValues = {};
  for (const fileName of envFiles) {
    const filePath = path.join(process.cwd(), fileName);
    if (!fs.existsSync(filePath)) continue;
    try {
      const parsed = parseDotEnv(fs.readFileSync(filePath, 'utf8'));
      Object.assign(mergedValues, parsed);
    } catch (e) {}
  }
  cachedDotEnvValues = mergedValues;
  return cachedDotEnvValues;
}

// DÜZELTİLMİŞ FONKSİYON: Önce Vercel (process.env) verilerine bakar.
function resolveEnvValue(...keys) {
  // 1. Önce Vercel/Sistem değişkenlerini kontrol et
  for (const key of keys) {
    if (process.env[key] && process.env[key].trim()) {
      return process.env[key].trim();
    }
  }

  // 2. Sistemde yoksa .env dosyalarına bak
  const dotEnvValues = loadDotEnvValues();
  for (const key of keys) {
    if (dotEnvValues[key] && dotEnvValues[key].trim()) {
      return dotEnvValues[key].trim();
    }
  }

  return '';
}

function getPaytrCredentials() {
  const merchantId = resolveEnvValue('PAYTR_MERCHANT_ID', 'MERCHANT_ID', 'PAYTR_MERCHANTID');
  const merchantKey = resolveEnvValue('PAYTR_MERCHANT_KEY', 'MERCHANT_KEY', 'PAYTR_API_KEY');
  const merchantSalt = resolveEnvValue('PAYTR_MERCHANT_SALT', 'MERCHANT_SALT', 'PAYTR_API_SALT');

  // Hata ayıklama için (Vercel Logs kısmında değerlerin gelip gelmediğini görebilirsin)
  console.log("PayTR Değişken Kontrolü:", { 
    id: merchantId ? "DOLU" : "BOŞ", 
    key: merchantKey ? "DOLU" : "BOŞ", 
    salt: merchantSalt ? "DOLU" : "BOŞ" 
  });

  return {
    merchantId,
    merchantKey,
    merchantSalt,
    hasRequiredCredentials: Boolean(merchantId && merchantKey && merchantSalt)
  };
}

module.exports = { getPaytrCredentials };
