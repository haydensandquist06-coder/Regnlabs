// /api/orders — for your admin panel. Requires the ADMIN_KEY you set in Vercel.
//
//   GET  /api/orders?limit=50&offset=0          → list orders, newest first
//   POST /api/orders  {"id":"RL-...","status":"shipped","note":"..."}  → update an order
//
// Send the key in a header:  Authorization: Bearer YOUR_ADMIN_KEY

const crypto = require('node:crypto');
const store = require('./_lib/store');

const STATUSES = new Set(['new', 'paid', 'processing', 'shipped', 'completed', 'cancelled']);

function authorized(req) {
  const key = process.env.ADMIN_KEY;
  if (!key || key.length < 16) return false;
  const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(key).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';

  if (!authorized(req)) {
    // Max 20 wrong keys per 15 minutes per connection, plus a delay, to stop guessing.
    let allowed = true;
    try { allowed = await store.allow(`adminfail:${ip}`, 20, 900); } catch {}
    await new Promise((r) => setTimeout(r, 600));
    if (!allowed) return res.status(429).json({ ok: false, error: 'Too many attempts. Try again in 15 minutes.' });
    return res.status(401).json({ ok: false, error: 'Wrong or missing admin key.' });
  }

  try {
    if (req.method === 'GET') {
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
      const { orders, total } = await store.listOrders(limit, offset);
      return res.status(200).json({ ok: true, total, orders });
    }
    if (req.method === 'POST') {
      const { id, status, note } = req.body || {};
      if (typeof id !== 'string' || !/^RL-\d{6}-[A-Z0-9]{5}$/.test(id)) return res.status(400).json({ ok: false, error: 'Bad order id.' });
      const changes = {};
      if (status !== undefined) {
        if (!STATUSES.has(status)) return res.status(400).json({ ok: false, error: `Status must be one of: ${[...STATUSES].join(', ')}` });
        changes.status = status;
      }
      if (note !== undefined) changes.note = String(note).slice(0, 2000);
      const order = await store.updateOrder(id, changes);
      if (!order) return res.status(404).json({ ok: false, error: 'No such order.' });
      return res.status(200).json({ ok: true, order });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Use GET or POST.' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'Could not reach order storage.' });
  }
};
