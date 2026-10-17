import test from 'node:test';
import assert from 'node:assert/strict';
import {shiftDate, isFootballSport, footballWeekStart, lastWeekStart} from './board-window.mjs';

test('football sports select their full-week date window', () => {
 assert.equal(isFootballSport('nfl'), true);
 assert.equal(isFootballSport('cfb'), true);
 for (const sport of ['nba', 'wnba', 'cbb', 'nhl', 'mlb']) assert.equal(isFootballSport(sport), false);
});

test('NFL weeks start Tuesday and include the following Monday', () => {
 assert.equal(footballWeekStart('2026-10-12', 'nfl'), '2026-10-06');
 assert.equal(footballWeekStart('2026-10-13', 'nfl'), '2026-10-13');
 assert.equal(footballWeekStart('2026-10-18', 'nfl'), '2026-10-13');
});

test('last NFL week advances only after the complete Tuesday–Monday week', () => {
 const monday = lastWeekStart('2026-10-12', 'nfl');
 assert.equal(monday, '2026-09-29');
 assert.equal(shiftDate(monday, 6), '2026-10-05');
 const tuesday = lastWeekStart('2026-10-13', 'nfl');
 assert.equal(tuesday, '2026-10-06');
 assert.equal(shiftDate(tuesday, 6), '2026-10-12');
});

test('CFB and other sports use the previous complete Monday–Sunday week', () => {
 for (const sport of ['cfb', 'nba', 'wnba', 'cbb', 'nhl', 'mlb']) {
  const start = lastWeekStart('2026-10-12', sport);
  assert.equal(start, '2026-10-05');
  assert.equal(shiftDate(start, 6), '2026-10-11');
  assert.equal(lastWeekStart('2026-10-18', sport), '2026-10-05');
  assert.equal(lastWeekStart('2026-10-19', sport), '2026-10-12');
 }
});

test('last complete weeks cross year boundaries correctly', () => {
 assert.equal(lastWeekStart('2027-01-01', 'nfl'), '2026-12-22');
 assert.equal(lastWeekStart('2027-01-01', 'cfb'), '2026-12-21');
 assert.equal(lastWeekStart('2027-01-01', 'nba'), '2026-12-21');
 assert.equal(lastWeekStart('2027-01-05', 'nfl'), '2026-12-29');
});

test('date shifts handle month boundaries, leap days and daylight saving dates', () => {
 assert.equal(shiftDate('2026-10-01', -7), '2026-09-24');
 assert.equal(shiftDate('2027-01-01', -1), '2026-12-31');
 assert.equal(shiftDate('2028-02-28', 1), '2028-02-29');
 assert.equal(shiftDate('2026-03-08', 1), '2026-03-09');
 assert.equal(shiftDate('2026-11-01', -1), '2026-10-31');
});

test('empty or invalid calendar dates remain safe while choosing a date', () => {
 for (const date of ['', 'not-a-date', '2026-02-30']) {
  assert.equal(shiftDate(date, -7), date);
  assert.equal(footballWeekStart(date, 'nfl'), date);
  assert.equal(lastWeekStart(date, 'cfb'), date);
 }
});
