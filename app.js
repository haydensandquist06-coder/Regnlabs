(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => '$' + Number(n || 0).toFixed(2);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  let products = [];
  let site = {};
  let cart = store.get('rl_cart', []); // [{id, qty}]
  let cat = 'All';
  let currentId = null;
  let qty = 1;

  // ---------- RUO / age gate ----------
  if (!store.get('rl_gate', false)) {
    $('#gate').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  $('#gateYes').onclick = () => {
    store.set('rl_gate', true);
    $('#gate').hidden = true;
    document.body.style.overflow = '';
  };

  // ---------- rendering ----------
  const placeholder = (n) => `
    <div class="card placeholder">
      <div class="thumb">PRODUCT IMAGE</div>
      <span class="sku">SKU-${String(n).padStart(4, '0')}</span>
      <div class="meta"><h3>Product name</h3><span class="price">$0.00</span></div>
      <span class="sub">Size · Purity</span>
    </div>`;

  const card = (p) => `
    <a class="card" href="#product-${encodeURIComponent(p.id)}">
      <div class="thumb">${p.images[0] ? `<img src="${esc(p.images[0])}" alt="${esc(p.name)}" loading="lazy">` : 'NO IMAGE'}</div>
      <span class="sku">${esc(p.sku)}</span>
      <div class="meta"><h3>${esc(p.name)}</h3><span class="price">${money(p.price)}</span></div>
      <span class="sub">${[p.size, p.purity && `Purity ${p.purity}`].filter(Boolean).map(esc).join(' · ')}</span>
      <span class="ruo-tag">Research use only</span>
    </a>`;

  function renderGrid(el, list, emptyCount) {
    el.innerHTML = list.length ? list.map(card).join('') : Array.from({ length: emptyCount }, (_, i) => placeholder(i + 1)).join('');
  }

  function renderHome() {
    const feat = products.filter(p => p.featured);
    renderGrid($('#featured'), (feat.length ? feat : products).slice(0, 4), 4);
  }

  function renderShop() {
    const cats = ['All', ...(site.categories || [])];
    $('#cats').innerHTML = cats.map(c => `<button class="chip${c === cat ? ' on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
    const q = $('#search').value.trim().toLowerCase();
    let list = products.filter(p => (cat === 'All' || p.category === cat) && (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)));
    const s = $('#sort').value;
    if (s === 'az') list.sort((a, b) => a.name.localeCompare(b.name));
    if (s === 'low') list.sort((a, b) => a.price - b.price);
    if (s === 'high') list.sort((a, b) => b.price - a.price);
    if (s === 'featured') list.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
    $('#resultcount').textContent = products.length ? `${list.length} product${list.length === 1 ? '' : 's'}` : 'Products will appear here once they are published from the admin panel.';
    renderGrid($('#shopgrid'), list, products.length ? 0 : 8);
    if (products.length && !list.length) $('#shopgrid').innerHTML = '<p class="muted">No products match that search.</p>';
  }

  function renderProduct(id) {
    const p = products.find(x => x.id === id);
    currentId = id; qty = 1;
    const el = $('#pdp');
    if (!p) {
      el.innerHTML = `<div class="crumbs"><a href="#home">Home</a> / <a href="#shop">Shop</a></div>
        <div class="empty">That product isn't available.<br><a class="btn" href="#shop">Back to catalog</a></div>`;
      return;
    }
    const imgs = p.images.length ? p.images : [null];
    const specRows = [
      ['SKU', p.sku], ['Size', p.size], ['Form', p.form], ['Purity', p.purity], ['CAS number', p.cas],
      ...p.specs.map(s => [s.k, s.v]),
    ].filter(r => r[1]);
    el.innerHTML = `
      <div class="crumbs"><a href="#home">Home</a> / <a href="#shop">Shop</a> / ${esc(p.name)}</div>
      <div class="pdp">
        <div class="gallery">
          <div class="thumb main" id="mainimg">${imgs[0] ? `<img src="${esc(imgs[0])}" alt="${esc(p.name)}">` : 'NO IMAGE'}</div>
          ${imgs.length > 1 ? `<div class="thumbs">${imgs.map((u, i) => `<button data-img="${esc(u)}" class="${i ? '' : 'on'}" aria-label="Show image ${i + 1}"><img src="${esc(u)}" alt=""></button>`).join('')}</div>` : ''}
        </div>
        <div class="pinfo">
          <div><span class="label">${esc(p.category || 'Research compound')}</span><h1 style="margin-top:10px">${esc(p.name)}</h1></div>
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <span class="price">${money(p.price)}</span>
            <span class="pill${p.inStock ? '' : ' out'}">${p.inStock ? 'In stock' : 'Out of stock'}</span>
          </div>
          ${p.short ? `<p style="margin:0">${esc(p.short)}</p>` : ''}
          <div class="ruo-box"><strong>For laboratory research use only.</strong>Not for human or veterinary use. Not a drug, food, cosmetic or dietary supplement. Not intended to diagnose, treat, cure or prevent any disease.</div>
          <div class="buyrow">
            <div class="qty"><button data-q="-1" aria-label="Decrease quantity">−</button><output id="q">1</output><button data-q="1" aria-label="Increase quantity">+</button></div>
            <button class="btn" id="add" ${p.inStock ? '' : 'disabled'}>${p.inStock ? 'Add to cart' : 'Out of stock'}</button>
          </div>
          ${p.coa
            ? `<a class="coa-link" href="${esc(p.coa)}" target="_blank" rel="noopener"><span><b>Certificate of analysis</b><br><span class="muted small">Third-party test results for the current lot</span></span><span class="btn ghost small">View COA</span></a>`
            : `<div class="coa-link"><span><b>Certificate of analysis</b><br><span class="muted small">COA pending for the current lot</span></span></div>`}
          ${p.description ? `<div><h3 style="font-size:18px;margin-bottom:8px">Description</h3><div class="desc">${esc(p.description)}</div></div>` : ''}
          ${specRows.length ? `<table class="specs">${specRows.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`).join('')}</table>` : ''}
        </div>
      </div>`;
  }

  function renderCart() {
    const lines = cart.map(l => ({ ...l, p: products.find(p => p.id === l.id) })).filter(l => l.p);
    if (lines.length !== cart.length) { cart = lines.map(({ id, qty }) => ({ id, qty })); saveCart(); }
    $('#lines').innerHTML = lines.length ? lines.map(({ p, qty }) => `
      <div class="line">
        <div class="thumb">${p.images[0] ? `<img src="${esc(p.images[0])}" alt="">` : ''}</div>
        <div><span class="sku" style="font:400 11px var(--mono);color:var(--muted)">${esc(p.sku)}</span><div style="font-weight:600">${esc(p.name)}</div>
          <div style="display:flex;gap:14px;align-items:center;margin-top:6px">
            <div class="qty"><button data-cq="-1" data-id="${esc(p.id)}" aria-label="Decrease">−</button><output>${qty}</output><button data-cq="1" data-id="${esc(p.id)}" aria-label="Increase">+</button></div>
            <button class="rm" data-rm="${esc(p.id)}">Remove</button>
          </div>
        </div>
        <span class="price">${money(p.price * qty)}</span>
      </div>`).join('')
      : `<div class="empty">Your cart is empty.<br><a class="btn" href="#shop">Browse the catalog</a></div>`;
    const sub = lines.reduce((s, l) => s + l.p.price * l.qty, 0);
    $('#subtotal').textContent = money(sub);
    $('#total').textContent = money(sub);
    $('#checkout').disabled = !lines.length || !$('#attest').checked;
  }

  function renderCOA() {
    const list = products.filter(p => p.coa);
    $('#coalist').innerHTML = list.length
      ? list.map(p => `<a class="coa-link" href="${esc(p.coa)}" target="_blank" rel="noopener"><span><b>${esc(p.name)}</b><br><span class="muted small mono">${esc(p.sku)}</span></span><span class="btn ghost small">View COA</span></a>`).join('')
      : '<p class="muted">Certificates will be listed here as products are published.</p>';
  }

  const paras = (t) => String(t || '').split(/\n\s*\n/).filter(Boolean).map(x => `<p>${esc(x)}</p>`).join('');

  function applySite() {
    const set = (id, v) => { if (v) $(id).textContent = v; };
    set('#announcement', site.announcement);
    set('#heroEyebrow', site.heroEyebrow);
    set('#heroTitle', site.heroTitle);
    set('#heroText', site.heroText);
    set('#contactEmail', site.contactEmail);
    set('#footAddress', site.businessAddress);
    if (site.logo) $('#logo').src = site.logo;
    if (site.logoDark) $('#logoDark').src = site.logoDark;
    $('#aboutText').innerHTML = paras(site.about) || '<p>Tell your story here.</p>';
    $('#shippingText').innerHTML = paras(site.shippingPolicy);
    $('#returnText').innerHTML = paras(site.returnPolicy);
    $('#faqList').innerHTML = (site.faq || []).map((f, i) => `<details${i ? '' : ' open'}><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('');
    $('#year').textContent = new Date().getFullYear();
  }

  // ---------- cart ----------
  function saveCart() { store.set('rl_cart', cart); $('#count').textContent = cart.reduce((s, l) => s + l.qty, 0); }
  function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 1800); }

  document.addEventListener('click', (e) => {
    const t = e.target;
    const c = t.closest('[data-cat]'); if (c) { cat = c.dataset.cat; renderShop(); }
    const qb = t.closest('[data-q]'); if (qb) { qty = Math.max(1, Math.min(99, qty + +qb.dataset.q)); $('#q').textContent = qty; }
    const im = t.closest('[data-img]'); if (im) {
      $('#mainimg').innerHTML = `<img src="${esc(im.dataset.img)}" alt="">`;
      im.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === im));
    }
    if (t.closest('#add')) {
      const line = cart.find(l => l.id === currentId);
      if (line) line.qty = Math.min(99, line.qty + qty); else cart.push({ id: currentId, qty });
      saveCart(); toast(`Added ${qty} to cart`);
    }
    const cq = t.closest('[data-cq]'); if (cq) {
      const line = cart.find(l => l.id === cq.dataset.id);
      if (line) { line.qty = Math.max(1, Math.min(99, line.qty + +cq.dataset.cq)); saveCart(); renderCart(); }
    }
    const rm = t.closest('[data-rm]'); if (rm) { cart = cart.filter(l => l.id !== rm.dataset.rm); saveCart(); renderCart(); }
  });
  $('#attest').addEventListener('change', renderCart);
  $('#checkout').onclick = () => { $('#checkoutnote').hidden = false; };
  $('#search').addEventListener('input', renderShop);
  $('#sort').addEventListener('change', renderShop);

  // ---------- contact ----------
  $('#cform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const st = $('#cstatus'); st.hidden = false; st.className = 'note';
    const body = { name: $('#cname').value, email: $('#cemail').value, message: $('#cmsg').value };
    try {
      const r = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Message not sent.');
      st.textContent = 'Message sent. We will reply within one business day.'; e.target.reset();
    } catch (err) {
      st.className = 'note err'; st.textContent = err.message === 'Failed to fetch' ? 'Could not reach the server. Email us directly instead.' : err.message;
    }
  });

  // ---------- routing ----------
  function route() {
    let r = (location.hash || '#home').slice(1);
    let view = r;
    if (r.startsWith('product-')) { view = 'product'; renderProduct(decodeURIComponent(r.slice(8))); }
    if (!document.querySelector(`[data-view="${view}"]`)) view = 'home';
    document.querySelectorAll('[data-view]').forEach(el => el.hidden = el.dataset.view !== view);
    document.querySelectorAll('nav [data-r]').forEach(a => a.classList.toggle('on', a.dataset.r === view));
    if (view === 'home') renderHome();
    if (view === 'shop') renderShop();
    if (view === 'cart') renderCart();
    if (view === 'coa') renderCOA();
    window.scrollTo(0, 0);
  }
  addEventListener('hashchange', route);

  // ---------- load ----------
  async function load() {
    try {
      const [s, p] = await Promise.all([fetch('/api/site').then(r => r.json()), fetch('/api/products').then(r => r.json())]);
      site = s || {}; products = Array.isArray(p) ? p : [];
    } catch { site = window.RL_DEFAULT_SITE || {}; products = []; }
    applySite(); saveCart(); route();
  }
  route();
  load();
})();
