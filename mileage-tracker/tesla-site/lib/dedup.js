// Reimbursement rules shared by the phone and the Tesla tool. The phone never consults Tesla data: every phone
// trip counts. Tesla-tool trips (source tesla/teslamate) keep their own odometer-based flow.
const isTeslaTrip = t => t.source === 'tesla' || t.source === 'teslamate';
// Ownership: personal cars are reimbursed; business (company) cars are logged only.
const ownershipOf = v => (v && v.ownership === 'business') ? 'business' : 'personal';
const reimbursable = (t, vehicles) => t.category === 'business' && !t.supersededBy && !t.logOnly && ownershipOf(vehicles.find(v => v.id === t.vehicleId)) === 'personal';
module.exports = { isTeslaTrip, reimbursable, ownershipOf };
