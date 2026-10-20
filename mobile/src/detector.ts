// Driving detection from raw location fixes. Pure logic (no Expo imports) so it can be unit-tested.
// Start: speed above ~15 mph sustained for startSustainMs. End: below ~2 mph (or no movement) for stopMs.
// Miles: sum of great-circle distances between accurate fixes while driving.

export type Fix = { ts: number; lat: number; lon: number; speed: number | null; accuracy: number | null };
export type Point = { lat: number; lon: number };
export type CompletedTrip = { startTime: string; endTime: string; miles: number; startLoc: Point; endLoc: Point; durationMin: number };
export type DetectorState = {
  phase: 'idle' | 'candidate' | 'driving';
  candidateSince: number | null; // first fast fix
  startFix: Fix | null; lastFix: Fix | null; lastMovingFix: Fix | null;
  meters: number; slowSince: number | null;
};
export type Options = { startMps: number; startSustainMs: number; stopMps: number; stopMs: number; maxAccuracyM: number; maxJumpMps: number; minMiles: number };

export const DEFAULTS: Options = { startMps: 6.7 /* 15 mph */, startSustainMs: 60_000, stopMps: 0.9 /* 2 mph */, stopMs: 4 * 60_000, maxAccuracyM: 50, maxJumpMps: 70, minMiles: 0.3 };
export const initialState = (): DetectorState => ({ phase: 'idle', candidateSince: null, startFix: null, lastFix: null, lastMovingFix: null, meters: 0, slowSince: null });

const R = 6371008.8;
export function haversineM(a: Point, b: Point): number {
  const rad = (d: number) => (d * Math.PI) / 180, dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
// iOS reports speed -1 when unknown; fall back to distance/time from the previous fix.
function speedOf(f: Fix, prev: Fix | null): number {
  if (f.speed != null && f.speed >= 0) return f.speed;
  if (!prev || f.ts <= prev.ts) return 0;
  return haversineM(prev, f) / ((f.ts - prev.ts) / 1000);
}
const iso = (ms: number) => new Date(ms).toISOString();
const pt = (f: Fix): Point => ({ lat: f.lat, lon: f.lon });

function finish(s: DetectorState, o: Options): { state: DetectorState; trip: CompletedTrip | null } {
  const start = s.startFix!, end = s.lastMovingFix || s.lastFix!, miles = Math.round((s.meters / 1609.344) * 10) / 10;
  const trip = miles >= o.minMiles ? { startTime: iso(start.ts), endTime: iso(end.ts), miles, startLoc: pt(start), endLoc: pt(end), durationMin: Math.round((end.ts - start.ts) / 60000) } : null;
  return { state: { ...initialState(), lastFix: s.lastFix }, trip };
}

// Feed one fix. Returns the new state and a completed trip when one ends.
export function feed(state: DetectorState, f: Fix, o: Options = DEFAULTS): { state: DetectorState; trip: CompletedTrip | null } {
  let s: DetectorState = { ...state };
  if (s.lastFix && f.ts <= s.lastFix.ts) return { state: s, trip: null }; // out of order / duplicate
  // Long gap while driving (iOS suspended us, or tunnel): treat the time without fixes as stopped.
  if (s.phase === 'driving' && s.lastFix && f.ts - s.lastFix.ts >= o.stopMs && haversineM(s.lastFix, f) < 200) {
    const done = finish(s, o); return { state: { ...done.state, lastFix: f }, trip: done.trip };
  }
  const accurate = f.accuracy == null || f.accuracy <= o.maxAccuracyM;
  const prev = s.lastFix, v = speedOf(f, prev);
  if (prev && accurate) { const dt = (f.ts - prev.ts) / 1000; if (dt > 0 && haversineM(prev, f) / dt > o.maxJumpMps) return { state: s, trip: null }; } // GPS jump
  if (s.phase === 'idle') {
    if (v >= o.startMps && accurate) s = { ...s, phase: 'candidate', candidateSince: f.ts, startFix: prev && f.ts - prev.ts < 120_000 ? prev : f, meters: prev && f.ts - prev.ts < 120_000 ? haversineM(prev, f) : 0 };
    s.lastFix = f; return { state: s, trip: null };
  }
  if (accurate && prev) s.meters += haversineM(prev, f);
  if (s.phase === 'candidate') {
    if (v < o.startMps / 2) { s = { ...initialState() }; s.lastFix = f; return { state: s, trip: null }; } // brief burst (e.g. a run), not a drive
    if (f.ts - (s.candidateSince || f.ts) >= o.startSustainMs) s.phase = 'driving';
    s.lastFix = f; if (v >= o.stopMps) s.lastMovingFix = f; return { state: s, trip: null };
  }
  // driving
  if (v >= o.stopMps) { s.slowSince = null; s.lastMovingFix = f; }
  else if (s.slowSince == null) s.slowSince = f.ts;
  s.lastFix = f;
  if (s.slowSince != null && f.ts - s.slowSince >= o.stopMs) return finish(s, o);
  return { state: s, trip: null };
}

// Called on a timer / app wake with no new fix: ends a drive if we've been silent or slow long enough.
export function flush(state: DetectorState, now: number, o: Options = DEFAULTS): { state: DetectorState; trip: CompletedTrip | null } {
  if (state.phase !== 'driving' || !state.lastFix) return { state, trip: null };
  const since = state.slowSince ?? state.lastFix.ts;
  return now - since >= o.stopMs ? finish(state, o) : { state, trip: null };
}

export type Car = { id: string; name: string; model?: string; vin?: string; ownership: 'personal' | 'business'; isTesla: boolean };
// What the end-of-trip prompt should offer for a given car.
export function promptFor(car: Car | undefined): { reimbursable: boolean; actions: ('send' | 'batch' | 'log' | 'personal')[]; note?: string } {
  if (!car) return { reimbursable: false, actions: ['personal'], note: 'Pick a car' };
  if (car.isTesla) return { reimbursable: false, actions: ['log', 'personal'], note: 'Tesla trips come from the car itself; this phone trip will not be counted twice.' };
  if (car.ownership === 'business') return { reimbursable: false, actions: ['log', 'personal'], note: 'Company car: logged only, no reimbursement.' };
  return { reimbursable: true, actions: ['send', 'batch', 'personal'] };
}
