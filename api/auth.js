const { Pool } = require('pg');

// Neon bağlantı dizesini buraya ekle (Çevre değişkeni kullanman daha güvenli olur)
const pool = new Pool({
  connectionString: 'POSTGRES_URL_BURAYA',
  ssl: {
    rejectUnauthorized: false
  }
});

export default async function handler(req, res) {
  const { method } = req;

  if (method === 'POST') {
    const { action, ad_soyad, email, telefon, sifre } = req.body;

    // KAYIT OLMA İŞLEMİ
    if (action === 'register') {
      try {
        const result = await pool.query(
          'INSERT INTO musteriler (ad_soyad, email, telefon, sifre_hash) VALUES ($1, $2, $3, $4) RETURNING *',
          [ad_soyad, email, telefon, sifre] // Gerçek projede şifreyi 'bcrypt' ile şifrelemelisin!
        );
        return res.status(200).json({ success: true, user: result.rows[0] });
      } catch (error) {
        return res.status(500).json({ error: 'Kayıt başarısız: ' + error.message });
      }
    }

    // GİRİŞ YAPMA İŞLEMİ
    if (action === 'login') {
      try {
        const result = await pool.query('SELECT * FROM musteriler WHERE email = $1 AND status = $2', [email, sifre]);
        if (result.rows.length > 0) {
          return res.status(200).json({ success: true, user: result.rows[0] });
        } else {
          return res.status(401).json({ error: 'E-posta veya şifre hatalı!' });
        }
      } catch (error) {
        return res.status(500).json({ error: 'Giriş hatası!' });
      }
    }
  }

  res.setHeader('Allow', ['POST']);
  res.status(405).end(`Method ${method} Not Allowed`);
}
