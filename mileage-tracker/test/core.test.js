const assert = require('assert'), C = require('../src/core'), { Simulator, Poller } = require('../src/tesla');
assert.equal(C.irsRate('2026-03-01'), 0.725); assert.equal(C.irsRate('2026-08-01'), 0.76); assert.equal(C.irsRate('2025-05-01'), 0.70);
const d = new C.TripDetector(); const seq = [['P', 100], ['D', 100], ['D', 105], ['R', 106], ['P', 110.4]]; let ev = [];
seq.forEach(([s, o], i) => { const e = d.feed({ ts: `2026-10-0${i + 1}T10:00:00Z`, odometer: o, shift_state: s, lat: 1, lon: 2 }); if (e) ev.push(e); });
assert.deepEqual(ev.map(e => e.event), ['start', 'end']); assert.equal(ev[1].trip.miles, 10.4);
const trips = [{ startTime: '2026-03-01T00:00Z', miles: 10, category: 'business' }, { startTime: '2026-08-01T00:00Z', miles: 10, category: 'business' },
  { startTime: '2026-08-02T00:00Z', miles: 99, category: 'personal' }];
const r = C.buildReport(trips, '2026-01-01', '2026-12-31'); assert.equal(r.rows.length, 2); assert.equal(r.totalAmount, 14.85);
assert.equal(C.buildReport(trips, '2026-01-01', '2026-12-31', 0.5).totalAmount, 10);
assert(C.reportCsv(r).split('\n').length === 4);
const tm = C.fromTeslaMate({ id: 7, start_date: '2026-09-01T12:00:00Z', end_date: '2026-09-01T12:30:00Z', start_km: 1000, end_km: 1016.09, distance: 16.09, start_address: 'Home', end_address: 'Office' });
assert.equal(tm.miles, 10); assert.equal(tm.id, 'tm7');
(async () => { const got = []; const p = new Poller(new Simulator(), e => got.push(e), 5); p.start();
  await new Promise(r => setTimeout(r, 300)); p.stop(); const end = got.find(e => e.event === 'end'); assert(end && end.trip.miles === 9);
  console.log('all core tests passed'); })();
