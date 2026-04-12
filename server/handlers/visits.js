
const { pool } = require('../lib/_db');
const ADMIN_API_KEY = 'gocmen1993';
let schemaReady = false;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await ensureSchema();

    const { action } = req.query;

    if (action === 'track' && req.method === 'POST') {
      const {
        sessionId,
        path = '/',
        referrer = '',
        heartbeat = false,
      } = req.body || {};

      if (!sessionId || String(sessionId).trim().length < 8) {
        return res.status(400).json({ error: 'Geçersiz sessionId.' });
      }

      const cleanPath = normalizePath(path);
      const ua = String(req.headers['user-agent'] || '').slice(0, 300);
      const cleanReferrer = String(referrer || '').slice(0, 500);

      await upsertSession({
        sessionId: String(sessionId).trim(),
        path: cleanPath,
        userAgent: ua,
        referrer: cleanReferrer,
        heartbeat: Boolean(heartbeat),
      });

      if (!heartbeat) {
        await pool.query(
          `INSERT INTO site_visit_pageviews (session_id, path, referrer)
           VALUES ($1, $2, $3)`,
          [String(sessionId).trim(), cleanPath, cleanReferrer || null]
        );
      }

      return res.status(200).json({ success: true });
    }

    if (action === 'stats' && req.method === 'GET') {
      if (req.headers['x-admin-key'] !== ADMIN_API_KEY) {
        return res.status(403).json({ error: 'Yetkisiz.' });
      }

      const [todayPV, yesterdayPV, monthPV, todayUnique, yesterdayUnique, monthUnique, activeNow, dailyRows, topPagesRows] = await Promise.all([
        scalar(`SELECT COUNT(*)::int AS v FROM site_visit_pageviews WHERE visited_at >= date_trunc('day', now())`),
        scalar(`SELECT COUNT(*)::int AS v FROM site_visit_pageviews WHERE visited_at >= date_trunc('day', now()) - interval '1 day' AND visited_at < date_trunc('day', now())`),
        scalar(`SELECT COUNT(*)::int AS v FROM site_visit_pageviews WHERE visited_at >= date_trunc('month', now())`),
        scalar(`SELECT COUNT(DISTINCT session_id)::int AS v FROM site_visit_pageviews WHERE visited_at >= date_trunc('day', now())`),
        scalar(`SELECT COUNT(DISTINCT session_id)::int AS v FROM site_visit_pageviews WHERE visited_at >= date_trunc('day', now()) - interval '1 day' AND visited_at < date_trunc('day', now())`),
        scalar(`SELECT COUNT(DISTINCT session_id)::int AS v FROM site_visit_pageviews WHERE visited_at >= date_trunc('month', now())`),
        scalar(`SELECT COUNT(*)::int AS v FROM site_visit_sessions WHERE last_seen >= now() - interval '5 minute'`),
        pool.query(`
          SELECT
            to_char(day, 'YYYY-MM-DD') AS day,
            page_views,
            unique_visitors
          FROM (
            SELECT
              date_trunc('day', visited_at)::date AS day,
              COUNT(*)::int AS page_views,
              COUNT(DISTINCT session_id)::int AS unique_visitors
            FROM site_visit_pageviews
            WHERE visited_at >= date_trunc('day', now()) - interval '13 day'
            GROUP BY 1
          ) x
          ORDER BY day ASC
        `),
        pool.query(`
          SELECT path, COUNT(*)::int AS page_views
          FROM site_visit_pageviews
          WHERE visited_at >= date_trunc('day', now())
          GROUP BY path
          ORDER BY page_views DESC, path ASC
          LIMIT 5
        `),
      ]);

      return res.status(200).json({
        success: true,
        stats: {
          today: {
            pageViews: todayPV,
            uniqueVisitors: todayUnique,
          },
          yesterday: {
            pageViews: yesterdayPV,
            uniqueVisitors: yesterdayUnique,
          },
          month: {
            pageViews: monthPV,
            uniqueVisitors: monthUnique,
          },
          activeVisitors: activeNow,
          daily: dailyRows.rows,
          topPagesToday: topPagesRows.rows,
        },
      });
    }

    return res.status(400).json({ error: 'Geçersiz işlem.' });
  } catch (err) {
    console.error('Visits error:', err.message);
    return res.status(500).json({ error: 'Sunucu hatası: ' + err.message });
  }
};

async function ensureSchema() {
  if (schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_visit_sessions (
      session_id TEXT PRIMARY KEY,
      first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
      entry_path TEXT,
      last_path TEXT,
      user_agent TEXT,
      referrer TEXT,
      hit_count INTEGER NOT NULL DEFAULT 1
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_visit_pageviews (
      id BIGSERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      path TEXT NOT NULL,
      visited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      referrer TEXT
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_site_visit_pageviews_visited_at ON site_visit_pageviews (visited_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_site_visit_pageviews_session_day ON site_visit_pageviews (session_id, visited_at DESC)
  `);
  schemaReady = true;
}

async function upsertSession({ sessionId, path, userAgent, referrer, heartbeat }) {
  if (heartbeat) {
    await pool.query(
      `INSERT INTO site_visit_sessions (session_id, first_seen, last_seen, entry_path, last_path, user_agent, referrer, hit_count)
       VALUES ($1, now(), now(), $2, $2, $3, $4, 0)
       ON CONFLICT (session_id)
       DO UPDATE SET
         last_seen = now(),
         last_path = EXCLUDED.last_path,
         user_agent = CASE WHEN site_visit_sessions.user_agent IS NULL OR site_visit_sessions.user_agent = '' THEN EXCLUDED.user_agent ELSE site_visit_sessions.user_agent END,
         referrer = CASE WHEN site_visit_sessions.referrer IS NULL OR site_visit_sessions.referrer = '' THEN EXCLUDED.referrer ELSE site_visit_sessions.referrer END`,
      [sessionId, path, userAgent || null, referrer || null]
    );
    return;
  }

  await pool.query(
    `INSERT INTO site_visit_sessions (session_id, first_seen, last_seen, entry_path, last_path, user_agent, referrer, hit_count)
     VALUES ($1, now(), now(), $2, $2, $3, $4, 1)
     ON CONFLICT (session_id)
     DO UPDATE SET
       last_seen = now(),
       last_path = EXCLUDED.last_path,
       hit_count = site_visit_sessions.hit_count + 1,
       user_agent = CASE WHEN site_visit_sessions.user_agent IS NULL OR site_visit_sessions.user_agent = '' THEN EXCLUDED.user_agent ELSE site_visit_sessions.user_agent END,
       referrer = CASE WHEN site_visit_sessions.referrer IS NULL OR site_visit_sessions.referrer = '' THEN EXCLUDED.referrer ELSE site_visit_sessions.referrer END`,
    [sessionId, path, userAgent || null, referrer || null]
  );
}

function normalizePath(path) {
  const value = String(path || '/').trim();
  if (!value) return '/';
  const noOrigin = value.replace(/^https?:\/\/[^/]+/i, '');
  return noOrigin.startsWith('/') ? noOrigin.slice(0, 300) : `/${noOrigin.slice(0, 300)}`;
}

async function scalar(query) {
  const result = await pool.query(query);
  return Number(result.rows?.[0]?.v || 0);
}
