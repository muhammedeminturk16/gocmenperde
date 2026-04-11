const crypto = require('crypto');

const TOKEN_SECRET = String(process.env.AUTH_TOKEN_SECRET || 'gocmenperde-token-secret-change-me').trim();
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const LEGACY_SALT = 'gocmen_salt_2024';

function base64urlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64urlDecode(value) {
  return Buffer.from(value, 'base64url').toString();
}

function safeEqual(a, b) {
  const aBuf = Buffer.from(String(a));
  const bBuf = Buffer.from(String(b));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function signPayload(payload) {
  const body = base64urlEncode(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifySignedToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  if (!safeEqual(expected, signature)) return null;

  const decoded = JSON.parse(base64urlDecode(body));
  if (!decoded?.id || !decoded?.email || !decoded?.exp) return null;
  if (Date.now() > Number(decoded.exp)) return null;
  return decoded;
}

function parseLegacyToken(token) {
  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
    if (!decoded?.id || !decoded?.email) return null;
    return decoded;
  } catch {
    return null;
  }
}

function createAuthToken(user) {
  const now = Date.now();
  return signPayload({
    id: Number(user.id),
    email: String(user.email || '').toLowerCase(),
    iat: now,
    exp: now + TOKEN_TTL_MS,
    v: 2,
  });
}

function verifyAuthToken(req) {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return null;
    const raw = auth.slice(7).trim();
    return verifySignedToken(raw) || parseLegacyToken(raw);
  } catch {
    return null;
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const normalized = String(password || '');
  const hash = crypto.pbkdf2Sync(normalized, salt, 120000, 64, 'sha512').toString('hex');
  return `pbkdf2$${salt}$${hash}`;
}

function verifyPassword(password, storedHash = '') {
  const raw = String(storedHash || '');
  if (raw.startsWith('pbkdf2$')) {
    const [, salt, hash] = raw.split('$');
    if (!salt || !hash) return false;
    const next = crypto.pbkdf2Sync(String(password || ''), salt, 120000, 64, 'sha512').toString('hex');
    return safeEqual(next, hash);
  }

  const legacy = crypto.createHash('sha256').update(String(password || '') + LEGACY_SALT).digest('hex');
  return safeEqual(legacy, raw);
}

module.exports = {
  createAuthToken,
  verifyAuthToken,
  hashPassword,
  verifyPassword,
};
