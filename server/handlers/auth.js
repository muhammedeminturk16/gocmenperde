const { createAuthToken, verifyAuthToken, hashPassword, verifyPassword } = require('../lib/_auth-utils');

const { pool } = require('../lib/_db');
const loginAttempts = new Map();
const MAX_ATTEMPTS = 7;
const WINDOW_MS = 1000 * 60 * 10;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  try {
    const isAllowedEmailDomain = (email = '') => /@(gmail\.com|hotmail\.com)$/i.test(String(email).trim());
    const isStrongPassword = (sifre = '') => /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(String(sifre));

    if (action === 'register' && req.method === 'POST') {
      const { ad_soyad, email, telefon, sifre } = req.body || {};
      if (!ad_soyad || !email || !sifre)
        return res.status(400).json({ error: 'Ad soyad, email ve şifre zorunludur.' });
      if (!isAllowedEmailDomain(email))
        return res.status(400).json({ error: 'E-posta yalnızca @gmail.com veya @hotmail.com olabilir.' });
      if (!isStrongPassword(sifre))
        return res.status(400).json({ error: 'Şifre en az 8 karakter olmalı ve harf ile sayı içermelidir.' });

      const safeEmail = String(email).trim().toLowerCase();
      const existing = await pool.query('SELECT id FROM musteriler WHERE email = $1', [safeEmail]);
      if (existing.rows.length > 0)
        return res.status(409).json({ error: 'Bu email zaten kayıtlı.' });

      const sifre_hash = hashPassword(sifre);
      const result = await pool.query(
        'INSERT INTO musteriler (ad_soyad, email, telefon, sifre_hash) VALUES ($1,$2,$3,$4) RETURNING id, ad_soyad, email, telefon, created_at',
        [ad_soyad, safeEmail, telefon || '', sifre_hash]
      );
      const user = result.rows[0];
      const token = createAuthToken(user);
      return res.status(201).json({ success: true, token, user });
    }

    if (action === 'login' && req.method === 'POST') {
      const { email, sifre } = req.body || {};
      if (!email || !sifre)
        return res.status(400).json({ error: 'Email ve şifre zorunludur.' });

      const safeEmail = String(email).trim().toLowerCase();
      const key = `${safeEmail}:${String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')}`;
      const now = Date.now();
      const bucket = loginAttempts.get(key) || { count: 0, resetAt: now + WINDOW_MS };
      if (now > bucket.resetAt) {
        bucket.count = 0;
        bucket.resetAt = now + WINDOW_MS;
      }
      if (bucket.count >= MAX_ATTEMPTS) {
        return res.status(429).json({ error: 'Çok fazla deneme yapıldı. Lütfen 10 dakika sonra tekrar deneyin.' });
      }

      const result = await pool.query('SELECT * FROM musteriler WHERE email = $1 LIMIT 1', [safeEmail]);
      if (!result.rows.length) {
        bucket.count += 1;
        loginAttempts.set(key, bucket);
        return res.status(401).json({ error: 'Email veya şifre hatalı.' });
      }

      const user = result.rows[0];
      const validPassword = verifyPassword(sifre, user.sifre_hash);
      if (!validPassword) {
        bucket.count += 1;
        loginAttempts.set(key, bucket);
        return res.status(401).json({ error: 'Email veya şifre hatalı.' });
      }

      loginAttempts.delete(key);

      if (!String(user.sifre_hash || '').startsWith('pbkdf2$')) {
        await pool.query('UPDATE musteriler SET sifre_hash = $1 WHERE id = $2', [hashPassword(sifre), user.id]);
      }

      const token = createAuthToken(user);
      return res.status(200).json({
        success: true,
        token,
        user: { id: user.id, ad_soyad: user.ad_soyad, email: user.email, telefon: user.telefon, created_at: user.created_at },
      });
    }

    if (action === 'profile' && req.method === 'GET') {
      const user = verifyAuthToken(req);
      if (!user) return res.status(401).json({ error: 'Oturum geçersiz.' });
      const result = await pool.query(
        'SELECT id, ad_soyad, email, telefon, created_at FROM musteriler WHERE id = $1',
        [user.id]
      );
      if (!result.rows.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
      return res.status(200).json({ success: true, user: result.rows[0] });
    }

    if (action === 'update' && req.method === 'PUT') {
      const user = verifyAuthToken(req);
      if (!user) return res.status(401).json({ error: 'Oturum geçersiz.' });
      const { ad_soyad, telefon } = req.body || {};
      if (!ad_soyad) return res.status(400).json({ error: 'Ad soyad zorunludur.' });
      await pool.query('UPDATE musteriler SET ad_soyad = $1, telefon = $2 WHERE id = $3', [ad_soyad, telefon || '', user.id]);
      return res.status(200).json({ success: true });
    }

    if (action === 'change-password' && req.method === 'POST') {
      const user = verifyAuthToken(req);
      if (!user) return res.status(401).json({ error: 'Oturum geçersiz.' });
      const { eski_sifre, yeni_sifre } = req.body || {};
      if (!eski_sifre || !yeni_sifre) return res.status(400).json({ error: 'Mevcut ve yeni şifre zorunludur.' });

      const result = await pool.query('SELECT id, sifre_hash FROM musteriler WHERE id = $1 LIMIT 1', [user.id]);
      if (!result.rows.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });

      const row = result.rows[0];
      if (!verifyPassword(eski_sifre, row.sifre_hash)) return res.status(401).json({ error: 'Mevcut şifre hatalı.' });
      if (!isStrongPassword(yeni_sifre)) return res.status(400).json({ error: 'Yeni şifre en az 8 karakter olmalı, harf ve sayı içermelidir.' });
      await pool.query('UPDATE musteriler SET sifre_hash = $1 WHERE id = $2', [hashPassword(yeni_sifre), user.id]);
      return res.status(200).json({ success: true });
    }

    if (action === 'addresses' && req.method === 'GET') {
      const user = verifyAuthToken(req);
      if (!user) return res.status(401).json({ error: 'Oturum geçersiz.' });
      const result = await pool.query('SELECT * FROM adresler WHERE musteri_id = $1 ORDER BY created_at DESC', [user.id]);
      return res.status(200).json({ success: true, addresses: result.rows });
    }

    if (action === 'add-address' && req.method === 'POST') {
      const user = verifyAuthToken(req);
      if (!user) return res.status(401).json({ error: 'Oturum geçersiz.' });
      const { baslik, adres } = req.body || {};
      if (!baslik || !adres) return res.status(400).json({ error: 'Başlık ve adres zorunludur.' });

      const parts = String(adres).split('\n').map((x) => x.trim()).filter(Boolean);
      if (parts.length < 5) {
        return res.status(400).json({ error: 'Adres; mahalle, sokak/cadde, kapı numarası, ilçe ve il bilgileri ile girilmelidir.' });
      }

      await pool.query('INSERT INTO adresler (musteri_id, baslik, adres) VALUES ($1,$2,$3)', [user.id, baslik, adres]);
      return res.status(201).json({ success: true });
    }

    if (action === 'delete-address' && req.method === 'POST') {
      const user = verifyAuthToken(req);
      if (!user) return res.status(401).json({ error: 'Oturum geçersiz.' });
      const { id } = req.body || {};
      await pool.query('DELETE FROM adresler WHERE id = $1 AND musteri_id = $2', [id, user.id]);
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Geçersiz işlem.' });
  } catch (err) {
    console.error('Auth error:', err.message);
    return res.status(500).json({ error: 'Sunucu hatası.' });
  }
};
