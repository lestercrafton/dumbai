import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {weekendWindow} from './weekend-window.mjs';

test('every weekday selects the upcoming or current Friday–Sunday', () => {
 for (const date of ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']) {
  assert.deepEqual(weekendWindow(date), {
   startDate: '2026-10-16', endDate: '2026-10-18', days: 3,
   label: 'Fri, Oct 16 – Sun, Oct 18',
  }, date);
 }
 assert.equal(weekendWindow('2026-10-19').startDate, '2026-10-23');
 assert.equal(weekendWindow('2026-10-19').endDate, '2026-10-25');
});

test('weekends cross month and year boundaries without truncating dates', () => {
 assert.deepEqual(weekendWindow('2026-10-31'), {
  startDate: '2026-10-30', endDate: '2026-11-01', days: 3,
  label: 'Fri, Oct 30 – Sun, Nov 1',
 });
 assert.deepEqual(weekendWindow('2028-01-01'), {
  startDate: '2027-12-31', endDate: '2028-01-02', days: 3,
  label: 'Fri, Dec 31, 2027 – Sun, Jan 2, 2028',
 });
 assert.equal(weekendWindow('2026-12-31').startDate, '2027-01-01');
 assert.equal(weekendWindow('2027-01-04').startDate, '2027-01-08');
});

test('leap-day and daylight-saving weekends use calendar dates', () => {
 const cases = [
  ['2020-02-29', '2020-02-28', '2020-03-01'],
  ['2024-02-29', '2024-03-01', '2024-03-03'],
  ['2026-03-08', '2026-03-06', '2026-03-08'],
  ['2026-03-09', '2026-03-13', '2026-03-15'],
  ['2026-11-01', '2026-10-30', '2026-11-01'],
  ['2026-11-02', '2026-11-06', '2026-11-08'],
 ];
 for (const [date, startDate, endDate] of cases) {
  const window = weekendWindow(date);
  assert.equal(window.startDate, startDate, date);
  assert.equal(window.endDate, endDate, date);
  assert.equal(window.days, 3, date);
 }
});

test('date-only labels do not shift to Thursday in CT or other viewer timezones', () => {
 const moduleUrl = new URL('./weekend-window.mjs', import.meta.url).href;
 const source = `import {weekendWindow} from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(weekendWindow('2026-10-17')));`;
 for (const TZ of ['America/Chicago', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo']) {
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', source], {encoding: 'utf8', env: {...process.env, TZ}}));
  assert.deepEqual(result, weekendWindow('2026-10-17'), TZ);
  assert.equal(result.label, 'Fri, Oct 16 – Sun, Oct 18', TZ);
 }
});

test('invalid input cannot silently select a different calendar date', () => {
 for (const value of ['', 'not-a-date', '2026-02-30', '2026-02-29', '2026-13-01', '2026-00-10', '2026-10-00', '2026-1-01', '2026-10-17T00:00:00Z', null, undefined, 20261017, {}, []]) {
  assert.equal(weekendWindow(value), null, JSON.stringify(value));
 }
});
