const { pool } = require('./_db');

let schemaReady = false;

async function ensureSliderAdsSchema() {
  if (schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS slider_ads (
      id SERIAL PRIMARY KEY,
      image_url TEXT NOT NULL,
      target_path TEXT NOT NULL,
      order_no INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_slider_ads_active_order ON slider_ads (is_active, order_no, id DESC)');
  schemaReady = true;
}

function normalizeSliderAdPayload(body = {}) {
  const imageUrl = String(body.imageUrl || body.image_url || '').trim();
  const targetPath = String(body.targetPath || body.target_path || '').trim();
  const orderNo = Number.isFinite(Number(body.orderNo ?? body.order_no)) ? Number(body.orderNo ?? body.order_no) : 0;
  const isActive = body.isActive !== false && body.is_active !== false;

  if (!imageUrl) return { ok: false, error: 'Görsel URL zorunlu.' };
  if (!targetPath) return { ok: false, error: 'Hedef yol zorunlu.' };

  return {
    ok: true,
    value: {
      imageUrl: imageUrl.slice(0, 1000),
      targetPath: targetPath.slice(0, 500),
      orderNo,
      isActive,
    },
  };
}

module.exports = {
  ensureSliderAdsSchema,
  normalizeSliderAdPayload,
};
