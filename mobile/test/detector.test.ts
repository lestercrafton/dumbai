import test from 'node:test';
import assert from 'node:assert';
import { feed, flush, initialState, promptFor, haversineM, type Fix, type DetectorState, type CompletedTrip } from '../src/detector';

// Simulate a drive: fixes every 5 s along a straight line north at a given speed.
function run(segments: { secs: number; mps: number }[], t0 = Date.parse('2026-10-19T14:00:00Z')) {
  let s: DetectorState = initialState(), lat = 32.75, ts = t0; const trips: CompletedTrip[] = [];
  for (const seg of segments) for (let i = 0; i < seg.secs; i += 5) {
    ts += 5000; lat += (seg.mps * 5) / 111_195;
    const r = feed(s, { ts, lat, lon: -97.33, speed: seg.mps, accuracy: 10 }); s = r.state; if (r.trip) trips.push(r.trip);
  }
  return { s, trips, ts };
}

test('a 10-minute drive at 30 mph then parking yields one ~5 mile trip', () => {
  const { trips } = run([{ secs: 120, mps: 0 }, { secs: 600, mps: 13.4 }, { secs: 360, mps: 0 }]);
  assert.equal(trips.length, 1); assert.ok(Math.abs(trips[0].miles - 5.0) <= 0.15, String(trips[0].miles));
  assert.ok(trips[0].durationMin >= 9 && trips[0].durationMin <= 11);
});
test('red lights (under 4 minutes stopped) do not split a trip', () => {
  const { trips } = run([{ secs: 300, mps: 15 }, { secs: 120, mps: 0 }, { secs: 300, mps: 15 }, { secs: 300, mps: 0 }]);
  assert.equal(trips.length, 1);
});
test('a short sprint or bike ride under the sustain time is ignored', () => {
  assert.equal(run([{ secs: 30, mps: 8 }, { secs: 600, mps: 1 }]).trips.length, 0);
  assert.equal(run([{ secs: 1200, mps: 4.5 }, { secs: 600, mps: 0 }]).trips.length, 0); // 10 mph cycling
});
test('flush ends a drive when iOS stops delivering fixes after parking', () => {
  const { s, ts, trips } = run([{ secs: 600, mps: 20 }]);
  assert.equal(trips.length, 0); assert.equal(s.phase, 'driving');
  assert.equal(flush(s, ts + 60_000).trip, null);
  const r = flush(s, ts + 5 * 60_000); assert.ok(r.trip && r.trip.miles > 7); assert.equal(r.state.phase, 'idle');
});
test('GPS jumps and inaccurate fixes do not add miles', () => {
  let s = initialState(); const t0 = Date.parse('2026-10-19T14:00:00Z'); let lat = 32.75;
  for (let i = 1; i <= 120; i++) { lat += 100 / 111_195; s = feed(s, { ts: t0 + i * 5000, lat, lon: -97.33, speed: 20, accuracy: 10 }).state; }
  const before = s.meters;
  s = feed(s, { ts: t0 + 121 * 5000, lat: lat + 0.5, lon: -97.33, speed: 20, accuracy: 10 }).state; // 55 km jump in 5 s
  assert.equal(s.meters, before);
  s = feed(s, { ts: t0 + 122 * 5000, lat: lat + 0.001, lon: -97.33, speed: 20, accuracy: 300 }).state;
  assert.equal(s.meters, before);
});
test('unknown speed (-1) falls back to distance over time', () => {
  let s = initialState(), lat = 32.75; const t0 = Date.parse('2026-10-19T14:00:00Z'), out: CompletedTrip[] = [];
  for (let i = 1; i <= 200; i++) { lat += i <= 120 ? 100 / 111_195 : 0; const r = feed(s, { ts: t0 + i * 5000, lat, lon: -97.33, speed: -1, accuracy: 10 }); s = r.state; if (r.trip) out.push(r.trip); }
  assert.equal(out.length, 1); assert.ok(out[0].miles > 7);
});
test('haversine sanity: 1 degree latitude ≈ 111 km', () => { assert.ok(Math.abs(haversineM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) - 111_195) < 50); });
test('prompt: personal car offers send/batch; company car and Tesla are log only', () => {
  assert.deepEqual(promptFor({ id: 'a', name: 'F-150', ownership: 'personal', isTesla: false }).actions, ['send', 'batch', 'personal']);
  assert.deepEqual(promptFor({ id: 'b', name: 'Van', ownership: 'business', isTesla: false }).actions, ['log', 'personal']);
  assert.equal(promptFor({ id: 'c', name: 'micro', ownership: 'personal', isTesla: true }).reimbursable, false);
});
