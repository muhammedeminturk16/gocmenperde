const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const ADMIN_API_KEY = 'gocmen1993';
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.headers['x-admin-key'] !== ADMIN_API_KEY) {
    return res.status(403).json({ error: 'Yetkisiz.' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Desteklenmeyen method.' });
  }

  try {
    const body = req.body || {};
    const dataUrl = String(body.dataUrl || '').trim();
    if (!dataUrl.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Geçersiz görsel verisi.' });
    }

    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return res.status(400).json({ error: 'Görsel verisi çözümlenemedi.' });
    const mime = m[1].toLowerCase();
    if (!ALLOWED_MIME.has(mime)) return res.status(400).json({ error: 'Desteklenmeyen görsel türü.' });

    const buffer = Buffer.from(m[2], 'base64');
    if (!buffer.length || buffer.length > 8 * 1024 * 1024) {
      return res.status(400).json({ error: 'Görsel boyutu 8MB sınırını aşıyor veya boş.' });
    }

    const extMap = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
    const ext = extMap[mime] || '.img';
    const safeName = String(body.fileName || 'slider').replace(/[^a-zA-Z0-9._-]/g, '-').replace(/\.+/g, '.').slice(0, 80);
    const fileName = `${Date.now()}-${crypto.randomBytes(5).toString('hex')}-${safeName.replace(/\.[^.]+$/, '')}${ext}`;

    const imageDir = path.join(process.cwd(), 'resimler');
    await fs.mkdir(imageDir, { recursive: true });
    const absFile = path.join(imageDir, fileName);
    await fs.writeFile(absFile, buffer);

    return res.status(200).json({ success: true, imageUrl: `/resimler/${fileName}` });
  } catch (err) {
    console.error('upload-image error:', err.message);
    return res.status(500).json({ error: 'Sunucu hatası: ' + err.message });
  }
};
