// Driving detection from raw location fixes. Pure logic (no Expo imports) so it can be unit-tested.
// Start: speed above ~15 mph sustained for startSustainMs. End: below ~2 mph continuously for stopMs (5.5 min);
// creeping between 2 and 5 mph neither resets nor extends, only real movement (>5 mph) resets the stop timer.
// A finished drive is held for mergeMs (10 min): if the next drive starts within mergeM (300 m) of where it ended
// (gas station, quick errand) the two are merged into one trip; otherwise it is released and prompted.
// Miles: sum of great-circle distances between accurate fixes while driving.

export type Fix = { ts: number; lat: number; lon: number; speed: number | null; accuracy: number | null };
export type Point = { lat: number; lon: number };
export type CompletedTrip = { startTime: string; endTime: string; miles: number; startLoc: Point; endLoc: Point; durationMin: number };
export type DetectorState = {
  phase: 'idle' | 'candidate' | 'driving';
  candidateSince: number | null; // first fast fix
  startFix: Fix | null; lastFix: Fix | null; lastMovingFix: Fix | null;
  meters: number; slowSince: number | null;
  held?: Held | null; // finished drive waiting out the merge window
};
export type Held = { startFix: Fix; endFix: Fix; meters: number };
export type Options = { startMps: number; startSustainMs: number; stopMps: number; resumeMps: number; stopMs: number; mergeMs: number; mergeM: number; maxAccuracyM: number; maxJumpMps: number; minMiles: number };

export const DEFAULTS: Options = { startMps: 6.7 /* 15 mph */, startSustainMs: 60_000, stopMps: 0.9 /* 2 mph */, resumeMps: 2.2 /* 5 mph */, stopMs: 5.5 * 60_000, mergeMs: 10 * 60_000, mergeM: 300, maxAccuracyM: 50, maxJumpMps: 70, minMiles: 0.3 };
export const initialState = (): DetectorState => ({ phase: 'idle', candidateSince: null, startFix: null, lastFix: null, lastMovingFix: null, meters: 0, slowSince: null, held: null });

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

function toTrip(h: Held, o: Options): CompletedTrip | null {
  const miles = Math.round((h.meters / 1609.344) * 10) / 10;
  return miles >= o.minMiles ? { startTime: iso(h.startFix.ts), endTime: iso(h.endFix.ts), miles, startLoc: pt(h.startFix), endLoc: pt(h.endFix), durationMin: Math.round((h.endFix.ts - h.startFix.ts) / 60000) } : null;
}
// End of a drive: hold it for the merge window instead of emitting right away.
function finish(s: DetectorState, o: Options): { state: DetectorState; trip: CompletedTrip | null } {
  const held: Held = { startFix: s.startFix!, endFix: s.lastMovingFix || s.lastFix!, meters: s.meters };
  if (o.mergeMs <= 0) return { state: { ...initialState(), lastFix: s.lastFix }, trip: toTrip(held, o) };
  return { state: { ...initialState(), lastFix: s.lastFix, held }, trip: null };
}
// Release a held drive once the merge window has passed (only while idle; a candidate may still merge).
function release(s: DetectorState, now: number, o: Options): { state: DetectorState; trip: CompletedTrip | null } {
  if (!s.held || s.phase !== 'idle' || now - s.held.endFix.ts < o.mergeMs) return { state: s, trip: null };
  return { state: { ...s, held: null }, trip: toTrip(s.held, o) };
}

// Feed one fix. Returns the new state and a completed trip when one ends.
export function feed(state: DetectorState, f: Fix, o: Options = DEFAULTS): { state: DetectorState; trip: CompletedTrip | null } {
  if (state.lastFix && f.ts <= state.lastFix.ts) return { state, trip: null }; // out of order / duplicate
  const rel = release(state, f.ts, o), r = step(rel.state, f, o);
  return { state: r.state, trip: rel.trip || r.trip };
}
function step(state: DetectorState, f: Fix, o: Options): { state: DetectorState; trip: CompletedTrip | null } {
  let s: DetectorState = { ...state };
  // Long gap while driving (iOS suspended us, or tunnel): treat the time without fixes as stopped.
  if (s.phase === 'driving' && s.lastFix && f.ts - s.lastFix.ts >= o.stopMs && haversineM(s.lastFix, f) < 200) {
    const done = finish(s, o), r = release({ ...done.state, lastFix: f }, f.ts, o); return { state: r.state, trip: done.trip || r.trip };
  }
  const accurate = f.accuracy == null || f.accuracy <= o.maxAccuracyM;
  const prev = s.lastFix, v = speedOf(f, prev);
  if (prev && accurate) { const dt = (f.ts - prev.ts) / 1000; if (dt > 0 && haversineM(prev, f) / dt > o.maxJumpMps) return { state: s, trip: null }; } // GPS jump
  if (s.phase === 'idle') {
    let trip: CompletedTrip | null = null;
    if (v >= o.startMps && accurate) {
      s = { ...s, phase: 'candidate', candidateSince: f.ts, startFix: prev && f.ts - prev.ts < 120_000 ? prev : f, meters: prev && f.ts - prev.ts < 120_000 ? haversineM(prev, f) : 0 };
      // Too far from the held drive's end to be the same trip: release it now.
      if (s.held && haversineM(s.held.endFix, f) > o.mergeM) { trip = toTrip(s.held, o); s.held = null; }
    }
    s.lastFix = f; return { state: s, trip };
  }
  if (accurate && prev) s.meters += haversineM(prev, f);
  if (s.phase === 'candidate') {
    if (v < o.startMps / 2) { s = { ...initialState(), held: s.held }; s.lastFix = f; return { state: s, trip: null }; } // brief burst (e.g. a run), not a drive
    if (f.ts - (s.candidateSince || f.ts) >= o.startSustainMs) {
      s.phase = 'driving';
      if (s.held) { const h = s.held; s = { ...s, startFix: h.startFix, meters: h.meters + haversineM(h.endFix, s.startFix!) + s.meters, held: null }; } // same trip, resumed
    }
    s.lastFix = f; if (v >= o.stopMps) s.lastMovingFix = f; return { state: s, trip: null };
  }
  // driving
  if (v >= o.resumeMps) { s.slowSince = null; s.lastMovingFix = f; } // real movement resets the stop timer
  else if (v < o.stopMps) { if (s.slowSince == null) s.slowSince = f.ts; }
  // 2–5 mph creeping (parking lot, drive-through line): leave the timer as is
  s.lastFix = f;
  if (s.slowSince != null && f.ts - s.slowSince >= o.stopMs) return finish(s, o);
  return { state: s, trip: null };
}

// Called on a timer / app wake with no new fix: ends a drive if we've been silent or slow long enough.
export function flush(state: DetectorState, now: number, o: Options = DEFAULTS): { state: DetectorState; trip: CompletedTrip | null } {
  if (state.phase === 'idle') return release(state, now, o);
  if (state.phase !== 'driving' || !state.lastFix) return { state, trip: null };
  const since = state.slowSince ?? state.lastFix.ts;
  if (now - since < o.stopMs) return { state, trip: null };
  return release(finish(state, o).state, now, o);
}

export type Car = { id: string; name: string; model?: string; vin?: string; ownership: 'personal' | 'business'; isTesla: boolean; teslaId?: number | string | null };
// What the end-of-trip prompt should offer for a given car.
export function promptFor(car: Car | undefined): { reimbursable: boolean; actions: ('send' | 'batch' | 'log' | 'personal')[]; note?: string } {
  if (!car) return { reimbursable: false, actions: ['personal'], note: 'Pick a car' };
  // Tesla is optional: only a Tesla whose own log is linked on the server takes over its miles.
  if (car.isTesla && car.teslaId) return { reimbursable: false, actions: ['log', 'personal'], note: 'Tesla trips come from the car itself; this phone trip will not be counted twice.' };
  if (car.ownership === 'business') return { reimbursable: false, actions: ['log', 'personal'], note: 'Company car: logged only, no reimbursement.' };
  return { reimbursable: true, actions: ['send', 'batch', 'personal'] };
}
