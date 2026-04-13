const { pool } = require('../lib/_db');
const { ensureSliderAdsSchema } = require('../lib/_slider_ads');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Desteklenmeyen method.' });

  try {
    await ensureSliderAdsSchema();
    const result = await pool.query(`
      SELECT id, image_url AS "imageUrl", title, subtitle, target_path AS "targetPath", order_no AS "orderNo",
             crop_x AS "cropX", crop_y AS "cropY", crop_zoom AS "cropZoom"
      FROM slider_ads
      WHERE is_active = TRUE
      ORDER BY order_no ASC, id DESC
    `);
    return res.status(200).json({ success: true, items: result.rows });
  } catch (err) {
    console.error('slider-ads public error:', err.message);
    return res.status(500).json({ error: 'Sunucu hatası: ' + err.message });
  }
};
