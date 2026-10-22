import { reconcile, toCsv, PACKS_PER_CARTON } from './reconcile.js';

const KEY = 'dumbai-cigcount-v1';
const BRANDS = ['Marlboro Red','Marlboro Gold','Marlboro Silver','Marlboro Menthol','Camel Blue','Camel Crush','Camel Turkish Royal','Newport Menthol','Newport Red','Kool Menthol','Winston','Pall Mall','L&M','Merit','Virginia Slims','American Spirit','Maverick','Montego','Pyramid','Other'];
const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2, 9);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const packsOf = (it) => (Number(it.packs) || 0) + (Number(it.cartons) || 0) * PACKS_PER_CARTON;

let state = load() || { store: '', date: new Date().toISOString().slice(0, 10), avgPrice: 9, taxRate: 0.0925, photos: [], rows: {}, invoiceTotal: '', checkedAt: '' };
// rows: brand -> {beginning, purchases, sales, manualActual (null = use photo total)}
function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); $('saveNote').textContent = 'Saved on this phone just now. It does not leave this phone except a photo you send for counting.'; }
  catch { $('saveNote').textContent = 'This phone is out of save space. Download the sheet before you close this page.'; }
}
function brands() {
  const set = new Set([...BRANDS, ...Object.keys(state.rows || {})]);
  state.photos.forEach((p) => p.items.forEach((it) => set.add(it.brand)));
  return [...set].filter((b) => {
    const r = state.rows[b] || {};
    return state.photos.some((p) => p.items.some((it) => it.brand === b)) || r.beginning || r.purchases || r.sales || r.manualActual != null || r.added;
  }).sort((a, b) => a.localeCompare(b));
}
function photoActual(brand) {
  return state.photos.reduce((s, p) => s + p.items.filter((it) => it.brand === brand).reduce((a, it) => a + packsOf(it), 0), 0);
}
function actualFor(brand) {
  const r = state.rows[brand] || {};
  return r.manualActual != null && r.manualActual !== '' ? Number(r.manualActual) || 0 : photoActual(brand);
}
function currentResult() {
  const rows = brands().map((brand) => {
    const r = state.rows[brand] || {};
    return { brand, beginning: Number(r.beginning) || 0, purchases: Number(r.purchases) || 0, sales: Number(r.sales) || 0, actual: actualFor(brand) };
  });
  return reconcile(rows, { avgPrice: Number(state.avgPrice) || 9, taxRate: Number(state.taxRate) || 0.0925 });
}
function allChecked() { return state.photos.length > 0 && state.photos.every((p) => p.verified); }

async function fileToDataUrl(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1100 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.82);
}

async function countPhoto(photo, statusEl) {
  statusEl.textContent = 'Counting packs in this photo…';
  try {
    const res = await fetch('/api/count', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'shelf', image: photo.dataUrl }) });
    const data = await res.json();
    if (data.ok && data.items?.length) {
      photo.items = data.items.map((it) => ({ id: uid(), ...it }));
      photo.verified = false;
      statusEl.textContent = `Counter found ${data.totalPacks} packs. Now check every row below against the shelf and fix anything wrong.`;
    } else if (data.ok) {
      statusEl.textContent = 'Counter could not see any packs. Add brands by hand below, or retake the photo closer.';
    } else {
      statusEl.textContent = (data.error || 'Counting is off. Count by hand below.') + ' The sheet math still works.';
    }
  } catch { statusEl.textContent = 'Counting could not be reached. Count by hand below — the sheet math still works.'; }
  save(); render();
}

function renderPhotos() {
  const box = $('photos'); box.innerHTML = '';
  $('noPhotoNote').style.display = state.photos.length ? 'none' : '';
  state.photos.forEach((photo, pi) => {
    const div = document.createElement('div'); div.className = 'photoBox';
    const total = photo.items.reduce((s, it) => s + packsOf(it), 0);
    div.innerHTML = `
      <div class="photoWrap"><img alt="Shelf photo ${pi + 1}" src="${photo.dataUrl}">
        ${photo.marks.map((m, mi) => `<button type="button" class="dot" style="left:${m.x}%;top:${m.y}%" data-dot="${mi}" aria-label="Remove your mark for ${esc(m.brand)}">${mi + 1}</button>`).join('')}
      </div>
      <p class="small">Photo ${pi + 1} — <strong>${total} packs</strong> counted here. Tap the photo to add a missed pack for the brand picked below. Tap a numbered dot to remove it.</p>
      <label>Brand for tap-to-add</label>
      <select data-tapbrand>${BRANDS.map((b) => `<option ${b === (photo.tapBrand || 'Other') ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>
      <p class="small" data-status role="status">${esc(photo.status || '')}</p>
      <div data-rows></div>
      <div class="actions">
        <button type="button" class="secondary" data-addbrand>+ Add a brand in this photo</button>
        <button type="button" class="secondary" data-recount>Count this photo again</button>
        <button type="button" class="secondary" data-remove>Remove photo</button>
      </div>
      <label class="checkline"><input type="checkbox" data-verified ${photo.verified ? 'checked' : ''}>
      <span><strong>I checked every row against the shelf</strong> and fixed anything wrong.${photo.verified && photo.verifiedAt ? `<br><span class="small">Checked ${esc(photo.verifiedAt)}</span>` : ''}</span></label>`;
    const rowsBox = div.querySelector('[data-rows]');
    if (!photo.items.length) rowsBox.innerHTML = '<p class="small">No brands yet. Use “Add a brand in this photo.”</p>';
    photo.items.forEach((it) => {
      const row = document.createElement('div');
      row.style.cssText = 'border-top:1px solid var(--line);padding:8px 0';
      const low = Number(it.confidence) > 0 && Number(it.confidence) < 0.75;
      row.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><strong>${esc(it.brand)}</strong>
        ${Number(it.confidence) > 0 ? `<span class="pill ${low ? 'low' : 'good'}">${low ? 'Needs a look' : 'Counter fairly sure'}</span>` : '<span class="pill good">Added by you</span>'}</div>
        <div class="grid2">
          <div><span class="small">Single packs</span><div class="stepper"><button type="button" data-step="packs,-1" aria-label="One less pack">−</button><strong>${it.packs}</strong><button type="button" data-step="packs,1" aria-label="One more pack">+</button></div></div>
          <div><span class="small">Sealed cartons (×10)</span><div class="stepper"><button type="button" data-step="cartons,-1" aria-label="One less carton">−</button><strong>${it.cartons}</strong><button type="button" data-step="cartons,1" aria-label="One more carton">+</button></div></div>
        </div><p class="small">= ${packsOf(it)} packs. <button type="button" class="secondary" data-del style="min-height:36px;padding:4px 10px">Remove brand</button></p>`;
      row.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
        const [f, d] = b.dataset.step.split(','); it[f] = Math.max(0, (Number(it[f]) || 0) + Number(d));
        photo.verified = false; save(); render();
      }));
      row.querySelector('[data-del]').addEventListener('click', () => { photo.items = photo.items.filter((x) => x.id !== it.id); photo.verified = false; save(); render(); });
      rowsBox.appendChild(row);
    });
    div.querySelector('.photoWrap img').addEventListener('click', (e) => {
      const r = e.target.getBoundingClientRect();
      const brand = div.querySelector('[data-tapbrand]').value;
      const x = +(((e.clientX - r.left) / r.width) * 100).toFixed(1), y = +(((e.clientY - r.top) / r.height) * 100).toFixed(1);
      photo.marks.push({ x, y, brand });
      let it = photo.items.find((i) => i.brand === brand);
      if (!it) { it = { id: uid(), brand, packs: 0, cartons: 0, confidence: 0 }; photo.items.push(it); }
      it.packs = (Number(it.packs) || 0) + 1;
      photo.tapBrand = brand; photo.verified = false; save(); render();
    });
    div.querySelectorAll('[data-dot]').forEach((d) => d.addEventListener('click', (e) => {
      e.stopPropagation();
      const m = photo.marks[Number(d.dataset.dot)];
      const it = photo.items.find((i) => i.brand === m.brand);
      if (it) it.packs = Math.max(0, (Number(it.packs) || 0) - 1);
      photo.marks.splice(Number(d.dataset.dot), 1);
      photo.verified = false; save(); render();
    }));
    div.querySelector('[data-tapbrand]').addEventListener('change', (e) => { photo.tapBrand = e.target.value; save(); });
    div.querySelector('[data-addbrand]').addEventListener('click', () => {
      const brand = div.querySelector('[data-tapbrand]').value;
      if (!photo.items.some((i) => i.brand === brand)) photo.items.push({ id: uid(), brand, packs: 0, cartons: 0, confidence: 0 });
      save(); render();
    });
    div.querySelector('[data-remove]').addEventListener('click', () => { state.photos.splice(pi, 1); save(); render(); });
    div.querySelector('[data-recount]').addEventListener('click', () => countPhoto(photo, div.querySelector('[data-status]')));
    div.querySelector('[data-verified]').addEventListener('change', (e) => {
      photo.verified = e.target.checked;
      photo.verifiedAt = e.target.checked ? new Date().toLocaleString() : '';
      if (photo.verified) state.checkedAt = photo.verifiedAt;
      save(); render();
    });
    box.appendChild(div);
  });
}

function renderMatchAndSheet() {
  const result = currentResult();
  const t = $('matchTable');
  t.innerHTML = `<tr><th>Brand</th><th>Started with</th><th>Delivered (+)</th><th>Register sold (−)</th><th>Counted</th></tr>` +
    result.brands.map((b) => {
      const r = state.rows[b.brand] || {};
      const counted = r.manualActual != null && r.manualActual !== '' ? Number(r.manualActual) : photoActual(b.brand);
      return `<tr><td>${esc(b.brand)}</td>
      <td><input class="num" type="number" min="0" data-row="${esc(b.brand)}" data-f="beginning" value="${r.beginning ?? ''}" placeholder="0" aria-label="Started with ${esc(b.brand)}"></td>
      <td><input class="num" type="number" min="0" data-row="${esc(b.brand)}" data-f="purchases" value="${r.purchases ?? ''}" placeholder="0" aria-label="Delivered ${esc(b.brand)}"></td>
      <td><input class="num" type="number" min="0" data-row="${esc(b.brand)}" data-f="sales" value="${r.sales ?? ''}" placeholder="0" aria-label="Register sold ${esc(b.brand)}"></td>
      <td><input class="num" type="number" min="0" data-row="${esc(b.brand)}" data-f="manualActual" value="${r.manualActual ?? ''}" placeholder="${photoActual(b.brand)}" aria-label="Counted ${esc(b.brand)}"><br><span class="small">photo: ${photoActual(b.brand)}</span></td></tr>`;
    }).join('') || '<tr><td colspan="5">Add a shelf photo first, or add a brand below.</td></tr>';
  t.querySelectorAll('[data-row]').forEach((inp) => inp.addEventListener('change', () => {
    const brand = inp.dataset.row;
    state.rows[brand] = state.rows[brand] || { added: true };
    state.rows[brand][inp.dataset.f] = inp.value === '' ? '' : Math.max(0, Number(inp.value) || 0);
    save(); renderSheetOnly();
  }));

  renderSheetOnly();
}

function renderSheetOnly() {
  const result = currentResult();
  const checked = allChecked();
  $('stampLine').innerHTML = checked
    ? `<span class="stamp checked">CHECKED AGAINST THE SHELF — ${esc(state.checkedAt || '')}</span>`
    : `<span class="stamp draft">DRAFT — NOT CHECKED</span> <span class="small">Check every photo in Step 1 before you trust this sheet.</span>`;
  const worst = [...result.brands].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 3).filter((b) => b.diff !== 0);
  $('sheet').innerHTML = `
    <p><strong>${esc(state.store || 'Store')}</strong> — count date ${esc(state.date || '')}<br>
    <span class="small">Started + Delivered − Register sold = Should be there. Difference = Counted − Should be there.</span></p>
    <div style="overflow-x:auto"><table>
    <tr><th>Brand</th><th>Started</th><th>Delivered</th><th>Sold</th><th>Should be there</th><th>Counted</th><th>Difference</th></tr>
    ${result.brands.map((b) => `<tr><td>${esc(b.brand)}</td><td>${b.beginning}</td><td>${b.purchases}</td><td>${b.sales}</td><td>${b.expected}</td><td>${b.actual}</td>
      <td>${b.diff > 0 ? '+' : ''}${b.diff} ${b.status === 'exact' ? '<span class="pill good">Matches</span>' : b.status === 'close' ? '<span class="pill low">Close — recount</span>' : '<span class="pill check">Check this brand</span>'}</td></tr>`).join('')}
    <tr><th>TOTAL packs</th><th>${result.totals.beginning}</th><th>${result.totals.purchases}</th><th>${result.totals.sales}</th><th>${result.totals.expected}</th><th>${result.totals.actual}</th><th>${result.totals.diff > 0 ? '+' : ''}${result.totals.diff}</th></tr>
    </table></div>
    <p>Total counted: <strong>${result.totals.actual} packs</strong> = ${result.cartonsActual} cartons = ${result.sticksActual} cigarettes.</p>`;
  let msg = '';
  if (!result.brands.length) msg = '<p>Add a photo or a brand to see your sheet.</p>';
  else if (result.totals.diff === 0) msg = '<div class="notice good"><strong>What this means:</strong> Counts match. Keep this sheet with your invoices and register report.</div>';
  else if (result.totals.diff < 0) msg = `<div class="notice bad"><strong>What this means:</strong> ${result.missingPacks} packs are missing. First recount ${worst.map((b) => esc(b.brand)).join(', ') || 'the shelf'} — a miscount is the most common reason. If they are still missing, they may have been sold off the register, stolen, or damaged. At your usual price that is about $${result.missingRetailValue} in sales and roughly $${result.estimatedSalesTaxOnMissing} in sales tax if they were sold without tax collected. This is an estimate for your bookkeeper, not a tax bill. The 62¢-a-pack stamp tax on them was already paid when your wholesaler stamped them.</div>`;
  else msg = `<div class="notice warn"><strong>What this means:</strong> You have ${result.extraPacks} more packs than the paper says. A delivery may not have been typed in, the register may have missed sales, or the last count was low. Recount ${worst.map((b) => esc(b.brand)).join(', ') || 'the shelf'} and check invoices since the last count.</div>`;
  const invTotal = Number(state.invoiceTotal) || 0;
  if (invTotal && invTotal !== result.totals.purchases) msg += `<div class="notice warn"><strong>Invoice check:</strong> Your invoices say ${invTotal} packs total, but “Delivered” above adds to ${result.totals.purchases}. Fix the difference before you trust the sheet.</div>`;
  if (invTotal && invTotal === result.totals.purchases) msg += '<div class="notice good"><strong>Invoice check passed:</strong> “Delivered” matches the total printed on your invoices.</div>';
  $('explain').innerHTML = msg;
}

function render() { renderPhotos(); renderMatchAndSheet(); }

function bind() {
  $('store').value = state.store || ''; $('countDate').value = state.date || '';
  $('avgPrice').value = state.avgPrice ?? 9; $('taxRate').value = state.taxRate ?? 0.0925;
  $('invoiceTotal').value = state.invoiceTotal || '';
  const sync = () => { state.store = $('store').value; state.date = $('countDate').value; state.avgPrice = Number($('avgPrice').value) || 9; state.taxRate = Number($('taxRate').value) || 0.0925; state.invoiceTotal = $('invoiceTotal').value; save(); renderSheetOnly(); };
  ['store','countDate','avgPrice','taxRate','invoiceTotal'].forEach((id) => $(id).addEventListener('change', sync));

  $('shelfPhotos').addEventListener('change', async (e) => {
    for (const file of [...e.target.files]) {
      const photo = { id: uid(), dataUrl: await fileToDataUrl(file), items: [], marks: [], tapBrand: 'Other', verified: false, verifiedAt: '', status: '' };
      state.photos.push(photo); save(); render();
      await countPhoto(photo, document.querySelector(`#photos .photoBox:last-child [data-status]`));
    }
    e.target.value = '';
  });

  $('readInvoice').addEventListener('click', async () => {
    const file = $('invoicePhoto').files[0];
    const msg = $('invoiceMsg');
    if (!file) { msg.textContent = 'Pick or take a photo of the invoice first.'; return; }
    msg.textContent = 'Reading invoice…';
    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await fetch('/api/count', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'invoice', image: dataUrl }) });
      const data = await res.json();
      if (!data.ok || !data.items?.length) { msg.textContent = (data.error || 'Could not read that invoice.') + ' Type the Delivered numbers in the table instead.'; return; }
      data.items.forEach((it) => {
        state.rows[it.brand] = state.rows[it.brand] || { added: true };
        state.rows[it.brand].purchases = (Number(state.rows[it.brand].purchases) || 0) + (Number(it.packs) || 0) + (Number(it.cartons) || 0) * PACKS_PER_CARTON;
      });
      msg.textContent = `Added ${data.totalPacks} delivered packs from the invoice. Look at each Delivered number and fix it against the paper invoice — rows the reader was unsure about need your eyes.`;
      save(); render();
    } catch { msg.textContent = 'Could not reach the invoice reader. Type the Delivered numbers in the table instead.'; }
  });

  $('addBrandRow').addEventListener('click', () => {
    const name = prompt('Brand and kind, like “Marlboro Gold”:');
    if (!name) return;
    state.rows[name.trim()] = { ...(state.rows[name.trim()] || {}), added: true };
    save(); render();
  });

  $('printBtn').addEventListener('click', () => window.print());
  $('csvBtn').addEventListener('click', () => {
    const blob = new Blob([toCsv(currentResult(), { store: state.store, date: state.date })], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `cigarette-count-${state.date || 'sheet'}.csv`; a.click(); URL.revokeObjectURL(a.href);
  });
  $('copyBtn').addEventListener('click', async () => {
    const r = currentResult();
    const text = `${state.store || 'Store'} cigarette count ${state.date || ''}\nCounted ${r.totals.actual} packs. Should be there: ${r.totals.expected}. Difference: ${r.totals.diff > 0 ? '+' : ''}${r.totals.diff} packs.\nStarted ${r.totals.beginning} + Delivered ${r.totals.purchases} - Register sold ${r.totals.sales}.\n${allChecked() ? 'Checked against the shelf ' + state.checkedAt : 'DRAFT - NOT CHECKED'}`;
    try { await navigator.clipboard.writeText(text); $('copyBtn').textContent = 'Copied'; setTimeout(() => $('copyBtn').textContent = 'Copy summary to text', 1500); }
    catch { prompt('Copy this summary:', text); }
  });
  $('clearBtn').addEventListener('click', () => {
    if (!confirm('Start a new count? This clears this count from this phone. Download or print first if you need it.')) return;
    localStorage.removeItem(KEY);
    state = { store: state.store, date: new Date().toISOString().slice(0, 10), avgPrice: 9, taxRate: 0.0925, photos: [], rows: {}, invoiceTotal: '', checkedAt: '' };
    save(); location.reload();
  });
}

bind(); render();
