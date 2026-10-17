const calendarDate = /^\d{4}-\d{2}-\d{2}$/;

/** @param {string} date */
function parseDate(date) {
 if (!calendarDate.test(date)) return null;
 const day = new Date(`${date}T00:00:00Z`);
 return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === date ? day : null;
}

/** Shift a YYYY-MM-DD date without depending on the browser's timezone.
 * @param {string} date
 * @param {number} days
 */
export function shiftDate(date, days) {
 const day = parseDate(date);
 if (!day || !Number.isInteger(days)) return date;
 day.setUTCDate(day.getUTCDate() + days);
 return day.toISOString().slice(0, 10);
}

/** @param {string} sport */
export function isFootballSport(sport) {
 return sport === 'nfl' || sport === 'cfb';
}

/** NFL weeks run Tuesday–Monday; college football uses Monday–Sunday.
 * @param {string} date
 * @param {string} sport
 */
export function footballWeekStart(date, sport) {
 const day = parseDate(date);
 if (!day) return date;
 const elapsedDays = (day.getUTCDay() + (sport === 'nfl' ? 5 : 6)) % 7;
 return shiftDate(date, -elapsedDays);
}

/** Start of the last complete sport week. The caller supplies sportsDay().
 * Non-football sports use the previous Monday–Sunday calendar week.
 * @param {string} today
 * @param {string} sport
 */
export function lastWeekStart(today, sport) {
 return shiftDate(footballWeekStart(today, sport), -7);
}
