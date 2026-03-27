const { Pool } = require('pg');

// Vercel Settings -> Environment Variables kısmına eklediğimiz URL'yi kullanır
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

export default async function handler(req, res) {
  // Tarayıcı izinleri (CORS) - Başka sayfalardan erişim için şart
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Sadece POST metodu kabul edilir' });
  }

  const { action, ad_soyad, email, telefon, sifre } = req.body;

  try {
    if (action === 'register') {
      // musteriler tablosuna kayıt ekleme (sifre_hash yerine sifre kullanıyoruz)
      const result = await pool.query(
        'INSERT INTO musteriler (ad_soyad, email, telefon, sifre) VALUES ($1, $2, $3, $4) RETURNING id, ad_soyad',
        [ad_soyad, email, telefon, sifre]
      );
      
      return res.status(200).json({ 
        success: true, 
        user: result.rows[0] 
      });
    }
    
    return res.status(400).json({ error: 'Geçersiz işlem tipi' });
  } catch (error) {
    console.error('Neon Veritabanı Hatası:', error.message);
    
    // Eğer tablo yoksa veya sütun ismi yanlışsa burada hata mesajını göreceğiz
    return res.status(500).json({ 
      success: false, 
      error: 'Veritabanı hatası: ' + error.message 
    });
  }
}
