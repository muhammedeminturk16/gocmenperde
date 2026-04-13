const { pool } = require('./_db');

let schemaReady = false;

async function ensureSliderAdsSchema() {
  if (schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS slider_ads (
      id SERIAL PRIMARY KEY,
      image_url TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      subtitle TEXT NOT NULL DEFAULT '',
      target_path TEXT NOT NULL,
      order_no INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      crop_x NUMERIC(5,2) NOT NULL DEFAULT 50,
      crop_y NUMERIC(5,2) NOT NULL DEFAULT 50,
      crop_zoom NUMERIC(4,2) NOT NULL DEFAULT 1
    )
  `);
  await pool.query(`ALTER TABLE slider_ads ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE slider_ads ADD COLUMN IF NOT EXISTS subtitle TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE slider_ads ADD COLUMN IF NOT EXISTS crop_x NUMERIC(5,2) NOT NULL DEFAULT 50`);
  await pool.query(`ALTER TABLE slider_ads ADD COLUMN IF NOT EXISTS crop_y NUMERIC(5,2) NOT NULL DEFAULT 50`);
  await pool.query(`ALTER TABLE slider_ads ADD COLUMN IF NOT EXISTS crop_zoom NUMERIC(4,2) NOT NULL DEFAULT 1`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_slider_ads_active_order ON slider_ads (is_active, order_no, id DESC)');
  schemaReady = true;
}

function normalizeSliderAdPayload(body = {}) {
  const imageUrl = String(body.imageUrl || body.image_url || '').trim();
  const title = String(body.title || '').trim();
  const subtitle = String(body.subtitle || '').trim();
  const targetPath = String(body.targetPath || body.target_path || '').trim();
  const orderNo = Number.isFinite(Number(body.orderNo ?? body.order_no)) ? Number(body.orderNo ?? body.order_no) : 0;
  const isActive = body.isActive !== false && body.is_active !== false;
  const cropXRaw = Number(body.cropX ?? body.crop_x);
  const cropYRaw = Number(body.cropY ?? body.crop_y);
  const cropZoomRaw = Number(body.cropZoom ?? body.crop_zoom);
  const cropX = Number.isFinite(cropXRaw) ? Math.max(0, Math.min(100, cropXRaw)) : 50;
  const cropY = Number.isFinite(cropYRaw) ? Math.max(0, Math.min(100, cropYRaw)) : 50;
  const cropZoom = Number.isFinite(cropZoomRaw) ? Math.max(1, Math.min(1.8, cropZoomRaw)) : 1;

  if (!imageUrl) return { ok: false, error: 'Görsel URL zorunlu.' };
  if (!targetPath) return { ok: false, error: 'Hedef yol zorunlu.' };

  return {
    ok: true,
    value: {
      imageUrl: imageUrl.slice(0, 1000),
      title: title.slice(0, 120),
      subtitle: subtitle.slice(0, 220),
      targetPath: targetPath.slice(0, 500),
      orderNo,
      isActive,
      cropX,
      cropY,
      cropZoom,
    },
  };
}

module.exports = {
  ensureSliderAdsSchema,
  normalizeSliderAdPayload,
};
