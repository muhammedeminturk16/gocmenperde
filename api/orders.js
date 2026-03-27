const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  try {
    if (action === 'create' && req.method === 'POST') {
      const { name, phone, address, note, payment, items, total } = req.body;
      if (!name || !phone || !address || !items || !total)
        return res.status(400).json({ error: 'Eksik bilgi.' });

      let musteri_id = null;
      try {
        const auth = req.headers.authorization;
        if (auth && auth.startsWith('Bearer ')) {
          const decoded = JSON.parse(Buffer.from(auth.slice(7), 'base64').toString());
          musteri_id = decoded.id || null;
        }
      } catch {}

      const result = await pool.query(
        'INSERT INTO siparisler (musteri_id, musteri_adi, telefon, adres, odeme_yontemi, urunler, toplam, siparis_notu) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, created_at',
        [musteri_id, name, phone, address, payment, JSON.stringify(items), total, note || '']
      );
      return res.status(201).json({ success: true, order_id: result.rows[0].id });
    }

    if (action === 'my-orders' && req.method === 'GET') {
      const user = verifyToken(req);
      if (!user) return res.status(401).json({ error: 'Oturum geçersiz.' });
      const result = await pool.query(
        'SELECT id, musteri_adi, telefon, adres, odeme_yontemi, urunler, toplam, durum, siparis_notu, created_at FROM siparisler WHERE musteri_id = $1 ORDER BY created_at DESC',
        [user.id]
      );
      return res.status(200).json({ success: true, orders: result.rows });
    }

    // ADMİN — tüm siparişler
    if (action === 'all' && req.method === 'GET') {
      if (req.headers['x-admin-key'] !== 'gocmen1993')
        return res.status(403).json({ error: 'Yetkisiz.' });
      const result = await pool.query(
        'SELECT * FROM siparisler ORDER BY created_at DESC'
      );
      return res.status(200).json({ success: true, orders: result.rows });
    }

    // ADMİN — durum güncelle
    if (action === 'update-status' && req.method === 'POST') {
      if (req.headers['x-admin-key'] !== 'gocmen1993')
        return res.status(403).json({ error: 'Yetkisiz.' });
      const { id, durum } = req.body;
      const gecerliDurumlar = ['Beklemede', 'Hazırlanıyor', 'Kargoda', 'Teslim Edildi', 'İptal'];
      if (!id || !gecerliDurumlar.includes(durum))
        return res.status(400).json({ error: 'Geçersiz veri.' });
      await pool.query('UPDATE siparisler SET durum = $1 WHERE id = $2', [durum, id]);
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Geçersiz işlem.' });

  } catch (err) {
    console.error('Orders error:', err.message);
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
