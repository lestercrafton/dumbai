import {validBoardDate} from './presentation.mjs';
import {shiftDate} from './board-window.mjs';

/** Friday–Sunday containing an ET sports date, or the upcoming weekend on
 * Monday–Thursday. The input is a calendar date, never an instant in CT/ET.
 * @param {unknown} today YYYY-MM-DD from sportsDay().
 * @returns {{startDate:string,endDate:string,days:3,label:string}|null}
 */
export function weekendWindow(today) {
 if (!validBoardDate(today)) return null;
 const date = /** @type {string} */ (today);
 const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
 const startDate = shiftDate(date, weekday === 0 ? -2 : 5 - weekday);
 const endDate = shiftDate(startDate, 2);
 const crossesYear = startDate.slice(0, 4) !== endDate.slice(0, 4);
 const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
  ...(crossesYear ? {year: 'numeric'} : {}),
 });
 const label = `${formatter.format(new Date(`${startDate}T00:00:00Z`))} – ${formatter.format(new Date(`${endDate}T00:00:00Z`))}`;
 return {startDate, endDate, days: 3, label};
}
