const { pool } = require('../lib/_db');
const { ensureHomeFeaturedProductsSchema, normalizeFeaturedProductIds } = require('../lib/_home_featured_products');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Desteklenmeyen method.' });

  try {
    await ensureHomeFeaturedProductsSchema();
    const result = await pool.query('SELECT product_ids AS "productIds" FROM home_featured_products_config WHERE id = 1');
    const productIds = normalizeFeaturedProductIds(result.rows[0]?.productIds || []);
    return res.status(200).json({ success: true, productIds });
  } catch (err) {
    console.error('home-featured-products public error:', err.message);
    return res.status(500).json({ error: 'Sunucu hatası: ' + err.message });
  }
};
