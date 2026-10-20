// Monthly mileage log CSV (one per user per month), written to the user's own Google Drive by google.js.
const { ymd, hm } = require('./gpsmail');

function logCsv(trips, vehicles, rateOf) {
  const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"', ll = l => l && l.lat != null ? `${l.lat.toFixed(5)}, ${l.lon.toFixed(5)}` : (l && l.name) || '';
  const head = ['Date', 'Start (Central)', 'End (Central)', 'Driver', 'Vehicle', 'Ownership', 'Source', 'Category', 'Status', 'Miles', 'Start odometer', 'End odometer', 'Start point', 'End point', 'Purpose', 'Rate', 'Amount', 'Queued at', 'Sent at', 'Superseded by'];
  const rows = [head.map(esc).join(',')];
  for (const t of [...trips].sort((a, b) => a.startTime.localeCompare(b.startTime))) {
    const v = vehicles.find(x => x.id === t.vehicleId) || {}, s = rateOf(t);
    rows.push([ymd(t.startTime), hm(t.startTime), hm(t.endTime), t.driver, v.name || t.vehicleId, v.ownership || 'personal', t.source, t.category || 'untagged', s.status,
      t.miles, t.startOdo ?? '', t.endOdo ?? '', ll(t.startLoc), ll(t.endLoc), t.purpose, s.rate ?? '', s.amount != null ? s.amount.toFixed(2) : '', t.queuedAt || '', t.reimbursedAt || '', t.supersededBy || ''].map(esc).join(','));
  }
  return rows.join('\n');
}

module.exports = { logCsv };
