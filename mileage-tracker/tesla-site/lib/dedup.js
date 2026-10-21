// Tesla is the source of truth for its own miles. A phone trip is superseded (kept for audit, never reimbursed) when
// the chosen car is a Tesla whose own log is linked, or when it overlaps in time (±5 min) with a Tesla trip already logged for the same user.
const SLACK_MS = 5 * 60 * 1000;
const isTeslaTrip = t => t.source === 'tesla' || t.source === 'teslamate';
const overlaps = (a, b, slack = SLACK_MS) => Date.parse(a.startTime) - slack <= Date.parse(b.endTime) && Date.parse(b.startTime) - slack <= Date.parse(a.endTime);
function supersedeReason(phoneTrip, trips, vehicles) {
  const car = vehicles.find(v => v.id === phoneTrip.vehicleId);
  // Tesla is optional: a car marked Tesla only takes over when its own log is linked (teslaId or Tesla trips logged);
  // otherwise phone miles count normally.
  if (car && car.isTesla && (car.teslaId || trips.some(t => isTeslaTrip(t) && t.vehicleId === car.id))) return { supersededBy: 'tesla-car:' + car.id, reason: 'Tesla selected; the Tesla log is the record' };
  const hit = trips.find(t => isTeslaTrip(t) && overlaps(phoneTrip, t));
  if (hit) return { supersededBy: hit.id, reason: 'Overlaps a Tesla trip' };
  return null;
}
// Ownership: personal cars are reimbursed; business (company) cars are logged only.
const ownershipOf = v => (v && v.ownership === 'business') ? 'business' : 'personal';
const reimbursable = (t, vehicles) => t.category === 'business' && !t.supersededBy && !t.logOnly && ownershipOf(vehicles.find(v => v.id === t.vehicleId)) === 'personal';
module.exports = { supersedeReason, overlaps, isTeslaTrip, reimbursable, ownershipOf, SLACK_MS };
