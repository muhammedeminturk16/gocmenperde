import { neon } from ‘@neondatabase/serverless’;
import bcrypt from ‘bcryptjs’;
import jwt from ‘jsonwebtoken’;

const sql = neon(process.env.DATABASE_URL);
const JWT_SECRET = process.env.JWT_SECRET || ‘gocmen-perde-secret-2024’;

export default async function handler(req, res) {
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);
res.setHeader(‘Access-Control-Allow-Methods’, ‘GET, POST, PUT, OPTIONS’);
res.setHeader(‘Access-Control-Allow-Headers’, ‘Content-Type, Authorization’);
if (req.method === ‘OPTIONS’) return res.status(200).end();

const { action } = req.query;

try {
// ── KAYIT ──
if (action === ‘register’ && req.method === ‘POST’) {
const { ad_soyad, email, telefon, sifre } = req.body;
if (!ad_soyad || !email || !sifre)
return res.status(400).json({ error: ‘Ad soyad, email ve şifre zorunludur.’ });
if (sifre.length < 6)
return res.status(400).json({ error: ‘Şifre en az 6 karakter olmalıdır.’ });

```
  const existing = await sql`SELECT id FROM musteriler WHERE email = ${email}`;
  if (existing.length > 0)
    return res.status(409).json({ error: 'Bu email zaten kayıtlı.' });

  const sifre_hash = await bcrypt.hash(sifre, 10);
  const result = await sql`
    INSERT INTO musteriler (ad_soyad, email, telefon, sifre_hash)
    VALUES (${ad_soyad}, ${email.toLowerCase()}, ${telefon || ''}, ${sifre_hash})
    RETURNING id, ad_soyad, email, telefon, created_at
  `;
  const user = result[0];
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
  return res.status(201).json({ success: true, token, user });
}

// ── GİRİŞ ──
if (action === 'login' && req.method === 'POST') {
  const { email, sifre } = req.body;
  if (!email || !sifre)
    return res.status(400).json({ error: 'Email ve şifre zorunludur.' });

  const result = await sql`SELECT * FROM musteriler WHERE email = ${email.toLowerCase()}`;
  if (!result.length)
    return res.status(401).json({ error: 'Email veya şifre hatalı.' });

  const user = result[0];
  const valid = await bcrypt.compare(sifre, user.sifre_hash);
  if (!valid)
    return res.status(401).json({ error: 'Email veya şifre hatalı.' });

  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
  const { sifre_hash, ...safeUser } = user;
  return res.status(200).json({ success: true, token, user: safeUser });
}

// ── PROFİL GETİR ──
if (action === 'profile' && req.method === 'GET') {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Oturum geçersiz.' });

  const result = await sql`
    SELECT id, ad_soyad, email, telefon, created_at FROM musteriler WHERE id = ${user.id}
  `;
  if (!result.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
  return res.status(200).json({ success: true, user: result[0] });
}

// ── PROFİL GÜNCELLE ──
if (action === 'update' && req.method === 'PUT') {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Oturum geçersiz.' });

  const { ad_soyad, telefon } = req.body;
  await sql`
    UPDATE musteriler SET ad_soyad = ${ad_soyad}, telefon = ${telefon} WHERE id = ${user.id}
  `;
  return res.status(200).json({ success: true });
}

// ── ŞİFRE DEĞİŞTİR ──
if (action === 'change-password' && req.method === 'POST') {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Oturum geçersiz.' });

  const { eski_sifre, yeni_sifre } = req.body;
  const result = await sql`SELECT sifre_hash FROM musteriler WHERE id = ${user.id}`;
  if (!result.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });

  const valid = await bcrypt.compare(eski_sifre, result[0].sifre_hash);
  if (!valid) return res.status(401).json({ error: 'Mevcut şifre hatalı.' });
  if (yeni_sifre.length < 6) return res.status(400).json({ error: 'Yeni şifre en az 6 karakter olmalı.' });

  const hash = await bcrypt.hash(yeni_sifre, 10);
  await sql`UPDATE musteriler SET sifre_hash = ${hash} WHERE id = ${user.id}`;
  return res.status(200).json({ success: true });
}

// ── ADRESLER ──
if (action === 'addresses' && req.method === 'GET') {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Oturum geçersiz.' });
  const result = await sql`SELECT * FROM adresler WHERE musteri_id = ${user.id} ORDER BY created_at DESC`;
  return res.status(200).json({ success: true, addresses: result });
}

if (action === 'add-address' && req.method === 'POST') {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Oturum geçersiz.' });
  const { baslik, adres } = req.body;
  if (!baslik || !adres) return res.status(400).json({ error: 'Başlık ve adres zorunludur.' });
  await sql`INSERT INTO adresler (musteri_id, baslik, adres) VALUES (${user.id}, ${baslik}, ${adres})`;
  return res.status(201).json({ success: true });
}

if (action === 'delete-address' && req.method === 'POST') {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Oturum geçersiz.' });
  const { id } = req.body;
  await sql`DELETE FROM adresler WHERE id = ${id} AND musteri_id = ${user.id}`;
  return res.status(200).json({ success: true });
}

return res.status(400).json({ error: 'Geçersiz işlem.' });
```

} catch (err) {
console.error(‘Auth error:’, err);
return res.status(500).json({ error: ’Sunucu hatası: ’ + err.message });
}
}

function verifyToken(req) {
try {
const auth = req.headers.authorization;
if (!auth || !auth.startsWith(’Bearer ’)) return null;
return jwt.verify(auth.slice(7), JWT_SECRET);
} catch { return null; }
}