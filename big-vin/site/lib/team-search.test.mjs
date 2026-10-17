import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {teamMatchesQuery, filterGamesByTeam} from './team-search.mjs';

const snapshots = JSON.parse(readFileSync(new URL('./feeds/current-snapshots.json', import.meta.url)));
const cohort = JSON.parse(readFileSync(new URL('./college-experiment-cohort-2026-09-26.json', import.meta.url)));
const seed = JSON.parse(readFileSync(new URL('./weekly-seed.json', import.meta.url)));
const snapshotTeams = Object.values(snapshots).flatMap(slate => slate.games.flatMap(game => [game.home, game.away]));
const actualTeam = (name, id) => {
  const found = snapshotTeams.find(team => team.name === name && (!id || team.id === id));
  assert.ok(found, `Metadata fixture exists: ${name}`);
  return structuredClone(found);
};
const game = (id, rank, home, away, sport = 'cfb') => ({id, rank, home, away, sport, edge: 4 - rank / 10});

test('MSU includes every verified matching school rather than selecting one canonical team', () => {
  const names = [
    ['Michigan State Spartans', '127'], ['Mississippi State Bulldogs', '344'],
    ['Montana State Bobcats', '147'], ['Missouri State Bears', '2623'],
  ];
  const teams = names.map(([name, id]) => actualTeam(name, id));
  // Other supported real MSU schools are verified in the existing saved cohorts.
  const savedTeams = [];
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    if (typeof value.home === 'string') savedTeams.push({id: value.homeId, name: value.home});
    if (typeof value.away === 'string') savedTeams.push({id: value.awayId, name: value.away});
    if (value.name && value.id) savedTeams.push(value);
    Object.values(value).forEach(visit);
  };
  visit(seed); visit(cohort);
  for (const [name, id] of [['Morehead State Eagles', '2413'], ['Morgan State Bears', '2415'], ['Murray State Racers', '93']]) {
    const team = savedTeams.find(item => item.name === name && String(item.id) === id);
    assert.ok(team, `Saved metadata fixture exists: ${name}`);
    teams.push(team);
  }
  const opponent = actualTeam('Michigan Wolverines', '130');
  const games = teams.map((team, index) => game(String(index), index + 2, team, opponent));
  games.push(game('not-msu', 1, opponent, actualTeam('Ohio State Buckeyes', '194')));
  assert.deepEqual(filterGamesByTeam(games, 'MSU').map(item => item.home.name), teams.map(team => team.name));
  assert.ok(teams.every(team => teamMatchesQuery(team, 'm.s.u.', 'cbb')));
  assert.equal(teamMatchesQuery(opponent, 'MSU', 'cfb'), false);
});

test('metadata names, abbreviations, short names, keys and declared aliases are searchable', () => {
  const team = {name: 'Seattle Seahawks', displayName: 'Seattle Football', shortName: 'Hawks', abbreviation: 'SEA', key: 'nfl:SEA', aliases: ['Seattle Team']};
  for (const query of ['Seattle', 'sea', 'HAWKS', 'Seattle Football', 'nfl:SEA', 'Seattle Team']) {
    assert.equal(teamMatchesQuery(team, query, 'nfl'), true, query);
  }
  assert.equal(teamMatchesQuery('Detroit Tigers', 'Detroit'), true);
  assert.equal(teamMatchesQuery({key: 'nba:LAL'}, 'LAL', 'nba'), true);
});

test('punctuation, diacritics, joined spacing and state/university spellings normalize', () => {
  const sanJose = actualTeam('San José State Spartans', '23');
  const michigan = actualTeam('Michigan State Spartans', '127');
  for (const query of ['san jose', 'san-jose-state', 'SanJoseState', 'S.J.S.U.']) assert.ok(teamMatchesQuery(sanJose, query, 'cfb'), query);
  for (const query of ['MI State', 'Michigan St.', 'Michigan State University', 'University of Michigan State', 'U Michigan State']) {
    assert.ok(teamMatchesQuery(michigan, query, 'cfb'), query);
  }
  assert.ok(teamMatchesQuery(actualTeam("Hawai'i Rainbow Warriors", '62'), 'Hawaii', 'cfb'));
  assert.ok(teamMatchesQuery(actualTeam('Texas A&M Aggies', '245'), 'Texas A and M', 'cfb'));
  assert.ok(teamMatchesQuery(actualTeam('UConn Huskies', '41'), 'Connecticut', 'cbb'));
  assert.ok(teamMatchesQuery({name: 'St. Louis Blues'}, 'Saint Louis', 'nhl'));
  assert.ok(teamMatchesQuery({name: 'Los Angeles Lakers'}, 'LA Lakers', 'nba'));
});

test('tolerant spelling handles omissions, insertions, substitutions and transpositions conservatively', () => {
  for (const query of ['michgan state', 'michigann state', 'michigun state', 'mcihigan state']) {
    assert.ok(teamMatchesQuery(actualTeam('Michigan State Spartans', '127'), query, 'cfb'), query);
  }
  assert.ok(teamMatchesQuery(actualTeam('Mississippi State Bulldogs', '344'), 'Mississipi State', 'cfb'));
  assert.ok(teamMatchesQuery(actualTeam('Seattle Seahawks', '26'), 'Seatle', 'nfl'));
  assert.ok(teamMatchesQuery(actualTeam('Dallas Cowboys', '6'), 'Cowobys', 'nfl'));
  for (const query of ['x', 'mz', 'msx', 'zzzzzz', 'Michzzzz State']) {
    assert.equal(teamMatchesQuery(actualTeam('Michigan State Spartans', '127'), query, 'cfb'), false, query);
  }
  assert.equal(teamMatchesQuery(actualTeam('Michigan Wolverines', '130'), 'Michigan Michigan', 'cfb'), false);
});

test('common abbreviated university metadata also matches verified expanded school names', () => {
  const cases = [
    ['BYU Cougars', '252', 'Brigham Young'],
    ['TCU Horned Frogs', '2628', 'Texas Christian'],
    ['SMU Mustangs', '2567', 'Southern Methodist'],
    ['LSU Tigers', '99', 'Louisiana State'],
    ['UCF Knights', '2116', 'Central Florida'],
    ['UAB Blazers', '5', 'Alabama Birmingham'],
    ['UCLA Bruins', '26', 'UC Los Angeles'],
    ['USC Trojans', '30', 'Southern California'],
    ['Massachusetts Minutemen', '113', 'UMass'],
    ['UNLV Rebels', '2439', 'Nevada Las Vegas'],
    ['UTEP Miners', '2638', 'Texas El Paso'],
    ['UTSA Roadrunners', '2636', 'UT San Antonio'],
    ['Texas A&M Aggies', '245', 'TAMU'],
  ];
  for (const [name, id, query] of cases) assert.ok(teamMatchesQuery(actualTeam(name, id), query, 'cfb'), query);
  // ESPN numeric IDs overlap across sports; college aliases must not leak.
  assert.equal(teamMatchesQuery(actualTeam('Seattle Seahawks', '26'), 'UCLA', 'nfl'), false);
  assert.equal(teamMatchesQuery(actualTeam('Baltimore Ravens', '33'), 'MSU', 'nfl'), false);
});

test('home and away filtering preserves authoritative ranking numbers, identity, data and input order', () => {
  const state = actualTeam('Michigan State Spartans', '127');
  const miss = actualTeam('Mississippi State Bulldogs', '344');
  const michigan = actualTeam('Michigan Wolverines', '130');
  const games = [game('away-msu', 19, michigan, state), game('none', 1, michigan, michigan), game('home-msu', 7, miss, michigan)];
  const before = structuredClone(games);
  for (const item of games) { Object.freeze(item.home); Object.freeze(item.away); Object.freeze(item); }
  Object.freeze(games);
  const matches = filterGamesByTeam(games, 'MSU');
  assert.deepEqual(matches.map(item => [item.id, item.rank]), [['away-msu', 19], ['home-msu', 7]]);
  assert.equal(matches[0], games[0]);
  assert.equal(matches[1], games[2]);
  assert.deepEqual(games, before);
});

test('empty queries retain every game and malformed or missing metadata stays safe', () => {
  const games = [game('one', 2, null, {name: 'Seattle Seahawks'}, 'nfl'), {id: 'missing', rank: 9}];
  for (const query of ['', '   ', null, undefined, '...']) {
    const matches = filterGamesByTeam(games, query);
    assert.deepEqual(matches, games);
    assert.notEqual(matches, games);
    assert.equal(teamMatchesQuery(null, query), true);
  }
  assert.deepEqual(filterGamesByTeam(games, 'Seattle').map(item => item.id), ['one']);
  assert.deepEqual(filterGamesByTeam(null, 'MSU'), []);
  assert.equal(teamMatchesQuery(null, 'MSU'), false);
  assert.equal(teamMatchesQuery({name: null, aliases: [null, {}]}, 'MSU'), false);
});
