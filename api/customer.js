const { pool } = require('./_db');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.headers['x-admin-key'] !== 'gocmen1993') {
    return res.status(403).json({ error: 'Yetkisiz.' });
  }

  const { action } = req.query;

  try {
    if (action === 'all' && req.method === 'GET') {
      const result = await pool.query(`
        SELECT
          m.id,
          m.ad_soyad AS ad,
          m.email,
          COALESCE(NULLIF(m.telefon, ''), '-') AS telefon,
          m.created_at,
          COALESCE(COUNT(s.id), 0)::int AS siparis_sayisi,
          COALESCE(SUM(s.toplam), 0)::numeric AS toplam_harcama
        FROM musteriler m
        LEFT JOIN siparisler s ON s.musteri_id = m.id
        GROUP BY m.id, m.ad_soyad, m.email, m.telefon, m.created_at
        ORDER BY m.created_at DESC
        WITH uyeler AS (
          SELECT
            m.id::text AS id,
            m.ad_soyad AS ad,
            m.email,
            COALESCE(NULLIF(m.telefon, ''), '-') AS telefon,
            m.created_at,
            COALESCE(COUNT(s.id), 0)::int AS siparis_sayisi,
            COALESCE(SUM(s.toplam), 0)::numeric AS toplam_harcama,
            MAX(NULLIF(s.adres, '')) AS adres
          FROM musteriler m
          LEFT JOIN siparisler s ON s.musteri_id = m.id
          GROUP BY m.id, m.ad_soyad, m.email, m.telefon, m.created_at
        ),
        misafirler AS (
          SELECT
            ('guest-' || regexp_replace(COALESCE(NULLIF(s.telefon, ''), s.musteri_adi, s.id::text), '[^0-9A-Za-z]+', '', 'g'))::text AS id,
            COALESCE(NULLIF(MAX(s.musteri_adi), ''), 'Misafir Müşteri') AS ad,
            NULL::text AS email,
            COALESCE(NULLIF(MAX(s.telefon), ''), '-') AS telefon,
            MIN(s.created_at) AS created_at,
            COUNT(*)::int AS siparis_sayisi,
            COALESCE(SUM(s.toplam), 0)::numeric AS toplam_harcama,
            MAX(NULLIF(s.adres, '')) AS adres
          FROM siparisler s
          WHERE s.musteri_id IS NULL
          GROUP BY 1
        )
        SELECT * FROM uyeler
        UNION ALL
        SELECT * FROM misafirler
        ORDER BY created_at DESC
      `);

      const customers = result.rows.map((row) => ({
        ...row,
        toplam_harcama: Number(row.toplam_harcama) || 0,
      }));

      return res.status(200).json({ success: true, customers });
    }

    return res.status(400).json({ error: 'Geçersiz işlem.' });
  } catch (err) {
    console.error('Customers error:', err.message);
    return res.status(500).json({ error: 'Sunucu hatası: ' + err.message });
  }
};
