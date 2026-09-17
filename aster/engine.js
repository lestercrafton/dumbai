/** The Last Bell of Xenaland — original, deterministic, JSON-safe adventure engine. */
export const VERSION = 1;

import { CHAPTERS, NODES, OPENING, AFTER_BATTLES, ENDING_STORY, endingSummary } from './story.js';
export { CHAPTERS, RING_INDEX, GIRL_INDEX } from './story.js';
export const CONTENT_REVISION = 2;

export const ENEMIES = [
  { id: 'brasswing', name: 'Brass Bird', subtitle: 'A bird caught in a spell', maxHp: 64, damage: 11, heavy: 26, heavyName: 'Wing Flap', special: 'plain', portrait: 'sentinel' },
  { id: 'choir', name: 'River Singers', subtitle: 'Singers caught in a spell', maxHp: 86, damage: 13, heavy: 29, heavyName: 'Big Splash', special: 'drain', portrait: 'choir' },
  { id: 'heron', name: 'Glass Heron', subtitle: 'A bird with shiny wings', maxHp: 104, damage: 14, heavy: 33, heavyName: 'Wing Gust', special: 'armor', portrait: 'heron' },
  { id: 'warden', name: 'Garden Guard', subtitle: 'A tree caught in a spell', maxHp: 120, damage: 16, heavy: 36, heavyName: 'Root Hug', special: 'siphon', portrait: 'warden' },
  { id: 'unrung', name: 'Cloud Guard', subtitle: 'A cloud caught in a spell', maxHp: 134, damage: 17, heavy: 39, heavyName: 'Big Boom', special: 'drain', portrait: 'unrung' },
  { id: 'vadish', name: 'Vadish', subtitle: 'A wizard who is scared of storms', maxHp: 132, damage: 18, heavy: 42, heavyName: 'Sleep Spell', special: 'boss', portrait: 'vadish' },
];

export const ABILITIES = {
  strike: { id: 'strike', label: 'Tap', description: '12 damage. Gain 1 magic and 1 song.', kind: 'attack' },
  chime: { id: 'chime', label: 'Ring', description: '20 damage. Costs 2 magic. Interrupts a heavy attack.', kind: 'magic' },
  mend: { id: 'mend', label: 'Heal', description: 'Restore 27 health. Costs 2 magic.', kind: 'heal' },
  guard: { id: 'guard', label: 'Shield', description: 'Take 70% less damage this turn. Gain 2 magic.', kind: 'defend' },
  harmony: { id: 'harmony', label: 'Team song', description: 'Spend 3 song: 35 damage and restore 15 health.', kind: 'special' },
};

const line = (speaker, text) => ({ speaker, text });
const clone = (state) => JSON.parse(JSON.stringify(state));
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const has = (state, upgrade) => state.upgrades.includes(upgrade);
const power = (state) => (has(state, 'voice') ? 3 : 0) + (state.battleBuff === 'courage' ? 2 : 0);
const addLog = (state, message) => { state.log = [...state.log.slice(-9), message]; };

function setStory(state, story, after, choices = null) {
  state.phase = 'story';
  state.story = story;
  state.storyIndex = 0;
  state.storyAfter = after;
  state.storyChoices = choices;
}

function setExplore(state) {
  const node = NODES[state.encounter];
  state.phase = 'explore';
  state.scene = { title: node.title, description: node.description, memoryTitle: node.memoryTitle };
  state.enemy = null;
  state.storyChoices = null;
}

function intentFor(state) {
  const enemy = state.enemy;
  const scale = state.difficulty === 'story' ? 0.64 : 1;
  if (state.turn % 3 === 0) {
    const damage = Math.round(enemy.heavy * scale);
    return { name: enemy.heavyName, damage, kind: 'heavy', description: `Use Ring to stop this big spell!` };
  }
  const damage = Math.round(enemy.damage * scale);
  if (enemy.special === 'drain' && state.turn % 3 === 2) {
    return { name: 'Magic Puff', damage, kind: 'drain', description: `Takes 1 magic. Shield keeps your magic safe.` };
  }
  if (enemy.special === 'siphon' && state.turn % 3 === 2) {
    return { name: 'Root Sip', damage, kind: 'siphon', description: `Heals the Garden Guard. Shield stops the healing.` };
  }
  const armor = enemy.special === 'armor' ? 4 : 0;
  return { name: enemy.bossPhase === 2 ? 'Star Spark' : 'Magic Bump', damage, kind: 'attack', description: `${armor ? 'Shiny wings block 4 Tap damage.' : 'You go first. Take your time.'}`, armor };
}

function beginBattle(state) {
  const definition = ENEMIES[state.encounter];
  state.phase = 'battle';
  state.enemy = { ...definition, hp: definition.maxHp, bossPhase: 1, intent: null };
  state.turn = 1;
  state.resonance = Math.max(state.resonance, has(state, 'thread') ? 1 : 0);
  state.hero.hp = state.hero.maxHp;
  state.hero.energy = state.hero.maxEnergy;
  state.battleBuff = state.pathBuff;
  state.openingShield = state.battleBuff === 'ward' ? 14 : 0;
  state.log = [NODES[state.encounter].enemyIntro, 'You are ready! Pick a move below.'];
  state.enemy.intent = intentFor(state);
  state.effect = { kind: 'battle', text: definition.name, target: 'enemy' };
}

function advanceAfterStory(state) {
  const after = state.storyAfter;
  state.storyAfter = null;
  state.storyChoices = null;
  if (after === 'explore') setExplore(state);
  else if (after === 'next-encounter') {
    state.encounter += 1;
    state.chapter = Math.floor(state.encounter / 2);
    state.explored = false;
    state.rested = false;
    state.pathBuff = null;
    state.resonance = 0;
    setExplore(state);
  } else if (after === 'battle') beginBattle(state);
  else if (after === 'ending') {
    state.phase = 'ending';
    state.enemy = null;
    state.completed = true;
    state.ending = endingSummary(state);
  }
}

function winBattle(state) {
  state.battlesWon += 1;
  state.shards += 1;
  state.hero.hp = state.hero.maxHp;
  state.hero.energy = state.hero.maxEnergy;
  state.phase = 'reward';
  state.enemy.hp = 0;
  state.reward = {
    title: state.encounter === 5 ? 'Vadish smiles' : 'You found a note!',
    text: state.encounter === 5 ? 'You beat the spell! Vadish is ready to help.' : 'You did it! Your health and magic are full.',
    upgrade: state.encounter === 1 || state.encounter === 3,
  };
  state.journal.push({ title: ENEMIES[state.encounter].name, text: `You helped ${ENEMIES[state.encounter].name}. You found a note!` });
  addLog(state, `${ENEMIES[state.encounter].name} smiles. You found a note!`);
  state.effect = { kind: 'victory', text: 'You found a note!', target: 'all' };
}

function combat(state, id) {
  const enemy = state.enemy;
  const intent = enemy.intent;
  let damage = 0;
  let heal = 0;
  let guarded = false;
  let interrupted = false;
  state.log = [];
  if (id === 'strike') {
    damage = Math.max(1, 12 + power(state) - (intent.armor || 0));
    state.hero.energy += 1;
    addLog(state, `Oshn taps his bell: ${damage} damage. +1 magic.`);
  } else if (id === 'chime') {
    damage = 20 + power(state);
    state.hero.energy -= 2;
    interrupted = intent.kind === 'heavy';
    addLog(state, `Ring deals ${damage} damage.${interrupted ? ` Big spell stopped!` : ''}`);
  } else if (id === 'mend') {
    state.hero.energy -= 2;
    heal = 27 + (has(state, 'thread') ? 8 : 0);
    addLog(state, `Oshn feels better: +${Math.min(heal, state.hero.maxHp - state.hero.hp)} health.`);
  } else if (id === 'guard') {
    state.hero.energy += 2;
    guarded = true;
    addLog(state, 'Isha spreads her wings. Shield blocks most of the hit. +2 magic.');
  } else if (id === 'harmony') {
    damage = 35 + power(state) * 2;
    heal = 15 + (has(state, 'thread') ? 8 : 0);
    state.resonance = 0;
    addLog(state, `Oshn and Isha sing: ${damage} damage and +${Math.min(heal, state.hero.maxHp - state.hero.hp)} health.`);
  }
  state.hero.hp = clamp(state.hero.hp + heal, 0, state.hero.maxHp);
  state.hero.energy = clamp(state.hero.energy, 0, state.hero.maxEnergy);
  if (id !== 'harmony') state.resonance = Math.min(3, state.resonance + 1);
  enemy.hp = Math.max(0, enemy.hp - damage);
  state.effect = { kind: id, text: damage ? `−${damage}` : heal ? `+${heal}` : 'Shielded', target: damage ? 'enemy' : 'hero' };

  if (enemy.hp === 0) {
    if (enemy.special === 'boss' && enemy.bossPhase === 1) {
      enemy.bossPhase = 2;
      enemy.name = 'Vadish';
      enemy.subtitle = 'His last spell is fading';
      enemy.maxHp = 96;
      enemy.hp = 96;
      enemy.damage = 20;
      enemy.heavy = 44;
      enemy.heavyName = 'Big Sleep Spell';
      state.hero.hp = Math.min(state.hero.maxHp, state.hero.hp + 24);
      state.hero.energy = Math.min(state.hero.maxEnergy, state.hero.energy + 2);
      state.turn = 1;
      enemy.intent = intentFor(state);
      addLog(state, 'Vadish tries one last spell! Isha helps her brother: +24 health and +2 magic.');
      state.effect = { kind: 'transform', text: 'One last spell!', target: 'all' };
      return;
    }
    winBattle(state);
    return;
  }

  if (!interrupted) {
    let incoming = guarded ? Math.ceil(intent.damage * 0.3) : intent.damage;
    if (state.openingShield > 0) {
      const absorbed = Math.min(incoming, state.openingShield);
      incoming -= absorbed;
      state.openingShield -= absorbed;
      if (absorbed) addLog(state, `Your gift blocks ${absorbed} damage.`);
    }
    state.hero.hp = Math.max(0, state.hero.hp - incoming);
    addLog(state, `${enemy.name} uses ${intent.name}: ${incoming} damage${guarded ? ' after Shield' : ''}.`);
    if (intent.kind === 'drain' && !guarded) {
      state.hero.energy = Math.max(0, state.hero.energy - 1);
      addLog(state, 'You lose 1 magic.');
    }
    if (intent.kind === 'siphon' && !guarded) {
      enemy.hp = Math.min(enemy.maxHp, enemy.hp + 6);
      addLog(state, 'The roots heal 6 health. Shield can stop this.');
    }
  } else addLog(state, `The big spell is gone! You are safe.`);

  if (state.hero.hp === 0) {
    state.phase = 'defeat';
    state.effect = { kind: 'defeat', text: 'You can try again!', target: 'hero' };
    addLog(state, 'Isha helps Oshn up. Try again from here.');
    return;
  }
  state.turn += 1;
  enemy.intent = intentFor(state);
}

/** Legal UI actions, including disabled abilities with an explanation. */
export function actions(state) {
  if (!state || state.version !== VERSION) return [];
  if (state.phase === 'story') {
    if (state.storyIndex === state.story.length - 1 && state.storyChoices) return state.storyChoices;
    return [{ id: 'next', label: state.storyIndex === state.story.length - 1 ? 'Go on' : 'Next', description: '', kind: 'story' }];
  }
  if (state.phase === 'explore') {
    const choices = [];
    if (!state.explored) choices.push({ id: 'investigate', label: NODES[state.encounter].memoryTitle, description: 'Look here! Find a small gift.', kind: 'memory' });
    choices.push({ id: 'travel', label: state.encounter === 5 ? 'Go to the bell' : 'Go on', description: `${state.explored ? '' : '' }Face ${ENEMIES[state.encounter].name}. Start with full health and magic.`, kind: 'travel' });
    return choices;
  }
  if (state.phase === 'battle') {
    const extra = power(state);
    return [
      { ...ABILITIES.strike, description: `${12 + extra} damage. Get 1 magic.` },
      { ...ABILITIES.chime, description: `${20 + extra} damage. Stops big spells! Costs 2 magic.`, disabled: state.hero.energy < 2 },
      { ...ABILITIES.mend, description: `+${27 + (has(state, 'thread') ? 8 : 0)} health. Costs 2 magic.`, disabled: state.hero.energy < 2 || state.hero.hp === state.hero.maxHp },
      { ...ABILITIES.guard, description: 'Block most of a hit. Get 2 magic.' },
      { ...ABILITIES.harmony, description: `${35 + extra * 2} damage. +${15 + (has(state, 'thread') ? 8 : 0)} health. Needs 3 song lights.`, disabled: state.resonance < 3 },
    ];
  }
  if (state.phase === 'reward') {
    if (state.reward.upgrade) {
      return [
        { id: 'upgrade-heart', label: 'More health', description: '+20 health for the whole game.', kind: 'upgrade', disabled: has(state, 'heart') },
        { id: 'upgrade-voice', label: 'Stronger song', description: 'Tap and Ring hit harder. So does Team song.', kind: 'upgrade', disabled: has(state, 'voice') },
        { id: 'upgrade-thread', label: 'More healing', description: 'Heal more. Start each battle with 1 song light.', kind: 'upgrade', disabled: has(state, 'thread') },
      ];
    }
    return [{ id: 'continue', label: state.encounter === 5 ? 'Ring the bell together' : 'Go on', description: state.encounter === 5 ? 'Help Vadish bring back the sun.' : 'The road continues.', kind: 'continue' }];
  }
  if (state.phase === 'defeat') return [{ id: 'retry', label: 'Try again', description: 'Start this battle again. Your health is full.', kind: 'retry' }];
  return [];
}

function finish(state) {
  state.hero.hp = clamp(state.hero.hp, 0, state.hero.maxHp);
  state.hero.energy = clamp(state.hero.energy, 0, state.hero.maxEnergy);
  state.resonance = clamp(state.resonance, 0, 3);
  state.options = actions(state);
  return state;
}

export function createGame(difficulty = 'normal') {
  const maxHp = difficulty === 'story' ? 124 : 96;
  const state = {
    version: VERSION, contentRevision: CONTENT_REVISION, difficulty: difficulty === 'story' ? 'story' : 'normal',
    phase: 'story', chapter: 0, encounter: 0, story: OPENING, storyIndex: 0,
    storyAfter: 'explore', storyChoices: null,
    hero: { name: 'Oshn', age: 7, pronouns: 'he/him', hp: maxHp, maxHp, energy: 5, maxEnergy: 5 },
    companion: { name: 'Isha', pronouns: 'she/her', relationship: 'sister', description: 'Oshn’s sister. A girl with a magical moth form.' },
    enemy: null, turn: 0, resonance: 0, shards: 0, battlesWon: 0,
    upgrades: [], journal: [], log: [], options: [], memories: { kept: 0, released: 0 },
    explored: false, rested: false, pathBuff: null, battleBuff: null, openingShield: 0,
    completed: false, reward: null, effect: null,
    scene: { title: NODES[0].title, description: NODES[0].description, memoryTitle: NODES[0].memoryTitle },
  };
  return finish(clone(state));
}

/** Return a new state. Unknown or unavailable actions are safely ignored. */
export function act(previous, action) {
  const id = typeof action === 'string' ? action : action?.id;
  const state = clone(previous);
  const available = actions(state).find((candidate) => candidate.id === id && !candidate.disabled);
  if (!available) return finish(state);
  state.effect = null;
  if (state.phase === 'story') {
    if (id === 'next') {
      if (state.storyIndex < state.story.length - 1) state.storyIndex += 1;
      else advanceAfterStory(state);
    } else if (id === 'choice-keep' || id === 'choice-release') {
      const kept = id === 'choice-keep';
      const node = NODES[state.encounter];
      state.memories[kept ? 'kept' : 'released'] += 1;
      state.pathBuff = kept ? 'courage' : 'ward';
      state.explored = true;
      const text = kept ? node.kept : node.released;
      state.journal.push({ title: node.memoryTitle, text });
      setStory(state, [line('Oshn and Isha', text), line('Your gift', kept ? 'Your bell glows! It hits a little harder.' : 'A soft light keeps you safe from 14 damage.')], 'explore');
      state.effect = { kind: 'memory', text: kept ? 'A stronger bell' : 'A little shield', target: 'all' };
    }
  } else if (state.phase === 'explore') {
    if (id === 'investigate') {
      const node = NODES[state.encounter];
      setStory(state, node.memory, 'explore', [
        { id: 'choice-keep', label: node.choices[0], description: 'Get a stronger bell for this battle.', kind: 'choice' },
        { id: 'choice-release', label: node.choices[1], description: 'Get a little shield for this battle.', kind: 'choice' },
      ]);
    } else if (id === 'travel') {
      setStory(state, [line(ENEMIES[state.encounter].name, NODES[state.encounter].enemyIntro)], 'battle');
    }
  } else if (state.phase === 'battle') combat(state, id);
  else if (state.phase === 'reward') {
    if (id.startsWith('upgrade-')) {
      const upgrade = id.replace('upgrade-', '');
      state.upgrades.push(upgrade);
      if (upgrade === 'heart') { state.hero.maxHp += 20; state.hero.hp = state.hero.maxHp; }
      state.reward.upgrade = false;
      state.effect = { kind: 'upgrade', text: available.label, target: 'hero' };
    } else if (id === 'continue') {
      if (state.encounter === 5) setStory(state, ENDING_STORY, 'ending');
      else setStory(state, AFTER_BATTLES[state.encounter], 'next-encounter');
    }
  } else if (state.phase === 'defeat' && id === 'retry') {
    state.resonance = 0;
    beginBattle(state);
    addLog(state, 'Try again! Ring stops big spells. Shield gives you magic.');
  }
  return finish(state);
}

/** Reject incompatible or damaged saves before presenting a Continue button. */
export function isValidSave(state) {
  if (!state || typeof state !== 'object' || state.version !== VERSION) return false;
  if (!['story', 'normal'].includes(state.difficulty)) return false;
  if (!['story', 'explore', 'battle', 'reward', 'ending', 'defeat'].includes(state.phase)) return false;
  if (!Number.isInteger(state.encounter) || state.encounter < 0 || state.encounter > 5 || state.chapter !== Math.floor(state.encounter / 2)) return false;
  if (!state.hero || !Number.isFinite(state.hero.hp) || !Number.isFinite(state.hero.maxHp) || state.hero.maxHp < 1 || state.hero.hp < 0 || state.hero.hp > state.hero.maxHp) return false;
  if (!Number.isFinite(state.hero.energy) || state.hero.energy < 0 || state.hero.energy > state.hero.maxEnergy || state.hero.maxEnergy !== 5) return false;
  if (!Number.isInteger(state.resonance) || state.resonance < 0 || state.resonance > 3) return false;
  if (!Array.isArray(state.upgrades) || state.upgrades.length > 2 || state.upgrades.some((upgrade) => !['heart', 'voice', 'thread'].includes(upgrade)) || new Set(state.upgrades).size !== state.upgrades.length) return false;
  if (!Array.isArray(state.journal) || state.journal.some((entry) => !entry || typeof entry.title !== 'string' || typeof entry.text !== 'string')) return false;
  if (!Array.isArray(state.log) || state.log.some((entry) => typeof entry !== 'string')) return false;
  if (!state.memories || !Number.isInteger(state.memories.kept) || !Number.isInteger(state.memories.released) || state.memories.kept < 0 || state.memories.released < 0 || state.memories.kept + state.memories.released > 6) return false;
  if (!Number.isInteger(state.shards) || state.shards < 0 || state.shards > 6 || state.battlesWon !== state.shards) return false;
  if (!state.scene || typeof state.scene.title !== 'string' || typeof state.scene.description !== 'string') return false;
  if (state.phase === 'story') {
    if (!Array.isArray(state.story) || !Number.isInteger(state.storyIndex) || state.storyIndex < 0 || state.storyIndex >= state.story.length || state.story.some((entry) => !entry || typeof entry.speaker !== 'string' || typeof entry.text !== 'string')) return false;
    if (!['explore', 'next-encounter', 'battle', 'ending'].includes(state.storyAfter)) return false;
    if (state.storyAfter === 'next-encounter' && state.encounter >= 5) return false;
    if (state.storyChoices !== null && (!Array.isArray(state.storyChoices) || state.storyChoices.length !== 2 || state.storyChoices.some((choice) => !choice || !['choice-keep', 'choice-release'].includes(choice.id) || typeof choice.label !== 'string'))) return false;
  }
  if (['battle', 'defeat'].includes(state.phase)) {
    if (!state.enemy || !state.enemy.intent || !Number.isFinite(state.enemy.hp) || !Number.isFinite(state.enemy.maxHp) || state.enemy.maxHp <= 0 || state.enemy.hp < 0 || state.enemy.hp > state.enemy.maxHp || !Number.isInteger(state.turn) || state.turn < 1) return false;
    if (!Number.isFinite(state.enemy.damage) || !Number.isFinite(state.enemy.heavy) || !Number.isFinite(state.enemy.intent.damage) || typeof state.enemy.intent.description !== 'string') return false;
    if (state.phase === 'battle' && (state.hero.hp === 0 || state.enemy.hp === 0)) return false;
  }
  if (state.phase === 'reward' && (!state.reward || typeof state.reward.upgrade !== 'boolean')) return false;
  if (state.phase === 'ending' && (!state.completed || state.battlesWon !== 6 || !state.ending || typeof state.ending.title !== 'string')) return false;
  return true;
}

/** Refresh story copy in older saves without changing earned progress or battle numbers. */
export function migrateSave(previous) {
  if (!isValidSave(previous)) return null;
  const state = clone(previous);
  if (state.contentRevision === CONTENT_REVISION) return state;
  state.contentRevision = CONTENT_REVISION;
  Object.assign(state.hero, {name: 'Oshn', age: 7, pronouns: 'he/him'});
  state.companion = {name: 'Isha', pronouns: 'she/her', relationship: 'sister', description: 'Oshn’s sister. A girl with a magical moth form.'};
  const node = NODES[state.encounter];
  state.scene = {title: node.title, description: node.description, memoryTitle: node.memoryTitle};
  const oldFinds = ['A lunch wrapped in cloth', 'A ticket for two', 'An imperfect afternoon', 'The chair beside hers', 'The last repair', 'A loose silver thread'];
  const oldFoes = ['Brasswing Sentinel', 'The Silt Choir', 'Mirror Heron', 'The Orchard Warden', 'The Unrung', 'Vadish'];
  state.journal = state.journal.map(entry => {
    const find = oldFinds.indexOf(entry.title), foe = oldFoes.indexOf(entry.title);
    if (find >= 0) return {title: NODES[find].memoryTitle, text: 'Oshn and Isha found a gift here. It helped them on their way.'};
    if (foe >= 0) return {title: ENEMIES[foe].name, text: `You helped ${ENEMIES[foe].name}. You found a note!`};
    return {title: 'Our adventure', text: 'Oshn and Isha helped their friends in Xenaland.'};
  });
  state.log = ['Oshn and his sister Isha are ready. Let’s go!'];
  state.effect = null;
  if (state.enemy) {
    const definition = ENEMIES[state.encounter];
    state.enemy.name = definition.name;
    state.enemy.subtitle = definition.subtitle;
    state.enemy.heavyName = state.enemy.bossPhase === 2 ? 'Big Sleep Spell' : definition.heavyName;
    if (state.enemy.intent) {
      const shownDamage = state.enemy.intent.damage;
      state.enemy.intent = {...intentFor(state), damage: shownDamage};
    }
  }
  if (state.reward) {
    state.reward.title = state.encounter === 5 ? 'Vadish smiles' : 'You found a note!';
    state.reward.text = state.encounter === 5 ? 'You beat the spell! Vadish is ready to help.' : 'You did it! Your health and magic are full.';
  }
  if (state.phase === 'story') {
    const oldIndex = state.storyIndex;
    if (state.storyAfter === 'ending') state.story = ENDING_STORY;
    else if (state.storyAfter === 'next-encounter') state.story = AFTER_BATTLES[state.encounter];
    else if (state.storyAfter === 'battle') state.story = [line(ENEMIES[state.encounter].name, node.enemyIntro)];
    else if (state.storyChoices) {
      state.story = node.memory;
      state.storyChoices = [
        {id: 'choice-keep', label: node.choices[0], description: 'Get a stronger bell for this battle.', kind: 'choice'},
        {id: 'choice-release', label: node.choices[1], description: 'Get a little shield for this battle.', kind: 'choice'},
      ];
    } else if (state.explored) {
      const kept = state.pathBuff === 'courage';
      state.story = [line('Oshn and Isha', kept ? node.kept : node.released), line('Your gift', kept ? 'Your bell glows! It hits a little harder.' : 'A soft light keeps you safe from 14 damage.')];
    } else state.story = OPENING;
    // Restart revised opening/ending so returning readers get the new family context.
    state.storyIndex = state.story === OPENING || state.story === ENDING_STORY ? 0 : Math.min(oldIndex, state.story.length - 1);
  } else {
    state.story = [];
    state.storyIndex = 0;
    state.storyChoices = null;
  }
  if (state.phase === 'ending') state.ending = endingSummary(state);
  return finish(state);
}
