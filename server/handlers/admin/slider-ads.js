const { pool } = require('../../lib/_db');
const { ensureSliderAdsSchema, normalizeSliderAdPayload } = require('../../lib/_slider_ads');

const ADMIN_API_KEY = 'gocmen1993';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.headers['x-admin-key'] !== ADMIN_API_KEY) {
    return res.status(403).json({ error: 'Yetkisiz.' });
  }

  try {
    await ensureSliderAdsSchema();

    if (req.method === 'GET') {
      const result = await pool.query(`
        SELECT id, image_url AS "imageUrl", title, subtitle, button_label AS "buttonLabel", target_path AS "targetPath", order_no AS "orderNo", is_active AS "isActive",
               crop_x AS "cropX", crop_y AS "cropY", crop_zoom AS "cropZoom"
        FROM slider_ads
        ORDER BY order_no ASC, id DESC
      `);
      return res.status(200).json({ success: true, items: result.rows });
    }

    if (req.method === 'POST') {
      const parsed = normalizeSliderAdPayload(req.body || {});
      if (!parsed.ok) return res.status(400).json({ error: parsed.error });
      const result = await pool.query(
        `INSERT INTO slider_ads (image_url, title, subtitle, button_label, target_path, order_no, is_active, crop_x, crop_y, crop_zoom)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, image_url AS "imageUrl", title, subtitle, button_label AS "buttonLabel", target_path AS "targetPath", order_no AS "orderNo", is_active AS "isActive",
                   crop_x AS "cropX", crop_y AS "cropY", crop_zoom AS "cropZoom"`,
        [parsed.value.imageUrl, parsed.value.title, parsed.value.subtitle, parsed.value.buttonLabel, parsed.value.targetPath, parsed.value.orderNo, parsed.value.isActive, parsed.value.cropX, parsed.value.cropY, parsed.value.cropZoom]
      );
      return res.status(201).json({ success: true, item: result.rows[0] });
    }

    if (req.method === 'PUT') {
      const id = Number(req.query.id || req.body?.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Geçersiz id.' });

      const parsed = normalizeSliderAdPayload(req.body || {});
      if (!parsed.ok) return res.status(400).json({ error: parsed.error });

         const result = await pool.query(
        `UPDATE slider_ads
         SET image_url = $1, title = $2, subtitle = $3, button_label = $4, target_path = $5, order_no = $6, is_active = $7, crop_x = $8, crop_y = $9, crop_zoom = $10
         WHERE id = $11
         RETURNING id, image_url AS "imageUrl", title, subtitle, button_label AS "buttonLabel", target_path AS "targetPath", order_no AS "orderNo", is_active AS "isActive",
                   crop_x AS "cropX", crop_y AS "cropY", crop_zoom AS "cropZoom"`,
        [parsed.value.imageUrl, parsed.value.title, parsed.value.subtitle, parsed.value.buttonLabel, parsed.value.targetPath, parsed.value.orderNo, parsed.value.isActive, parsed.value.cropX, parsed.value.cropY, parsed.value.cropZoom, id]
      );

      if (!result.rows.length) return res.status(404).json({ error: 'Kayıt bulunamadı.' });
      return res.status(200).json({ success: true, item: result.rows[0] });
    }

    if (req.method === 'DELETE') {
      const id = Number(req.query.id || req.body?.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Geçersiz id.' });
      const result = await pool.query('DELETE FROM slider_ads WHERE id = $1 RETURNING id', [id]);
      if (!result.rows.length) return res.status(404).json({ error: 'Kayıt bulunamadı.' });
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Desteklenmeyen method.' });
  } catch (err) {
    console.error('slider-ads admin error:', err.message);
    return res.status(500).json({ error: 'Sunucu hatası: ' + err.message });
  }
};
