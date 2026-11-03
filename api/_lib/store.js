// Order storage using Upstash Redis (added free from the Vercel Marketplace).
// Talks to Redis over plain HTTPS, so there are no packages to install.

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const enabled = () => Boolean(URL_ && TOKEN);

// Run several Redis commands in one request, e.g. [["SET","k","v"],["GET","k"]]
async function redis(commands) {
  if (!enabled()) throw new Error('Order storage is not connected (missing KV_REST_API_URL / KV_REST_API_TOKEN).');
  const r = await fetch(`${URL_}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error(`Redis error ${r.status}: ${await r.text()}`);
  const out = await r.json();
  for (const x of out) if (x.error) throw new Error(`Redis error: ${x.error}`);
  return out.map((x) => x.result);
}

async function saveOrder(order) {
  await redis([
    ['SET', `order:${order.id}`, JSON.stringify(order)],
    ['ZADD', 'orders', String(order.createdAt), order.id],
  ]);
}

async function updateOrder(id, changes) {
  const [raw] = await redis([['GET', `order:${id}`]]);
  if (!raw) return null;
  const order = { ...JSON.parse(raw), ...changes, updatedAt: Date.now() };
  await redis([['SET', `order:${id}`, JSON.stringify(order)]]);
  return order;
}

// Newest first.
async function listOrders(limit = 100, offset = 0) {
  const [ids, total] = await redis([
    ['ZRANGE', 'orders', String(offset), String(offset + limit - 1), 'REV'],
    ['ZCARD', 'orders'],
  ]);
  if (!ids.length) return { orders: [], total };
  const raws = await redis(ids.map((id) => ['GET', `order:${id}`]));
  return { orders: raws.filter(Boolean).map((r) => JSON.parse(r)), total };
}

// Fixed-window rate limit per key. Returns true if allowed.
async function allow(key, max, windowSec) {
  if (!enabled()) return true;
  const [n] = await redis([['INCR', `rl:${key}`], ['EXPIRE', `rl:${key}`, String(windowSec), 'NX']]);
  return n <= max;
}

module.exports = { enabled, saveOrder, updateOrder, listOrders, allow };
