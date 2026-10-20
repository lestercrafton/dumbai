// Most recent weekly moment (e.g. Friday 17:00) in a given IANA zone, DST-safe, as a real Date.
function wall(d, tz) { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  .formatToParts(d).map(x => [x.type, x.value])); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second); }
function toReal(wallMs, tz) { let g = wallMs; for (let i = 0; i < 3; i++) g = wallMs - (wall(new Date(g), tz) - g); return new Date(g); }
function lastWeekly(now, day, time, tz = 'America/Chicago') {
  const [hh, mm] = time.split(':').map(Number), w = new Date(wall(now, tz));
  const due = new Date(w); due.setUTCDate(due.getUTCDate() - ((w.getUTCDay() - day + 7) % 7)); due.setUTCHours(hh, mm, 0, 0);
  if (due > w) due.setUTCDate(due.getUTCDate() - 7);
  return toReal(due.getTime(), tz);
}
module.exports = { lastWeekly, wall };
