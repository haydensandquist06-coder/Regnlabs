// POST /api/order — receives an order from the website's checkout form.
//
// Works as a drop-in replacement for FormSubmit:
//   <form action="/api/order" method="POST"> ... </form>
// or from JavaScript:
//   fetch('/api/order', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) })
//
// It (1) saves the order, (2) emails you, (3) emails the customer a confirmation.
// The order is saved FIRST, so even if an email fails, nothing is lost.

const crypto = require('node:crypto');
const store = require('./_lib/store');
const mail = require('./_lib/email');

const MAX_FIELDS = 60;
const MAX_FIELD_LEN = 5000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// FormSubmit control fields we understand (and keep out of the order details).
const CONTROL = new Set(['_next', '_subject', '_honey', '_captcha', '_template', '_replyto', '_cc', '_autoresponse', '_url', '_blacklist', '_webhook']);

function orderId() {
  // e.g. RL-251103-7K3QX  (date + 5 random chars, no look-alike letters)
  const d = new Date();
  const ymd = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const rand = Array.from(crypto.randomBytes(5), (b) => chars[b % chars.length]).join('');
  return `RL-${ymd}-${rand}`;
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
}

function wantsJson(req) {
  return String(req.headers['content-type'] || '').includes('application/json')
    || String(req.headers.accept || '').includes('application/json');
}

// Only allow redirects back to our own site.
function safeNext(next, req) {
  if (typeof next !== 'string' || !next) return '/?order=success';
  if (next.startsWith('/') && !next.startsWith('//')) return next;
  try {
    const u = new URL(next);
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (u.host === host) return u.pathname + u.search + u.hash;
  } catch {}
  return '/?order=success';
}

function reply(req, res, status, data) {
  if (wantsJson(req)) return res.status(status).json(data);
  if (status === 200) {
    const next = safeNext(req.body?._next, req);
    const sep = next.includes('?') ? '&' : '?';
    res.setHeader('Location', `${next}${sep}id=${encodeURIComponent(data.id)}`);
    return res.status(303).end();
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(status).send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
    <body style="font:16px/1.5 Arial,sans-serif;background:#0b0b0b;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0">
    <div style="max-width:440px;padding:24px;text-align:center"><h2 style="color:#22c55e">Order not sent</h2>
    <p>${String(data.error).replace(/[<>&]/g, '')}</p><p><a style="color:#22c55e" href="javascript:history.back()">Go back and try again</a></p></div>`);
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Use POST.' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};

  // Spam trap: a hidden field real people never fill in. Pretend success so bots move on.
  if (body._honey) return reply(req, res, 200, { ok: true, id: 'RL-000000-OK' });

  try {
    if (!(await store.allow(`order:${clientIp(req)}`, 10, 3600))) {
      return reply(req, res, 429, { ok: false, error: 'Too many orders from your connection. Please wait a bit or contact us directly.' });
    }
  } catch (e) { console.error('rate limit check failed', e); }

  // Collect the order's fields, flattening arrays (e.g. several items with the same name).
  const fields = {};
  for (const [k, v] of Object.entries(body)) {
    if (CONTROL.has(k)) continue;
    if (Object.keys(fields).length >= MAX_FIELDS) break;
    const key = String(k).slice(0, 80);
    const val = Array.isArray(v) ? v.join(', ') : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '');
    fields[key] = val.slice(0, MAX_FIELD_LEN).trim();
  }
  if (!Object.values(fields).some(Boolean)) {
    return reply(req, res, 400, { ok: false, error: 'The order was empty.' });
  }

  const customerEmail = [body._replyto, fields.email, fields.Email, fields.customer_email, fields.customerEmail]
    .find((e) => typeof e === 'string' && EMAIL_RE.test(e.trim()))?.trim();

  const order = {
    id: orderId(),
    createdAt: Date.now(),
    status: 'new',
    customerEmail: customerEmail || null,
    fields,
    meta: {
      ip: clientIp(req),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
      page: String(req.headers.referer || '').slice(0, 300),
    },
  };

  // 1) Save. This is the step that must not fail.
  let saved = false;
  try { await store.saveOrder(order); saved = true; }
  catch (e) { console.error('ORDER SAVE FAILED', order.id, e, JSON.stringify(order)); }

  // 2) Email the store owner.
  let notified = false;
  const owner = process.env.ORDER_EMAIL_TO;
  try {
    if (owner) {
      await mail.sendEmail({
        to: owner.split(',').map((s) => s.trim()).filter(Boolean),
        subject: `${String(body._subject || 'New order').slice(0, 120)} — ${order.id}`,
        html: mail.ownerEmail(order),
        replyTo: customerEmail,
      });
      notified = true;
    }
  } catch (e) { console.error('owner email failed', order.id, e); }

  // If we couldn't save it AND couldn't email it, the order is truly lost — tell the customer.
  if (!saved && !notified) {
    return reply(req, res, 503, { ok: false, error: 'We couldn’t process your order right now. Nothing was charged. Please try again in a few minutes.' });
  }

  // 3) Confirmation to the customer (best effort; needs a verified sending domain in Resend).
  if (customerEmail && process.env.SEND_CUSTOMER_CONFIRMATION !== 'false') {
    try {
      await mail.sendEmail({
        to: customerEmail,
        subject: `Your REGN Labs order ${order.id}`,
        html: mail.customerEmail(order),
        replyTo: owner ? owner.split(',')[0].trim() : undefined,
      });
    } catch (e) { console.error('customer email failed', order.id, e.message); }
  }

  return reply(req, res, 200, { ok: true, id: order.id });
};
