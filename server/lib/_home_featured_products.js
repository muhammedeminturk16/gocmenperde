const { pool } = require('./_db');

let schemaReady = false;

const DEFAULT_HOME_FEATURED_PRODUCTS = ['zebra-premium-gri', 'plise-krem-160x200', 'stor-salon-antrasit'];

async function ensureHomeFeaturedProductsSchema() {
  if (schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS home_featured_products_config (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      product_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    INSERT INTO home_featured_products_config (id, product_ids)
    VALUES (1, $1::jsonb)
    ON CONFLICT (id) DO NOTHING
  `, [JSON.stringify(DEFAULT_HOME_FEATURED_PRODUCTS)]);
  schemaReady = true;
}

function normalizeFeaturedProductIds(payload = {}, fallback = DEFAULT_HOME_FEATURED_PRODUCTS) {
  const source = Array.isArray(payload)
    ? payload
    : (Array.isArray(payload.productIds) ? payload.productIds : fallback);

  const normalized = source
    .map((id) => String(id || '').trim())
    .filter(Boolean)
    .slice(0, 20);

  const unique = [...new Set(normalized)];
  return unique.length ? unique : [...DEFAULT_HOME_FEATURED_PRODUCTS];
}

module.exports = {
  ensureHomeFeaturedProductsSchema,
  normalizeFeaturedProductIds,
  DEFAULT_HOME_FEATURED_PRODUCTS,
};
