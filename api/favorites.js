const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { verifyAuthToken } = require('./_auth-utils');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = verifyAuthToken(req);
  if (!user) return res.status(401).json({ error: 'Oturum geçersiz.' });

  const { action } = req.query;

  try {
    if (action === 'list' && req.method === 'GET') {
      const result = await pool.query(
        'SELECT * FROM favoriler WHERE musteri_id = $1 ORDER BY created_at DESC',
        [user.id]
      );
      return res.status(200).json({ success: true, favorites: result.rows });
    }

    if (action === 'add' && req.method === 'POST') {
      const { urun_id, urun_adi, urun_resim, urun_fiyat } = req.body;
      await pool.query(
        'INSERT INTO favoriler (musteri_id, urun_id, urun_adi, urun_resim, urun_fiyat) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (musteri_id, urun_id) DO NOTHING',
        [user.id, urun_id, urun_adi, urun_resim, urun_fiyat]
      );
      return res.status(200).json({ success: true });
    }

    if (action === 'remove' && req.method === 'POST') {
      const { urun_id } = req.body;
      await pool.query(
        'DELETE FROM favoriler WHERE musteri_id = $1 AND urun_id = $2',
        [user.id, urun_id]
      );
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Geçersiz işlem.' });

  } catch (err) {
    console.error('Favorites error:', err.message);
    return res.status(500).json({ error: 'Sunucu hatası: ' + err.message });
  }
};
