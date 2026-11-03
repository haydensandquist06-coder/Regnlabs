// Sends email through Resend (resend.com) using its HTTPS API. No packages needed.

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function sendEmail({ to, subject, html, replyTo }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not set.');
  const from = process.env.EMAIL_FROM || 'REGN Labs Orders <onboarding@resend.dev>';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: Array.isArray(to) ? to : [to], subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  if (!r.ok) throw new Error(`Resend error ${r.status}: ${await r.text()}`);
  return r.json();
}

const label = (k) => k.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, (c) => c.toUpperCase());

function fieldsTable(fields) {
  const rows = Object.entries(fields).map(([k, v]) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e5e5;color:#555;white-space:nowrap;vertical-align:top"><b>${esc(label(k))}</b></td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e5e5;white-space:pre-wrap">${esc(v)}</td>
    </tr>`).join('');
  return `<table style="border-collapse:collapse;width:100%;font:14px/1.5 Arial,sans-serif">${rows}</table>`;
}

function shell(title, inner) {
  return `<div style="background:#f4f4f4;padding:24px">
  <div style="max-width:620px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;font:14px/1.5 Arial,sans-serif;color:#111">
    <div style="background:#0b0b0b;color:#22c55e;padding:18px 24px;font:bold 18px Arial,sans-serif">REGN Labs</div>
    <div style="padding:24px"><h2 style="margin:0 0 16px;font:bold 20px Arial,sans-serif">${esc(title)}</h2>${inner}</div>
  </div></div>`;
}

function ownerEmail(order) {
  return shell(`New order ${order.id}`, `
    <p style="margin:0 0 16px;color:#555">Received ${esc(new Date(order.createdAt).toLocaleString('en-US', { timeZone: process.env.TIMEZONE || 'America/Indianapolis' }))}</p>
    ${fieldsTable(order.fields)}`);
}

function customerEmail(order) {
  return shell('We received your order', `
    <p>Thanks for your order. Your order number is <b>${esc(order.id)}</b>. Keep it for your records.</p>
    <p>We'll be in touch with next steps shortly. Here's what you sent us:</p>
    ${fieldsTable(order.fields)}
    <p style="margin-top:20px;color:#777;font-size:12px">Just reply to this email if anything looks wrong.</p>`);
}

module.exports = { sendEmail, ownerEmail, customerEmail };
