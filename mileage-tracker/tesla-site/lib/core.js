// Shared logic: trip detection, IRS rates, report generation. Works in Node and browser.
(function (root) {
  // IRS business rates (USD/mile). 2026: 0.725 Jan1-Jun30, 0.76 from Jul1 (IRS Notice 2026-10, IR-2026-29).
  const IRS_RATES = [
    { from: '2025-01-01', rate: 0.70 },
    { from: '2026-01-01', rate: 0.725 },
    { from: '2026-07-01', rate: 0.76 },
  ];
  function irsRate(dateIso) {
    const d = (dateIso || new Date().toISOString()).slice(0, 10);
    let r = IRS_RATES[0].rate;
    for (const x of IRS_RATES) if (d >= x.from) r = x.rate;
    return r;
  }
  const isDriving = s => s === 'D' || s === 'R' || s === 'N';

  // Feeds vehicle snapshots {ts, odometer, shift_state, lat, lon}; returns completed trip on P transition.
  class TripDetector {
    constructor() { this.active = null; this.last = null; }
    feed(s) { const prev = this.last; this.last = s; return this._feed(s, prev); }
    _feed(s, prev) {
      // Missed drive: parked at both polls but the odometer moved -> one inferred trip between the two polls.
      if (!this.active && prev && !isDriving(s.shift_state) && s.odometer - prev.odometer >= 0.05) {
        return { event: 'end', trip: { id: 't' + Date.parse(prev.ts) + 'i', source: 'tesla', inferred: true, startTime: prev.ts, endTime: s.ts,
          startOdo: prev.odometer, endOdo: s.odometer, miles: round(s.odometer - prev.odometer, 1), startLoc: loc(prev), endLoc: loc(s), category: null, purpose: '' } };
      }
      if (!this.active && isDriving(s.shift_state)) {
        this.active = { startTime: s.ts, startOdo: s.odometer, startLoc: loc(s) };
        return { event: 'start', trip: this.active };
      }
      if (this.active && (!s.shift_state || s.shift_state === 'P')) {
        const a = this.active; this.active = null; // every completed trip is reported, no minimum distance
        return { event: 'end', trip: {
          id: 't' + Date.parse(a.startTime), source: 'tesla', startTime: a.startTime, endTime: s.ts,
          startOdo: a.startOdo, endOdo: s.odometer, miles: round(s.odometer - a.startOdo, 1),
          startLoc: a.startLoc, endLoc: loc(s), category: null, purpose: '' } };
      }
      return null;
    }
  }
  const loc = s => (s.lat != null ? { lat: s.lat, lon: s.lon } : null);
  const round = (n, p) => Math.round(n * 10 ** p) / 10 ** p;

  function buildReport(trips, from, to, rateOverride, includeReimbursed) {
    const rows = trips.filter(t => t.category === 'business' && (includeReimbursed || !t.reimbursedAt) && t.startTime.slice(0, 10) >= from && t.startTime.slice(0, 10) <= to)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .map(t => { const rate = rateOverride || irsRate(t.startTime); return { ...t, rate, amount: round(t.miles * rate, 2) }; });
    return { from, to, rows, totalMiles: round(rows.reduce((s, r) => s + r.miles, 0), 1),
      totalAmount: round(rows.reduce((s, r) => s + r.amount, 0), 2) };
  }
  function reportCsv(rep) {
    const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const lines = [['Date', 'Start', 'End', 'Start odometer', 'End odometer', 'Miles', 'Purpose', 'Rate', 'Amount'].map(esc).join(',')];
    for (const r of rep.rows) lines.push([r.startTime.slice(0, 10), r.startTime, r.endTime, r.startOdo ?? '', r.endOdo ?? '', r.miles, r.purpose, r.rate, r.amount.toFixed(2)].map(esc).join(','));
    lines.push(['TOTAL', '', '', '', '', rep.totalMiles, '', '', rep.totalAmount.toFixed(2)].map(esc).join(','));
    return lines.join('\n');
  }
  const escH = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function reportHtml(r, rateLabel) {
    return `<h2>Mileage Reimbursement Report</h2><p>Period ${r.from} to ${r.to} · Rate: ${escH(rateLabel || 'IRS standard business rate by trip date')}</p>
  <table><thead><tr><th>Date</th><th>Purpose</th><th>Odometer</th><th>Miles</th><th>Rate</th><th>Amount</th><th>Status</th></tr></thead><tbody>
  ${r.rows.map(x => `<tr><td>${x.startTime.slice(0, 10)}</td><td>${escH(x.purpose)}</td><td>${x.startOdo ?? ''}–${x.endOdo ?? ''}</td><td>${x.miles}</td><td>$${x.rate}</td><td>$${x.amount.toFixed(2)}</td><td>${x.reimbursedAt ? 'submitted ' + x.reimbursedAt.slice(0, 10) : ''}</td></tr>`).join('')}
  </tbody><tfoot><tr><th colspan="3">Total</th><th>${r.totalMiles}</th><th></th><th>$${r.totalAmount.toFixed(2)}</th><th></th></tr></tfoot></table>
  <p style="margin-top:3em">Employee signature: ____________________ Date: __________</p>`;
  }
  // Scheduled period: weekly = previous Mon–Sun, monthly = previous calendar month. Returns null if already sent.
  function duePeriod(schedule, lastPeriodEnd, now = new Date()) {
    const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let from, to;
    if (schedule === 'weekly') { const end = new Date(now); end.setDate(end.getDate() - ((end.getDay() + 6) % 7) - 1);
      const st = new Date(end); st.setDate(st.getDate() - 6); from = ymd(st); to = ymd(end); }
    else if (schedule === 'monthly') { from = ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)); to = ymd(new Date(now.getFullYear(), now.getMonth(), 0)); }
    else return null;
    return lastPeriodEnd && lastPeriodEnd >= to ? null : { from, to };
  }
  // TeslaMate drives row -> trip (distance in km in TeslaMate).
  function fromTeslaMate(d) {
    return { id: 'tm' + d.id, source: 'teslamate', startTime: new Date(d.start_date).toISOString(),
      endTime: new Date(d.end_date).toISOString(), startOdo: round(d.start_km * 0.621371, 1), endOdo: round(d.end_km * 0.621371, 1),
      miles: round(d.distance * 0.621371, 1), startLoc: d.start_address ? { name: d.start_address } : null,
      endLoc: d.end_address ? { name: d.end_address } : null, category: null, purpose: '' };
  }
  // Email in the format Lester has used with Sugar (Gmail thread "Mileage Reimbursement Request – Oct 8–10, 2026 Dunlap HQ Trip").
  const md = d => { const x = new Date(d); return `${x.getMonth() + 1}/${x.getDate()}/${x.getFullYear()}`; };
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
  const num = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 });
  const usd = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function dateSpan(a, b) { const x = new Date(a), y = new Date(b);
    if (x.toDateString() === y.toDateString()) return `${MON[x.getMonth()]} ${x.getDate()}, ${x.getFullYear()}`;
    if (x.getMonth() === y.getMonth() && x.getFullYear() === y.getFullYear()) return `${MON[x.getMonth()]} ${x.getDate()}–${y.getDate()}, ${x.getFullYear()}`;
    return `${MON[x.getMonth()]} ${x.getDate()} – ${MON[y.getMonth()]} ${y.getDate()}, ${y.getFullYear()}`; }
  const routeOf = t => t.route || `${(t.startLoc && (t.startLoc.name || `${t.startLoc.lat.toFixed(4)}, ${t.startLoc.lon.toFixed(4)}`)) || 'Start'} → ${(t.endLoc && (t.endLoc.name || `${t.endLoc.lat.toFixed(4)}, ${t.endLoc.lon.toFixed(4)}`)) || 'End'}`;
  function sugarEmail(tripsIn, vehicles, user, opts = {}) {
    const trips = [...tripsIn].sort((a, b) => a.startTime.localeCompare(b.startTime));
    const first = trips[0], last = trips[trips.length - 1];
    const priced = trips.map(t => { const rate = opts.rate || irsRate(t.startTime); return { ...t, rate, amount: round(t.miles * rate, 2) }; });
    const miles = round(priced.reduce((s, t) => s + t.miles, 0), 1), amount = round(priced.reduce((s, t) => s + t.amount, 0), 2);
    const rates = [...new Set(priced.map(t => t.rate))];
    const label = opts.title || (trips.length === 1 ? (first.purpose || 'Business') : 'Weekly Business');
    const subject = `Mileage Reimbursement Request – ${dateSpan(first.startTime, last.endTime)}${opts.title === '' ? '' : ' ' + label} Trip${trips.length > 1 && opts.title !== '' ? 's' : ''} (${num(miles)} miles / $${usd(amount)})`;
    const vIds = [...new Set(trips.map(t => t.vehicleId))], vs = vIds.map(id => vehicles.find(v => v.id === id)).filter(Boolean);
    const odoRows = vs.length ? vs.map(v => { const vt = trips.filter(t => t.vehicleId === v.id && t.startOdo != null);
      return vt.length ? { v, start: vt[0], end: vt[vt.length - 1] } : null; }).filter(Boolean) : [];
    const dayLbl = d => { const x = new Date(d); return `${DOW[x.getDay()]} ${x.getMonth() + 1}/${x.getDate()}`; };
    const L = [];
    L.push(`${opts.greeting || 'Sugar'},`, '', trips.length === 1
      ? `Here's my mileage reimbursement request for the ${first.purpose || 'business'} trip. Everything you should need is below, and a capture of the odometer readings is attached.`
      : `Here's my mileage reimbursement request for this week's ${trips.length} business trips. Everything you should need is below, and a capture of every odometer reading is attached.`, '');
    L.push('**Trip dates**', `Departed ${md(first.startTime)} · Returned ${md(last.endTime)}`, '', '**Route and business purpose**', '');
    for (const t of priced) L.push(`| ${trips.length > 1 ? md(t.startTime) + ' | ' : ''}${routeOf(t)} | ${t.purpose || 'Business'} |${trips.length > 1 ? ` ${num(t.miles)} mi |` : ''}`);
    L.push('', '**Vehicle**'); for (const v of vs) L.push(`${v.model || 'Tesla'} · VIN ${v.vin || 'unknown'}`);
    L.push('', '**Odometer and calculation**', '');
    for (const o of odoRows) { const p = odoRows.length > 1 ? `${o.v.name} ` : '';
      L.push(`| ${p}Ending odometer reading (${dayLbl(o.end.endTime)}) | ${num(o.end.endOdo)} |`, `| ${p}Starting odometer reading (${dayLbl(o.start.startTime)}) | ${num(o.start.startOdo)} |`); }
    L.push(`| Total business miles | ${num(miles)} |`);
    if (rates.length === 1) L.push(`| IRS standard business mileage rate | × $${rates[0]} |`);
    else for (const r of rates) L.push(`| Miles at $${r}/mile | ${num(priced.filter(t => t.rate === r).reduce((s, t) => s + t.miles, 0))} |`);
    L.push(`| Total reimbursement requested | $${usd(amount)} |`, '');
    if (odoRows.length && trips.length > 1) L.push('Total business miles is the sum of the business trips listed above; any personal driving between them is excluded, so it can be less than the ending minus starting odometer.', '');
    if (!opts.rate) L.push(rates.length === 1 && rates[0] === 0.76 ? 'The $0.76/mile figure is the IRS standard business mileage rate in effect from July 1, 2026 through December 31, 2026, so it is the correct rate for this trip.'
      : 'Each trip uses the IRS standard business mileage rate in effect on its date ($0.725/mile Jan 1 – Jun 30, 2026; $0.76/mile from Jul 1, 2026).', '');
    L.push(`Attached is a capture of ${trips.length === 1 ? 'both odometer readings' : 'every odometer reading'} showing the start and end mileage along with the VIN, plus a CSV of the trips.`, '',
      'Let me know if you need anything else to get this processed.', '', opts.signature || `Thanks,\n${(user && user.name || '').split(' ')[0]}`);
    const text = L.join('\n');
    const html = '<div style="font-family:Arial,sans-serif">' + text.split('\n\n').map(block => {
      const lines = block.split('\n');
      if (lines.every(l => l.startsWith('|'))) return '<table border="1" cellpadding="4" style="border-collapse:collapse">' + lines.map(l => '<tr>' + l.slice(1, -1).split(' | ').map(c => `<td>${escH(c.trim()).replace(/^\|\s*/, '')}</td>`).join('') + '</tr>').join('') + '</table>';
      return '<p>' + lines.map(l => escH(l).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')).join('<br>') + '</p>'; }).join('') + '</div>';
    const captureHtml = `<h2>Odometer captures</h2><p>${escH(subject)}</p><table border="1" cellpadding="4" style="border-collapse:collapse;font-size:12px">
      <tr><th>Vehicle</th><th>VIN</th><th>Trip</th><th>Captured</th><th>Reading</th><th>Odometer (mi)</th><th>Location</th><th>Source</th></tr>
      ${priced.flatMap(t => { const v = vehicles.find(x => x.id === t.vehicleId) || {};
        return [['start', t.startTime, t.startOdo, t.startLoc], ['end', t.endTime, t.endOdo, t.endLoc]].map(([k, ts, o, l]) =>
          `<tr><td>${escH(v.name)}</td><td>${escH(v.vin)}</td><td>${escH(routeOf(t))}</td><td>${new Date(ts).toLocaleString()}</td><td>${k}</td><td>${o != null ? num(o) : '—'}</td><td>${l ? (l.lat != null ? l.lat.toFixed(5) + ', ' + l.lon.toFixed(5) : escH(l.name)) : ''}</td><td>${t.source}${t.inferred ? ' (inferred)' : ''}</td></tr>`); }).join('')}
      </table><p>Total business miles ${num(miles)} · Reimbursement $${amount.toFixed(2)}</p>`;
    return { subject, text, html, captureHtml, miles, amount, rows: priced };
  }
  const api = { sugarEmail, routeOf, IRS_RATES, irsRate, TripDetector, buildReport, reportCsv, fromTeslaMate, reportHtml, duePeriod };
  if (typeof module !== 'undefined') module.exports = api; else root.Core = api;
})(this);
