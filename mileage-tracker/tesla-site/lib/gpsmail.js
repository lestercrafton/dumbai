// Reimbursement email for trips measured by phone GPS (no odometer readings). Same layout and tone as the
// odometer email in core.js, but the calculation table lists GPS miles per trip and only a CSV is attached.
const C = require('./core');
const round = (n, p) => Math.round(n * 10 ** p) / 10 ** p;
const TZ = 'America/Chicago';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
const parts = d => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h12' })
  .formatToParts(new Date(d)).map(x => [x.type, x.value]));
const md = d => { const p = parts(d); return `${p.month}/${p.day}/${p.year}`; };
const hm = d => { const p = parts(d); return `${p.hour}:${p.minute} ${p.dayPeriod}`; };
const ymd = d => { const p = parts(d); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; };
const num = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 });
const usd = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const escH = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function dateSpan(a, b) { const x = parts(a), y = parts(b);
  if (ymd(a) === ymd(b)) return `${MON[x.month - 1]} ${x.day}, ${x.year}`;
  if (x.month === y.month && x.year === y.year) return `${MON[x.month - 1]} ${x.day}–${y.day}, ${x.year}`;
  return `${MON[x.month - 1]} ${x.day} – ${MON[y.month - 1]} ${y.day}, ${y.year}`; }
const rateFor = (t, opts) => opts.rate || C.irsRate(ymd(t.startTime));
const mileSource = t => t.source === 'phone-gps' ? 'phone GPS' : t.startOdo != null ? 'odometer' : 'GPS';

function gpsCsv(rows) {
  const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"', ll = l => l && l.lat != null ? `${l.lat.toFixed(5)}, ${l.lon.toFixed(5)}` : (l && l.name) || '';
  const out = [['Date', 'Start (Central)', 'End (Central)', 'Vehicle', 'Route', 'Purpose', 'Start point', 'End point', 'Miles', 'Measured by', 'Rate', 'Amount'].map(esc).join(',')];
  for (const r of rows) out.push([ymd(r.startTime), hm(r.startTime), hm(r.endTime), r.vehicleName, C.routeOf(r), r.purpose || 'Business', ll(r.startLoc), ll(r.endLoc), r.miles, mileSource(r), r.rate, r.amount.toFixed(2)].map(esc).join(','));
  const miles = round(rows.reduce((s, r) => s + r.miles, 0), 1), amt = round(rows.reduce((s, r) => s + r.amount, 0), 2);
  out.push(['TOTAL', '', '', '', '', '', '', '', miles, '', '', amt.toFixed(2)].map(esc).join(','));
  return out.join('\n');
}

function gpsEmail(tripsIn, vehicles, user, opts = {}) {
  const trips = [...tripsIn].sort((a, b) => a.startTime.localeCompare(b.startTime)), first = trips[0], last = trips[trips.length - 1];
  const vName = t => { const v = vehicles.find(x => x.id === t.vehicleId); return v ? v.name : 'Personal vehicle'; };
  const rows = trips.map(t => { const rate = rateFor(t, opts); return { ...t, rate, amount: round(t.miles * rate, 2), vehicleName: vName(t) }; });
  const miles = round(rows.reduce((s, t) => s + t.miles, 0), 1), amount = round(rows.reduce((s, t) => s + t.amount, 0), 2);
  const rates = [...new Set(rows.map(t => t.rate))], many = trips.length > 1;
  const label = opts.title || (many ? 'Weekly Business' : (first.purpose || 'Business'));
  const subject = `Mileage Reimbursement Request – ${dateSpan(first.startTime, last.endTime)} ${label} Trip${many ? 's' : ''} (${num(miles)} miles / $${usd(amount)})`;
  const L = [];
  L.push(`${opts.greeting || 'Sugar'},`, '', many
    ? `Here's my mileage reimbursement request for this week's ${trips.length} business trips. Everything you should need is below, and a CSV of the trips is attached.`
    : `Here's my mileage reimbursement request for the ${first.purpose || 'business'} trip. Everything you should need is below, and a CSV of the trip is attached.`, '');
  L.push('**Trip dates**', `Departed ${md(first.startTime)} · Returned ${md(last.endTime)}`, '', '**Route and business purpose**', '');
  for (const t of rows) L.push(`| ${md(t.startTime)} ${hm(t.startTime)}–${hm(t.endTime)} | ${C.routeOf(t)} | ${t.purpose || 'Business'} |`);
  const vs = [...new Set(rows.map(t => t.vehicleId))].map(id => vehicles.find(v => v.id === id)).filter(Boolean);
  L.push('', '**Vehicle**'); if (vs.length) for (const v of vs) L.push(`${v.name}${v.model && v.model !== v.name ? ' · ' + v.model : ''}${v.vin ? ' · VIN ' + v.vin : ''} (personal vehicle)`); else L.push('Personal vehicle');
  L.push('', '**Mileage and calculation**', '');
  for (const t of rows) L.push(`| ${md(t.startTime)} ${many ? t.vehicleName + ' ' : ''}miles (${mileSource(t)}) | ${num(t.miles)} |`);
  L.push(`| Total business miles | ${num(miles)} |`);
  if (rates.length === 1) L.push(`| IRS standard business mileage rate | × $${rates[0]} |`);
  else for (const r of rates) L.push(`| Miles at $${r}/mile | ${num(rows.filter(t => t.rate === r).reduce((s, t) => s + t.miles, 0))} |`);
  L.push(`| Total reimbursement requested | $${usd(amount)} |`, '');
  L.push('Miles for each trip were recorded by GPS from start to stop, so only the business trips listed are counted.', '');
  if (!opts.rate) L.push(rates.length === 1 && rates[0] === 0.76 ? 'The $0.76/mile figure is the IRS standard business mileage rate in effect from July 1, 2026 through December 31, 2026, so it is the correct rate for this trip.'
    : 'Each trip uses the IRS standard business mileage rate in effect on its date ($0.725/mile Jan 1 – Jun 30, 2026; $0.76/mile from Jul 1, 2026).', '');
  L.push('Let me know if you need anything else to get this processed.', '', opts.signature || `Thanks,\n${((user && user.name) || '').split(' ')[0]}`);
  const text = L.join('\n');
  const html = '<div style="font-family:Arial,sans-serif">' + text.split('\n\n').map(block => { const lines = block.split('\n');
    if (lines.every(l => l.startsWith('|'))) return '<table border="1" cellpadding="4" style="border-collapse:collapse">' + lines.map(l => '<tr>' + l.slice(1, -1).split(' | ').map(c => `<td>${escH(c.trim())}</td>`).join('') + '</tr>').join('') + '</table>';
    return '<p>' + lines.map(l => escH(l).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')).join('<br>') + '</p>'; }).join('') + '</div>';
  const from = ymd(first.startTime), to = ymd(last.endTime);
  return { subject, text, html, miles, amount, rows, attachments: [{ filename: `mileage-report-${from}_${to}.csv`, content: gpsCsv(rows), contentType: 'text/csv' }] };
}
module.exports = { gpsEmail, gpsCsv, ymd, hm, TZ };
