const { neon } = require(’@neondatabase/serverless’);

module.exports = async function handler(req, res) {
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);
res.setHeader(‘Access-Control-Allow-Methods’, ‘GET, POST, OPTIONS’);
res.setHeader(‘Access-Control-Allow-Headers’, ‘Content-Type, Authorization’);
if (req.method === ‘OPTIONS’) return res.status(200).end();

const { action } = req.query;

let sql;
try {
sql = neon(process.env.DATABASE_URL);
} catch(e) {
return res.status(500).json({ error: ’DB bağlantı hatası: ’ + e.message });
}

try {
if (action === ‘create’ && req.method === ‘POST’) {
const { name, phone, address, note, payment, items, total } = req.body;
if (!name || !phone || !address || !items || !total)
return res.status(400).json({ error: ‘Eksik bilgi.’ });

```
  let musteri_id = null;
  try {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      const decoded = JSON.parse(Buffer.from(auth.slice(7), 'base64').toString());
      musteri_id = decoded.id || null;
    }
  } catch {}

  const result = await sql`
    INSERT INTO siparisler (musteri_id, musteri_adi, telefon, adres, odeme_yontemi, urunler, toplam, siparis_notu)
    VALUES (${musteri_id}, ${name}, ${phone}, ${address}, ${payment}, ${JSON.stringify(items)}, ${total}, ${note || ''})
    RETURNING id, created_at
  `;
  return res.status(201).json({ success: true, order_id: result[0].id });
}

if (action === 'my-orders' && req.method === 'GET') {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Oturum geçersiz.' });
  const result = await sql`
    SELECT id, musteri_adi, telefon, adres, odeme_yontemi, urunler, toplam, durum, siparis_notu, created_at
    FROM siparisler WHERE musteri_id = ${user.id} ORDER BY created_at DESC
  `;
  return res.status(200).json({ success: true, orders: result });
}

return res.status(400).json({ error: 'Geçersiz işlem.' });
```

} catch (err) {
console.error(‘Orders error:’, err.message);
return res.status(500).json({ error: ’Sunucu hatası: ’ + err.message });
}
};

function verifyToken(req) {
try {
const auth = req.headers.authorization;
if (!auth || !auth.startsWith(’Bearer ’)) return null;
const decoded = JSON.parse(Buffer.from(auth.slice(7), ‘base64’).toString());
if (!decoded.id || !decoded.email) return null;
return decoded;
} catch { return null; }
}