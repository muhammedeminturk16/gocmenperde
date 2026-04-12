const { pool } = require('../lib/_db');

const ADMIN_API_KEY = 'gocmen1993';
let schemaReady = false;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await ensureSchema();

    if (req.method === 'GET') {
      const isAdmin = req.headers['x-admin-key'] === ADMIN_API_KEY;
      const result = await pool.query(`
        SELECT id, title, image_url AS "imageUrl", link_url AS "linkUrl", display_order AS "displayOrder", is_active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt"
        FROM slider_content
        ${isAdmin ? '' : 'WHERE is_active = TRUE'}
        ORDER BY display_order ASC, id DESC
      `);
      return res.status(200).json({ success: true, items: result.rows });
    }

    if (req.headers['x-admin-key'] !== ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Yetkisiz.' });
    }

    if (req.method === 'POST') {
      const payload = validatePayload(req.body || {});
      if (!payload.ok) return res.status(400).json({ error: payload.error });
      const result = await pool.query(
        `INSERT INTO slider_content (title, image_url, link_url, display_order, is_active)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id, title, image_url AS "imageUrl", link_url AS "linkUrl", display_order AS "displayOrder", is_active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt"`,
        [payload.value.title, payload.value.imageUrl, payload.value.linkUrl, payload.value.displayOrder, payload.value.isActive]
      );
      return res.status(201).json({ success: true, item: result.rows[0] });
    }

    if (req.method === 'PUT') {
      const id = Number(req.query.id || req.body?.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Geçersiz id.' });
      const payload = validatePayload(req.body || {});
      if (!payload.ok) return res.status(400).json({ error: payload.error });
      const result = await pool.query(
        `UPDATE slider_content
         SET title=$1, image_url=$2, link_url=$3, display_order=$4, is_active=$5, updated_at=now()
         WHERE id=$6
         RETURNING id, title, image_url AS "imageUrl", link_url AS "linkUrl", display_order AS "displayOrder", is_active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt"`,
        [payload.value.title, payload.value.imageUrl, payload.value.linkUrl, payload.value.displayOrder, payload.value.isActive, id]
      );
      if (!result.rows.length) return res.status(404).json({ error: 'Kayıt bulunamadı.' });
      return res.status(200).json({ success: true, item: result.rows[0] });
    }

    if (req.method === 'DELETE') {
      const id = Number(req.query.id || req.body?.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Geçersiz id.' });
      const result = await pool.query('DELETE FROM slider_content WHERE id = $1 RETURNING id', [id]);
      if (!result.rows.length) return res.status(404).json({ error: 'Kayıt bulunamadı.' });
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Desteklenmeyen method.' });
  } catch (err) {
    console.error('Slider error:', err.message);
    return res.status(500).json({ error: 'Sunucu hatası: ' + err.message });
  }
};

function validatePayload(body) {
  const title = String(body.title || '').trim();
  const imageUrl = String(body.imageUrl || '').trim();
  const linkUrl = String(body.linkUrl || '').trim();
  const displayOrder = Number.isFinite(Number(body.displayOrder)) ? Number(body.displayOrder) : 0;
  const isActive = body.isActive !== false;

  if (!title) return { ok: false, error: 'Başlık zorunlu.' };
  if (!imageUrl) return { ok: false, error: 'Görsel URL zorunlu.' };
  if (!linkUrl) return { ok: false, error: 'Link URL zorunlu.' };
  return {
    ok: true,
    value: {
      title: title.slice(0, 160),
      imageUrl: imageUrl.slice(0, 600),
      linkUrl: linkUrl.slice(0, 600),
      displayOrder,
      isActive,
    },
  };
}

async function ensureSchema() {
  if (schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS slider_content (
      id BIGSERIAL PRIMARY KEY,
      title VARCHAR(160) NOT NULL,
      image_url TEXT NOT NULL,
      link_url TEXT NOT NULL,
      display_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_slider_content_order ON slider_content (is_active, display_order, id DESC)');
  schemaReady = true;
}
