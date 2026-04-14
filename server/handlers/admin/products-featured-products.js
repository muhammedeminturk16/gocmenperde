const { pool } = require('../../lib/_db');
const { ensureProductsFeaturedProductsSchema, normalizeProductsFeaturedProductIds } = require('../../lib/_products_featured_products');

const ADMIN_API_KEY = 'gocmen1993';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.headers['x-admin-key'] !== ADMIN_API_KEY) {
    return res.status(403).json({ error: 'Yetkisiz.' });
  }

  try {
    await ensureProductsFeaturedProductsSchema();

    if (req.method === 'GET') {
      const result = await pool.query('SELECT product_ids AS "productIds", updated_at AS "updatedAt" FROM products_featured_products_config WHERE id = 1');
      const productIds = normalizeProductsFeaturedProductIds(result.rows[0]?.productIds || []);
      return res.status(200).json({ success: true, productIds, updatedAt: result.rows[0]?.updatedAt || null });
    }

    if (req.method === 'PUT') {
      const productIds = normalizeProductsFeaturedProductIds(req.body || {}, []);
      await pool.query(
        `INSERT INTO products_featured_products_config (id, product_ids, updated_at)
         VALUES (1, $1::jsonb, NOW())
         ON CONFLICT (id)
         DO UPDATE SET product_ids = EXCLUDED.product_ids, updated_at = NOW()`,
        [JSON.stringify(productIds)]
      );
      const check = await pool.query('SELECT updated_at AS "updatedAt" FROM products_featured_products_config WHERE id = 1');
      return res.status(200).json({ success: true, productIds, updatedAt: check.rows[0]?.updatedAt || null });
    }

    return res.status(405).json({ error: 'Desteklenmeyen method.' });
  } catch (err) {
    console.error('products-featured-products admin error:', err.message);
    return res.status(500).json({ error: 'Sunucu hatası: ' + err.message });
  }
};
