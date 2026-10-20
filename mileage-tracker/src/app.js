const $ = s => document.querySelector(s);
let trips = [], vehicles = [], pending = [], user = null, lastReport;
const fmt = iso => new Date(iso).toLocaleString();
const vName = id => (vehicles.find(v => v.id === id) || {}).name || id || '';
async function reload() { [trips, vehicles] = await Promise.all([api.getTrips(), api.vehicles()]); fillSelects(); render(); renderVehicles(); }
function showTab(t) { document.querySelectorAll('.tab').forEach(s => s.style.display = s.id === t ? 'block' : 'none'); }
document.querySelectorAll('nav button[data-tab]').forEach(b => b.onclick = () => showTab(b.dataset.tab));
function opts(sel, items, all = 'All') { const v = sel.value; sel.innerHTML = (all ? `<option value="">${all}</option>` : '') + items.map(([k, l]) => `<option value="${k}">${l}</option>`).join(''); sel.value = v; if (sel.selectedIndex < 0) sel.selectedIndex = 0; }
function fillSelects() {
  const vs = vehicles.map(v => [v.id, v.name]), ds = [...new Set(trips.map(t => t.driver).filter(Boolean))].map(d => [d, d]);
  opts($('#fVehicle'), vs); opts($('#rVehicle'), vs); opts($('#fDriver'), ds); opts($('#rDriver'), ds); opts($('#mVehicle'), vs, null); opts($('#tmVehicle'), vs, null);
}
const status = t => t.reimbursedAt ? `<span class="sent">sent ${t.reimbursedAt.slice(0, 10)}</span>` : t.queuedAt ? '<span class="queued">end of week</span>' : '';

function render() {
  const f = $('#filter').value, fv = $('#fVehicle').value, fd = $('#fDriver').value, [k, dir] = $('#sort').value.split('-');
  let list = trips.filter(t => (f === 'all' || (f === 'untagged' ? !t.category : f === 'queued' ? t.queuedAt && !t.reimbursedAt : f === 'sent' ? t.reimbursedAt : t.category === f))
    && (!fv || t.vehicleId === fv) && (!fd || t.driver === fd));
  list.sort((a, b) => (k === 'miles' ? a.miles - b.miles : a.startTime.localeCompare(b.startTime)) * (dir === 'asc' ? 1 : -1));
  $('#tripRows').innerHTML = '';
  for (const t of list) {
    const tr = document.createElement('tr'); tr.dataset.id = t.id;
    tr.innerHTML = `<td>${fmt(t.startTime)}</td><td>${vName(t.vehicleId)}</td><td>${t.driver || ''}</td><td class="route"></td>
      <td>${t.startOdo ?? ''}–${t.endOdo ?? ''}</td><td>${t.miles}${t.inferred ? '*' : ''}</td>
      <td><select class="${t.category || 'untagged'}"><option value="">untagged</option><option>business</option><option>personal</option></select></td>
      <td><input class="purpose"></td><td>${status(t)}</td><td></td>`;
    tr.querySelector('.route').textContent = Core.routeOf(t);
    const [sel, inp, act] = [tr.querySelector('select'), tr.querySelector('.purpose'), tr.lastElementChild];
    sel.value = t.category || ''; inp.value = t.purpose || ''; sel.disabled = !!t.reimbursedAt;
    sel.onchange = async () => { await api.tag(t.id, sel.value || null, inp.value); reload(); };
    inp.onchange = async () => { await api.tag(t.id, t.category, inp.value); reload(); };
    if (t.category === 'business' && !t.reimbursedAt) {
      act.append(btn('Send now', () => sendNow([t.id])), t.queuedAt ? btn('Unqueue', async () => { await api.unqueue([t.id]); reload(); }) : btn('Wait till end of week', async () => { await api.queue([t.id]); reload(); }));
    }
    if (!t.reimbursedAt) act.append(btn('✕', async () => { await api.saveTrips(trips.filter(x => x !== t)); reload(); }));
    $('#tripRows').append(tr);
  }
  const sum = c => trips.filter(t => t.category === c).reduce((s, t) => s + t.miles, 0).toFixed(1);
  $('#totals').textContent = `Total ${trips.reduce((s, t) => s + t.miles, 0).toFixed(1)} mi · business ${sum('business')} · personal ${sum('personal')}`;
}
const btn = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; return b; };
['#filter', '#fVehicle', '#fDriver', '#sort'].forEach(s => $(s).onchange = render);
async function sendNow(ids) { // the click is the user's send action: no extra confirmation
  try { const r = await api.sendNow(ids); $('#sendMsg').textContent = `Sent ${r.count} trip(s), ${r.miles} mi / $${r.amount.toFixed(2)} to ${r.to}`; }
  catch (e) { $('#sendMsg').textContent = 'Not sent: ' + e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
  await reload(); return $('#sendMsg').textContent;
}

// Post-trip prompt (every completed trip)
api.onTripEnded(t => { pending.push(t); reload(); if (!$('#prompt').open) next(); });
function next() { const t = pending[0]; if (!t) return;
  $('#pTitle').textContent = `${vName(t.vehicleId)}: trip ended`; $('#pInfo').textContent = `${t.miles} mi · ${fmt(t.startTime)} → ${fmt(t.endTime)} · odometer ${t.startOdo}–${t.endOdo}`;
  $('#pRoute').value = Core.routeOf(t); $('#pPurpose').value = ''; $('#prompt').showModal(); }
$('#prompt').addEventListener('close', async () => {
  const t = pending.shift(), v = $('#prompt').returnValue;
  if (t && v) { const biz = v !== 'personal'; await api.tag(t.id, biz ? 'business' : 'personal', biz ? $('#pPurpose').value : '', $('#pRoute').value);
    if (v === 'now') await sendNow([t.id]); else if (v === 'week') await api.queue([t.id]); }
  await reload(); next();
});
api.onVehicle(e => { if (e.event === 'snapshot') $('#status').textContent = `${e.vehicleName}: ${e.snapshot.shift_state} · ${e.snapshot.odometer} mi`;
  if (e.event === 'error') $('#status').textContent = `${e.vehicleName}: ${e.message}`; });
api.onTripsChanged(reload);

$('#manual').onsubmit = async ev => { ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target)), so = Number(d.startOdo) || null, eo = Number(d.endOdo) || null;
  trips.push({ id: 'm' + Date.now(), source: 'manual', vehicleId: d.vehicleId, driver: user.name, startTime: new Date(d.start).toISOString(), endTime: new Date(d.end).toISOString(),
    startOdo: so, endOdo: eo, miles: Number(d.miles) || (so && eo ? Math.round((eo - so) * 10) / 10 : 0), route: d.route, category: d.category, purpose: d.purpose });
  ev.target.reset(); await api.saveTrips(trips); reload(); };
$('#seed').onclick = async () => { const now = Date.now(), day = 864e5, P = ['Client visit', 'Site inspection', 'Supplier meeting']; let odo = 88000;
  for (let i = 7; i >= 0; i--) { const s = new Date(now - (i + 1) * day * 3), m = Math.round((5 + Math.random() * 40) * 10) / 10, biz = i % 2 === 0, v = vehicles[i % vehicles.length] || {};
    trips.push({ id: 's' + s.getTime(), source: 'sample', vehicleId: v.id, driver: v.owner, startTime: s.toISOString(), endTime: new Date(s.getTime() + m * 9e4).toISOString(),
      startOdo: odo, endOdo: odo = Math.round((odo + m) * 10) / 10, miles: m, route: 'Home → ' + (biz ? 'Job site' : 'Store') + ' → Home', category: biz ? 'business' : 'personal', purpose: biz ? P[i % 3] : '' }); }
  await api.saveTrips(trips); reload(); };

// Report
function reportTrips() { const fv = $('#rVehicle').value, fd = $('#rDriver').value; return trips.filter(t => (!fv || t.vehicleId === fv) && (!fd || t.driver === fd)); }
function runReport() { const r = Core.buildReport(reportTrips(), $('#rFrom').value, $('#rTo').value, Number($('#rRate').value) || null, $('#rIncl').checked); lastReport = r;
  $('#reportOut').innerHTML = Core.reportHtml(r, $('#rRate').value ? '$' + $('#rRate').value + '/mi (custom)' : null); return r; }
$('#rRun').onclick = runReport; $('#printBtn').onclick = () => print();
$('#rCsv').onclick = () => { const r = runReport(); return api.saveCsv(`mileage-report-${r.from}_${r.to}.csv`, Core.reportCsv(r)); };
$('#rPdf').onclick = () => { const r = runReport(); return api.savePdf(`mileage-report-${r.from}_${r.to}.pdf`); };
const unsentIds = () => { $('#rIncl').checked = false; return runReport().rows.map(x => x.id); };
$('#rSendNow').onclick = () => { const ids = unsentIds(); return ids.length ? sendNow(ids) : ($('#sendMsg').textContent = 'No unsent business trips in this range'); };
$('#rQueue').onclick = async () => { const n = await api.queue(unsentIds()); $('#sendMsg').textContent = `${n} trip(s) will go to Sugar at the end of the week`; reload(); };
$('#rPreview').onclick = async () => { const ids = unsentIds(); if (!ids.length) { $('#sendMsg').textContent = 'No unsent business trips in this range'; return; }
  const p = await api.preview(ids); $('#ePreview').textContent = `To: ${p.to}\nFrom: ${p.from}\nSubject: ${p.subject}\n\n${p.text}\n\nAttachments: ${p.attachments.join(', ')}`; $('#emailDlg').showModal(); };

// Vehicles
function renderVehicles() { $('#vRows').innerHTML = '';
  for (const v of vehicles) { const tr = document.createElement('tr');
    tr.innerHTML = `<td><input data-k="name"></td><td><input data-k="owner"></td><td><input data-k="model"></td><td><input data-k="vin" size="19"></td><td>${v.source}</td><td>${v.source === 'simulator' ? 'simulated' : v.connected ? 'connected' : 'not connected'}</td><td></td>`;
    tr.querySelectorAll('input').forEach(i => { i.value = v[i.dataset.k] || ''; i.onchange = async () => { v[i.dataset.k] = i.value; await api.saveVehicles(vehicles); reload(); }; });
    if (v.source !== 'simulator' && !v.connected) tr.lastElementChild.append(btn('Connect my Tesla', connectTesla));
    if (!v.isDefault) tr.lastElementChild.append(btn('Remove', async () => { await api.saveVehicles(vehicles.filter(x => x !== v)); reload(); }));
    $('#vRows').append(tr); } }
async function connectTesla() { $('#vMsg').textContent = 'Sign in to Tesla in your browser and approve access…';
  try { const { key, cars } = await api.teslaConnect(); $('#carList').innerHTML = cars.map(c => `<label><input type="checkbox" value="${c.vin}" data-name="${c.name}" checked> ${c.name} (${c.vin})</label>`).join('');
    $('#pickCars').showModal(); $('#pickCars').onclose = async () => { if ($('#pickCars').returnValue !== 'ok') return;
      await api.teslaAddCars(key, [...$('#carList').querySelectorAll('input:checked')].map(i => ({ vin: i.value, name: i.dataset.name }))); $('#vMsg').textContent = 'Car linked'; reload(); };
  } catch (e) { $('#vMsg').textContent = e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); } }
$('#addVehicle').onclick = connectTesla;
$('#addSim').onclick = async () => { await api.addSimulated('Simulated Tesla ' + (vehicles.length + 1)); reload(); };

// Settings (dotted names map to nested objects)
async function loadSettings() { const s = await api.getSettings();
  for (const el of $('#sForm').elements) if (el.name) { const v = el.name.split('.').reduce((o, k) => o && o[k], s); if (v != null) el.value = String(v); }
  if (s.rate) $('#rRate').value = s.rate; }
$('#sForm').onsubmit = async ev => { ev.preventDefault(); const out = {};
  for (const [k, v] of new FormData(ev.target)) { const p = k.split('.'); let o = out; while (p.length > 1) o = o[p[0]] = o[p.shift()] || {}; o[p[0]] = v; }
  out.rate = Number(out.rate) || null; out.smtp.port = Number(out.smtp.port) || 587; out.smtp.secure = out.smtp.secure === 'true'; out.weekEnd.day = Number(out.weekEnd.day);
  await api.saveSettings(out); $('#sMsg').textContent = 'Saved'; loadSettings(); };
$('#tmImport').onclick = async () => { try { $('#tmMsg').textContent = `Imported ${await api.importTeslaMate($('#tmUrl').value, $('#tmSince').value || null, $('#tmVehicle').value)} drives`; reload(); }
  catch (e) { $('#tmMsg').textContent = 'TeslaMate: ' + e.message; } };

// Account
async function enter(u) { user = u; $('#signin').style.display = 'none'; $('#appRoot').style.display = 'block'; $('#who').textContent = u.email;
  const today = new Date(), first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  $('#rFrom').value = first.toISOString().slice(0, 10); $('#rTo').value = today.toISOString().slice(0, 10);
  await reload(); loadSettings(); showTab('trips'); }
$('#googleBtn').onclick = async () => { $('#signinMsg').textContent = 'Finish signing in in your browser…';
  try { enter(await api.signIn()); } catch (e) { $('#signinMsg').textContent = e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); } };
$('#signOut').onclick = async () => { await api.signOut(); location.reload(); };
(async () => { const u = await api.account(); if (u) await enter(u); else $('#signin').style.display = 'block';
  if (location.search.includes('selftest')) selftest(); })();

async function selftest() {
  const out = { steps: [] }, wait = (p, ms = 60000) => new Promise((res, rej) => { const t0 = Date.now(), i = setInterval(() => { if (p()) { clearInterval(i); res(); } else if (Date.now() - t0 > ms) { clearInterval(i); rej(new Error('timeout')); } }, 100); });
  const step = (k, v) => { out[k] = v; out.steps.push(k); };
  try {
    if (!user) { $('#googleBtn').click(); await wait(() => user); } step('account', user.email);
    step('defaultVehicle', vehicles.map(v => `${v.name}/${v.vin}/${v.connected ? 'connected' : 'needs Connect'}`));
    await api.addSimulated('Chris Tesla'); await api.addSimulated('John Tesla'); await reload();
    vehicles[1].owner = 'Chris'; vehicles[2].owner = 'John'; await api.saveVehicles(vehicles); await reload();
    const s = await api.getSettings(); s.smtp = { ...s.smtp, host: '127.0.0.1', port: Number(window.MT_SMTP_PORT || 2525), secure: false, user: '', pass: '', from: 'lester@ovanova.co' };
    s.signature = 'Thanks,\nLester'; await api.saveSettings(s);
    await wait(() => $('#prompt').open); const first = pending[0]; step('promptShownFor', vName(first.vehicleId));
    $('#pPurpose').value = 'Drive to HQ for the Friday team meeting'; $('#pNow').click();
    await wait(() => /Sent|Not sent/.test($('#sendMsg').textContent)); step('sendNow', $('#sendMsg').textContent);
    await wait(() => $('#prompt').open); $('#pPurpose').value = 'Site inspection'; const q = pending[0].id; $('#pWeek').click();
    await wait(() => trips.some(t => t.id === q && t.queuedAt)); step('queued', true);
    step('doubleSubmit', await sendNow([first.id]));
    $('#filter').value = 'sent'; render(); step('sentRows', $('#tripRows').children.length); $('#filter').value = 'all';
    $('#fVehicle').value = vehicles[1].id; render(); step('chrisRows', [...$('#tripRows').children].every(r => r.children[1].textContent === 'Chris Tesla')); $('#fVehicle').value = ''; render();
    $('#seed').click(); await wait(() => trips.filter(t => t.source === 'sample').length === 8);
    $('#rFrom').value = '2026-01-01'; $('#rTo').value = '2026-12-31'; $('#rIncl').checked = true;
    step('csvPath', await $('#rCsv').onclick()); showTab('report'); step('pdfPath', await $('#rPdf').onclick());
    step('report', { rows: lastReport.rows.length, miles: lastReport.totalMiles, amount: lastReport.totalAmount });
    // let the three simulated cars finish more trips; answer every prompt
    const end = Date.now() + 4000; while (Date.now() < end) { if ($('#prompt').open) $('#pNo').click(); await new Promise(r => setTimeout(r, 100)); }
    await reload(); step('tripsFromCars', trips.filter(t => t.source === 'tesla').length);
    out.ok = true;
  } catch (e) { out.ok = false; out.error = e.message; }
  api.selftestDone(out);
}
