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
  const safePayload = normalizeFeaturedPayload(payload);
  const source = Array.isArray(safePayload)
    ? safePayload
    : (Array.isArray(safePayload.productIds) ? safePayload.productIds : fallback);

  if (!Array.isArray(source) || source.length === 0) {
    return [];
  }

  const normalized = source
    .map((id) => extractFeaturedProductId(id))
    .filter(Boolean)
    .slice(0, 20);

  return [...new Set(normalized)];
}

function normalizeFeaturedPayload(payload) {
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload);
    } catch (_) {
      return {};
    }
  }
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.product_ids)) {
      return { ...payload, productIds: payload.product_ids };
    }
    return payload;
  }
  return {};
}

function extractFeaturedProductId(value) {
  if (value && typeof value === 'object') {
    const objectId = value.id ?? value.productId ?? value.product_id ?? value.slug ?? value.value ?? value.path ?? value.targetPath;
    return extractFeaturedProductId(objectId);
  }
  const raw = String(value || '').trim();
  if (!raw) return '';
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch (_) {}
  const queryMatch = decoded.match(/(?:^|[?&])product=([^#&]+)/i);
  if (queryMatch && queryMatch[1]) {
    return extractFeaturedProductId(queryMatch[1]);
  }
  const productPathMatch = decoded.match(/\/product(?:s)?\/([^/?#]+)/i);
  if (productPathMatch && productPathMatch[1]) {
    return extractFeaturedProductId(productPathMatch[1]);
  }
  return decoded.replace(/^\/+|\/+$/g, '');
}

module.exports = {
  ensureHomeFeaturedProductsSchema,
  normalizeFeaturedProductIds,
  DEFAULT_HOME_FEATURED_PRODUCTS,
};
