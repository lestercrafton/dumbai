/** Display-only team search. Aliases never change team identity or board rank. */
const STATE_CODES = Object.freeze({
  alabama: 'al', alaska: 'ak', arizona: 'az', arkansas: 'ar', california: 'ca',
  colorado: 'co', connecticut: 'ct', delaware: 'de', florida: 'fl', georgia: 'ga',
  hawaii: 'hi', idaho: 'id', illinois: 'il', indiana: 'in', iowa: 'ia', kansas: 'ks',
  kentucky: 'ky', louisiana: 'la', maine: 'me', maryland: 'md', massachusetts: 'ma',
  michigan: 'mi', minnesota: 'mn', mississippi: 'ms', missouri: 'mo', montana: 'mt',
  nebraska: 'ne', nevada: 'nv', 'new hampshire': 'nh', 'new jersey': 'nj',
  'new mexico': 'nm', 'new york': 'ny', 'north carolina': 'nc', 'north dakota': 'nd',
  ohio: 'oh', oklahoma: 'ok', oregon: 'or', pennsylvania: 'pa', 'rhode island': 'ri',
  'south carolina': 'sc', 'south dakota': 'sd', tennessee: 'tn', texas: 'tx',
  utah: 'ut', vermont: 'vt', virginia: 'va', washington: 'wa', 'west virginia': 'wv',
  wisconsin: 'wi', wyoming: 'wy',
});

// ESPN IDs/names are present in current-snapshots.json, weekly-seed.json and
// college-experiment-cohort-2026-09-26.json. An alias maps to a SET of identities:
// MSU must not silently choose one university. Name-based derivation below also
// covers additional real State teams when their metadata arrives in a board.
const COLLEGE_ALIASES = Object.freeze({
  127: {name: 'Michigan State', aliases: ['MSU', 'Mich State']},
  344: {name: 'Mississippi State', aliases: ['MSU', 'Miss State']},
  147: {name: 'Montana State', aliases: ['MSU', 'Mont State']},
  2623: {name: 'Missouri State', aliases: ['MSU', 'Mo State']},
  2413: {name: 'Morehead State', aliases: ['MSU']},
  2415: {name: 'Morgan State', aliases: ['MSU']},
  93: {name: 'Murray State', aliases: ['MSU']},
  41: {name: 'UConn', aliases: ['Connecticut', 'University of Connecticut']},
  // Expanded school names checked against the schools' official homepages:
  // byu.edu, tcu.edu, smu.edu, lsu.edu, ucf.edu, uab.edu, ucla.edu, usc.edu,
  // umass.edu, unlv.edu, utep.edu, utsa.edu and tamu.edu (October 17, 2026).
  252: {name: 'BYU', aliases: ['Brigham Young University']},
  2628: {name: 'TCU', aliases: ['Texas Christian University']},
  2567: {name: 'SMU', aliases: ['Southern Methodist University']},
  99: {name: 'LSU', aliases: ['Louisiana State University']},
  2116: {name: 'UCF', aliases: ['University of Central Florida']},
  5: {name: 'UAB', aliases: ['University of Alabama at Birmingham', 'Alabama Birmingham']},
  26: {name: 'UCLA', aliases: ['University of California Los Angeles', 'UC Los Angeles']},
  30: {name: 'USC', aliases: ['University of Southern California', 'Southern California']},
  113: {name: 'Massachusetts', aliases: ['UMass', 'UMass Amherst', 'University of Massachusetts Amherst']},
  2439: {name: 'UNLV', aliases: ['University of Nevada Las Vegas', 'Nevada Las Vegas']},
  2638: {name: 'UTEP', aliases: ['University of Texas at El Paso', 'UT El Paso', 'Texas El Paso']},
  2636: {name: 'UTSA', aliases: ['University of Texas at San Antonio', 'UT San Antonio', 'Texas San Antonio']},
  245: {name: 'Texas A&M', aliases: ['TAMU', 'Texas A&M University']},
});

const normalize = value => String(value ?? '').normalize('NFKD')
  .replace(/\p{M}/gu, '').toLowerCase().replace(/[’'`]/g, '')
  .replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
const compact = value => value.replaceAll(' ', '');
const withoutUniversity = value => value.split(' ')
  .filter(word => !['university', 'of', 'the'].includes(word))
  .filter((word, index, words) => word !== 'u' || index > 0 && index < words.length - 1)
  .join(' ');
const initials = words => words.filter(word => !['and', 'of', 'the', 'university'].includes(word))
  .map(word => word[0]).join('');

function aliasesForTeam(team, sport) {
  const data = typeof team === 'string' ? {name: team} : team;
  if (!data || typeof data !== 'object') return [];
  const aliases = new Set();
  const add = value => { const text = normalize(value); if (text) aliases.add(text); };
  const names = [data.name, data.displayName, data.shortDisplayName, data.shortName, data.location];
  for (const value of [...names, data.abbreviation, data.key, ...(Array.isArray(data.aliases) ? data.aliases : [])]) {
    if (typeof value === 'string' || typeof value === 'number') add(value);
  }
  const keyParts = typeof data.key === 'string' ? data.key.split(':') : [];
  if (keyParts.length > 1 && /[a-z]/i.test(keyParts.at(-1))) add(keyParts.at(-1));
  const league = sport || data.sport || keyParts[0];
  const college = league === 'cfb' || league === 'cbb';
  const id = data.id ?? (keyParts[1] === 'espn' ? keyParts[2] : null);
  const known = COLLEGE_ALIASES[id];
  const knownName = known && normalize(known.name);
  if (known && (college || names.some(value => normalize(value).startsWith(knownName)))) {
    add(known.name);
    for (const alias of known.aliases) add(alias);
    names.push(known.name, ...known.aliases);
  }

  for (const value of names) {
    if (typeof value !== 'string') continue;
    const name = normalize(value);
    if (!name) continue;
    const words = withoutUniversity(name).split(' ');
    add(words.join(' '));
    add(words.join(' ').replace(/\bstate\b/g, 'st'));
    add(words.join(' ').replace(/\bsaint\b/g, 'st'));
    if (words.includes('st')) {
      add(words.join(' ').replace(/\bst\b/g, 'saint'));
      add(words.join(' ').replace(/\bst\b/g, 'state'));
    }
    if (words.includes('and')) add(words.filter(word => word !== 'and').join(' '));
    // Postal state abbreviations also support queries such as "MI State".
    for (const [state, code] of Object.entries(STATE_CODES)) {
      if (` ${name} `.includes(` ${state} `)) add(` ${name} `.replace(` ${state} `, ` ${code} `));
    }
    const acronym = initials(words);
    if (acronym.length >= 2) add(acronym);
    if (words.length >= 3) add([initials(words.slice(0, 2)), ...words.slice(2)].join(' '));
    // School names before "State" are unambiguous within the supplied team's
    // metadata. Generate all of their initials, including the University U.
    const stateIndex = words.findIndex(word => word === 'state' || word === 'st');
    if (stateIndex > 0 && (college || !league)) {
      const school = [...words.slice(0, stateIndex), 'state'];
      const schoolInitials = initials(school);
      add(school.join(' '));
      add(school.join(' ').replace(/\bstate\b/g, 'st'));
      add(`${school.join(' ')} university`);
      add(`${schoolInitials}u`);
      if (schoolInitials.length >= 2) add(schoolInitials);
    }
  }
  return [...aliases];
}

// Bounded optimal-string-alignment distance includes adjacent transpositions.
// Short abbreviations never enter fuzzy matching, so a one-letter query or a
// mistyped acronym cannot sweep in unrelated teams.
function closeSpelling(query, candidate) {
  if (query.length < 5 || candidate.length < 5 || query.length > 40 || candidate.length > 40) return false;
  const limit = query.length >= 9 ? 2 : 1;
  if (Math.abs(query.length - candidate.length) > limit) return false;
  const rows = Array.from({length: query.length + 1}, () => Array(candidate.length + 1).fill(0));
  for (let i = 0; i <= query.length; i++) rows[i][0] = i;
  for (let j = 0; j <= candidate.length; j++) rows[0][j] = j;
  for (let i = 1; i <= query.length; i++) {
    for (let j = 1; j <= candidate.length; j++) {
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (query[i - 1] === candidate[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && query[i - 1] === candidate[j - 2] && query[i - 2] === candidate[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
      }
    }
  }
  return rows[query.length][candidate.length] <= limit;
}

function matchesAlias(alias, query) {
  if (alias === query || compact(alias) === compact(query)) return true;
  // Joined/spaced names, standard partial names and exact abbreviations.
  if (compact(query).length >= 3 && compact(alias).includes(compact(query))) return true;
  const queryWords = query.split(' '), aliasWords = alias.split(' ');
  let next = 0;
  for (const word of queryWords) {
    const found = aliasWords.findIndex((candidate, index) => index >= next && (
      word === candidate || word.length >= 3 && candidate.startsWith(word) || closeSpelling(word, candidate)
    ));
    if (found < 0) return false;
    next = found + 1;
  }
  return true;
}

function queryVariants(query) {
  const text = normalize(query);
  if (!text) return [];
  const stripped = withoutUniversity(text);
  return [...new Set([text, stripped].filter(Boolean))];
}

function matchesTeam(team, queries, sport) {
  return aliasesForTeam(team, sport).some(alias => queries.some(query => matchesAlias(alias, query)));
}

/** Match supplied metadata without resolving an ambiguous alias to one team. */
export function teamMatchesQuery(team, query, sport) {
  const queries = queryVariants(query);
  return queries.length === 0 || matchesTeam(team, queries, sport);
}

/** Filter in input order, preserving the exact game objects and overall ranks. */
export function filterGamesByTeam(games, query) {
  if (!Array.isArray(games)) return [];
  const queries = queryVariants(query);
  if (!queries.length) return games.slice();
  return games.filter(game => game && (matchesTeam(game.home, queries, game.sport)
    || matchesTeam(game.away, queries, game.sport)));
}
