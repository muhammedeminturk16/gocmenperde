const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  try {
    const isAllowedEmailDomain = (email = '') => /@(gmail\.com|hotmail\.com)$/i.test(String(email).trim());
    const isStrongPassword = (sifre = '') => /^(?=.*[A-Za-z])(?=.*\d).{6,}$/.test(String(sifre));

    // KAYIT
    if (action === 'register' && req.method === 'POST') {
      const { ad_soyad, email, telefon, sifre } = req.body;
      if (!ad_soyad || !email || !sifre)
        return res.status(400).json({ error: 'Ad soyad, email ve şifre zorunludur.' });
      if (!isAllowedEmailDomain(email))
        return res.status(400).json({ error: 'E-posta yalnızca @gmail.com veya @hotmail.com olabilir.' });
      if (!isStrongPassword(sifre))
        return res.status(400).json({ error: 'Şifre en az 6 karakter olmalı ve harf ile sayı içermelidir.' });

      const existing = await pool.query('SELECT id FROM musteriler WHERE email = $1', [email.toLowerCase()]);
      if (existing.rows.length > 0)
        return res.status(409).json({ error: 'Bu email zaten kayıtlı.' });

      const crypto = require('crypto');
      const sifre_hash = crypto.createHash('sha256').update(sifre + 'gocmen_salt_2024').digest('hex');

      const result = await pool.query(
        'INSERT INTO musteriler (ad_soyad, email, telefon, sifre_hash) VALUES ($1,$2,$3,$4) RETURNING id, ad_soyad, email, telefon, created_at',
        [ad_soyad, email.toLowerCase(), telefon || '', sifre_hash]
      );
      const user = result.rows[0];
      const token = Buffer.from(JSON.stringify({ id: user.id, email: user.email, ts: Date.now() })).toString('base64');
      return res.status(201).json({ success: true, token, user });
    }

    // GİRİŞ
    if (action === 'login' && req.method === 'POST') {
      const { email, sifre } = req.body;
      if (!email || !sifre)
        return res.status(400).json({ error: 'Email ve şifre zorunludur.' });

      const crypto = require('crypto');
      const sifre_hash = crypto.createHash('sha256').update(sifre + 'gocmen_salt_2024').digest('hex');

      const result = await pool.query(
        'SELECT * FROM musteriler WHERE email = $1 AND sifre_hash = $2',
        [email.toLowerCase(), sifre_hash]
      );
      if (!result.rows.length)
        return res.status(401).json({ error: 'Email veya şifre hatalı.' });

      const user = result.rows[0];
      const token = Buffer.from(JSON.stringify({ id: user.id, email: user.email, ts: Date.now() })).toString('base64');
      return res.status(200).json({ success: true, token, user: { id: user.id, ad_soyad: user.ad_soyad, email: user.email, telefon: user.telefon, created_at: user.created_at } });
    }

    // PROFİL
    if (action === 'profile' && req.method === 'GET') {
      const user = verifyToken(req);
      if (!user) return res.status(401).json({ error: 'Oturum geçersiz.' });
      const result = await pool.query(
        'SELECT id, ad_soyad, email, telefon, created_at FROM musteriler WHERE id = $1',
        [user.id]
      );
      if (!result.rows.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
      return res.status(200).json({ success: true, user: result.rows[0] });
    }

    // GÜNCELLE
    if (action === 'update' && req.method === 'PUT') {
      const user = verifyToken(req);
      if (!user) return res.status(401).json({ error: 'Oturum geçersiz.' });
      const { ad_soyad, telefon } = req.body;
      await pool.query('UPDATE musteriler SET ad_soyad = $1, telefon = $2 WHERE id = $3', [ad_soyad, telefon, user.id]);
      return res.status(200).json({ success: true });
    }

    // ŞİFRE DEĞİŞTİR
    if (action === 'change-password' && req.method === 'POST') {
      const user = verifyToken(req);
      if (!user) return res.status(401).json({ error: 'Oturum geçersiz.' });
      const { eski_sifre, yeni_sifre } = req.body;
      const crypto = require('crypto');
      const eski_hash = crypto.createHash('sha256').update(eski_sifre + 'gocmen_salt_2024').digest('hex');
      const result = await pool.query('SELECT id FROM musteriler WHERE id = $1 AND sifre_hash = $2', [user.id, eski_hash]);
      if (!result.rows.length) return res.status(401).json({ error: 'Mevcut şifre hatalı.' });
      if (!isStrongPassword(yeni_sifre)) return res.status(400).json({ error: 'Yeni şifre en az 6 karakter olmalı, harf ve sayı içermelidir.' });
      const yeni_hash = crypto.createHash('sha256').update(yeni_sifre + 'gocmen_salt_2024').digest('hex');
      await pool.query('UPDATE musteriler SET sifre_hash = $1 WHERE id = $2', [yeni_hash, user.id]);
      return res.status(200).json({ success: true });
    }

    // ADRESLER
    if (action === 'addresses' && req.method === 'GET') {
      const user = verifyToken(req);
      if (!user) return res.status(401).json({ error: 'Oturum geçersiz.' });
      const result = await pool.query('SELECT * FROM adresler WHERE musteri_id = $1 ORDER BY created_at DESC', [user.id]);
      return res.status(200).json({ success: true, addresses: result.rows });
    }

    if (action === 'add-address' && req.method === 'POST') {
      const user = verifyToken(req);
      if (!user) return res.status(401).json({ error: 'Oturum geçersiz.' });
      const { baslik, adres } = req.body;
      if (!baslik || !adres) return res.status(400).json({ error: 'Başlık ve adres zorunludur.' });

      const parts = String(adres)
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean);
      if (parts.length < 5) {
        return res.status(400).json({ error: 'Adres; mahalle, sokak/cadde, kapı numarası, ilçe ve il bilgileri ile girilmelidir.' });
      }

      await pool.query('INSERT INTO adresler (musteri_id, baslik, adres) VALUES ($1,$2,$3)', [user.id, baslik, adres]);
      return res.status(201).json({ success: true });
    }

    if (action === 'delete-address' && req.method === 'POST') {
      const user = verifyToken(req);
      if (!user) return res.status(401).json({ error: 'Oturum geçersiz.' });
      const { id } = req.body;
      await pool.query('DELETE FROM adresler WHERE id = $1 AND musteri_id = $2', [id, user.id]);
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Geçersiz işlem.' });

  } catch (err) {
    console.error('Auth error:', err.message);
    return res.status(500).json({ error: 'Sunucu hatası: ' + err.message });
  }
};

function verifyToken(req) {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return null;
    const decoded = JSON.parse(Buffer.from(auth.slice(7), 'base64').toString());
    if (!decoded.id || !decoded.email) return null;
    return decoded;
  } catch { return null; }
}
