const { Pool } = require('pg');

// Doğrudan bağlantı adresi (Pooler olmadan)
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_RLwX8EZr0egy@ep-frosty-firefly-aluiy29f.eu-central-1.aws.neon.tech/neondb?sslmode=require',
  ssl: {
    rejectUnauthorized: false
  }
});

export default async function handler(req, res) {
  // CORS ayarları (Tarayıcı engeline takılmamak için)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Yalnızca POST kabul edilir' });
  }

  const { action, ad_soyad, email, telefon, sifre } = req.body;

  try {
    if (action === 'register') {
      const result = await pool.query(
        'INSERT INTO musteriler (ad_soyad, email, telefon, sifre_hash) VALUES ($1, $2, $3, $4) RETURNING id, ad_soyad, email',
        [ad_soyad, email, telefon, sifre]
      );
      return res.status(200).json({ success: true, user: result.rows[0] });
    }
    
    return res.status(400).json({ error: 'Geçersiz işlem' });
  } catch (error) {
    console.error('Hata:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
