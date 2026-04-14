const { pool } = require('../lib/_db');
const { ensureProductsFeaturedProductsSchema, normalizeProductsFeaturedProductIds } = require('../lib/_products_featured_products');
const fs = require('fs/promises');
const path = require('path');

async function buildCatalogFallbackIds(limit = 12) {
  try {
    const filePath = path.join(process.cwd(), 'products.json');
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return [];
    const ids = parsed
      .filter((item) => item && item.active !== false)
      .map((item) => String(item.id || '').trim())
      .filter(Boolean)
      .slice(0, limit);
    return [...new Set(ids)];
  } catch (_) {
    return [];
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Desteklenmeyen method.' });

  try {
    await ensureProductsFeaturedProductsSchema();
    const result = await pool.query('SELECT product_ids AS "productIds", updated_at AS "updatedAt" FROM products_featured_products_config WHERE id = 1');
    let productIds = normalizeProductsFeaturedProductIds(result.rows[0]?.productIds || []);
    if (!productIds.length) {
      productIds = await buildCatalogFallbackIds(12);
    }
    return res.status(200).json({ success: true, productIds, updatedAt: result.rows[0]?.updatedAt || null });
  } catch (err) {
    console.error('products-featured-products public error:', err.message);
    const productIds = await buildCatalogFallbackIds(12);
    return res.status(200).json({
      success: false,
      productIds,
      updatedAt: null,
      warning: 'Konfigürasyon okunamadı, katalog varsayılanları döndürüldü.',
    });
  }
};
