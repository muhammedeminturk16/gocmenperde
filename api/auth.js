const { Pool } = require('pg');

// Bağlantı dizesini doğrudan buraya ekledik
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_RLwX8EZr0egy@ep-frosty-firefly-aluiy29f-pooler.c-3.eu-central-1.aws.neon.tech/neondb?sslmode=require',
  ssl: {
    rejectUnauthorized: false
  }
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Yalnızca POST isteği kabul edilir.' });
  }

  const { action, ad_soyad, email, telefon, sifre } = req.body;

  if (action === 'register') {
    try {
      // Veritabanına kayıt ekleme
      const result = await pool.query(
        'INSERT INTO musteriler (ad_soyad, email, telefon, sifre_hash) VALUES ($1, $2, $3, $4) RETURNING *',
        [ad_soyad, email, telefon, sifre]
      );
      return res.status(200).json({ success: true, user: result.rows[0] });
    } catch (error) {
      console.error('Veritabanı hatası:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }
}
