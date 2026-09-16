import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGame, act, actions, isValidSave, VERSION, ENEMIES } from './engine.js';

function choose(state, id) {
  const choice = actions(state).find((a) => a.id === id);
  assert.ok(choice && !choice.disabled, `Action ${id} unavailable in ${state.phase}`);
  const snapshot = JSON.stringify(state);
  const next = act(state, { id });
  assert.equal(JSON.stringify(state), snapshot, 'act must never mutate its input');
  assert.ok(isValidSave(next), `Invalid state after ${id}`);
  assert.notEqual(next, state);
  return next;
}

function firstBattle(difficulty = 'normal', withMemory = false) {
  let state = createGame(difficulty);
  while (state.phase === 'story') state = choose(state, 'next');
  if (withMemory) {
    state = choose(state, 'investigate');
    while (actions(state).some((a) => a.id === 'next')) state = choose(state, 'next');
    state = choose(state, 'choice-release');
    while (state.phase === 'story') state = choose(state, 'next');
  }
  state = choose(state, 'travel');
  while (state.phase === 'story') state = choose(state, 'next');
  assert.equal(state.phase, 'battle');
  return state;
}

function fightPolicy(state) {
  const available = (id) => actions(state).some((a) => a.id === id && !a.disabled);
  // React to the visible heavy attack, heal when wounded, then use resonance.
  if (state.enemy.intent.kind === 'heavy') return available('chime') ? 'chime' : 'guard';
  if (available('harmony')) return 'harmony';
  if (state.hero.hp <= state.hero.maxHp * 0.5 && available('mend')) return 'mend';
  if (state.hero.energy === 0 && state.hero.hp < state.hero.maxHp * 0.55) return 'guard';
  return 'strike';
}

function playThrough(difficulty, memoryChoice = 'choice-keep', upgradeOrder = ['voice', 'thread'], skipMemories = false) {
  let state = createGame(difficulty);
  const counts = { actions: 0, rounds: 0, battles: new Set(), transformations: 0, lowestHp: Infinity };
  while (state.phase !== 'ending' && counts.actions < 400) {
    let id;
    if (state.phase === 'story') id = actions(state).some((a) => a.id === 'next') ? 'next' : memoryChoice;
    else if (state.phase === 'explore') id = state.explored || skipMemories ? 'travel' : 'investigate';
    else if (state.phase === 'battle') {
      id = fightPolicy(state);
      counts.rounds++;
      counts.battles.add(state.encounter);
    } else if (state.phase === 'reward') {
      id = state.reward.upgrade ? `upgrade-${upgradeOrder[state.upgrades.length]}` : 'continue';
    } else assert.fail(`Playthrough reached unexpected phase ${state.phase}; last log: ${state.log.join(' | ')}`);
    state = choose(state, id);
    counts.actions++;
    counts.lowestHp = Math.min(counts.lowestHp, state.hero.hp);
    if (state.effect?.kind === 'transform') counts.transformations++;
    assert.ok(actions(state).some((a) => !a.disabled) || state.phase === 'ending', 'No legal action: softlock');
    // Every boundary can survive the same serialization used by browser autosave.
    state = JSON.parse(JSON.stringify(state));
  }
  assert.equal(state.phase, 'ending', 'Game must reach its ending in a bounded number of actions');
  assert.equal(state.completed, true);
  assert.equal(state.battlesWon, 6);
  assert.equal(state.shards, 6);
  assert.equal(counts.battles.size, 6);
  assert.equal(counts.transformations, 1);
  assert.equal(state.memories.kept + state.memories.released, skipMemories ? 0 : 6);
  assert.equal(state.upgrades.length, 2);
  assert.ok(state.ending.text.length > 30);
  return { state, counts };
}

test('normal and story modes are fully playable, including every memory and the two-phase finale', () => {
  for (const difficulty of ['normal', 'story']) {
    const { counts } = playThrough(difficulty);
    console.log(`${difficulty}: ${counts.actions} actions, ${counts.rounds} combat rounds, minimum health ${counts.lowestHp}`);
  }
});

test('release choices and each alternative upgrade combination also complete normally', () => {
  for (const upgrades of [['heart', 'thread'], ['thread', 'voice'], ['voice', 'heart']]) {
    const { state } = playThrough('normal', 'choice-release', upgrades);
    assert.equal(state.memories.released, 6);
    assert.match(state.ending.epilogue, /door open/);
  }
});

test('the direct route remains completable without optional memories or their buffs', () => {
  const { state } = playThrough('normal', 'choice-keep', ['heart', 'thread'], true);
  assert.equal(state.memories.kept + state.memories.released, 0);
  assert.equal(state.phase, 'ending');
});

test('inputs are immutable and invalid actions cannot spend resources or skip progress', () => {
  const state = firstBattle();
  const next = act(state, 'continue');
  assert.deepEqual(next, state);
  const noBreath = { ...state, hero: { ...state.hero, energy: 0 } };
  assert.deepEqual(act(noBreath, 'chime').hero, noBreath.hero);
  assert.equal(act(noBreath, 'chime').enemy.hp, noBreath.enemy.hp);
  assert.equal(actions(noBreath).find((a) => a.id === 'chime').disabled, true);
});

test('strike grants breath, chime spends it, and only heavy attacks are interrupted', () => {
  let state = firstBattle();
  state.hero.energy = 1;
  state = choose(state, 'strike');
  assert.equal(state.hero.energy, 2);
  const hp = state.hero.hp;
  state = choose(state, 'chime');
  assert.equal(state.hero.energy, 0);
  assert.ok(state.hero.hp < hp, 'Chime must not interrupt ordinary attacks');
  assert.equal(state.enemy.intent.kind, 'heavy');
  state.hero.energy = 2;
  state.enemy.hp = state.enemy.maxHp;
  const beforeHeavy = state.hero.hp;
  state = choose(state, 'chime');
  assert.equal(state.hero.hp, beforeHeavy);
  assert.ok(state.log.some((entry) => entry.includes('interrupted')));
  assert.equal(state.turn, 4);
});

test('Shelter reduces damage, prevents breath drain, and resources remain capped', () => {
  let state = firstBattle();
  const damage = state.enemy.intent.damage;
  state = choose(state, 'guard');
  assert.equal(state.hero.hp, state.hero.maxHp - Math.ceil(damage * 0.3));
  assert.equal(state.hero.energy, 5);
  for (let i = 0; i < 3; i++) state = choose(state, 'guard');
  assert.equal(state.resonance, 3);
  state.enemy.intent = { name: 'Borrowed Breath', kind: 'drain', damage: 10 };
  state.hero.energy = 0;
  state = choose(state, 'guard');
  assert.equal(state.hero.energy, 2);
  state = choose(state, 'harmony');
  assert.equal(state.resonance, 0);
  assert.ok(state.hero.hp <= state.hero.maxHp);
});

test('Mend spends two breath and heals before the telegraphed enemy response', () => {
  let state = firstBattle();
  state.hero.hp = 30;
  state.hero.energy = 3;
  const incoming = state.enemy.intent.damage;
  state = choose(state, 'mend');
  assert.equal(state.hero.hp, 30 + 27 - incoming);
  assert.equal(state.hero.energy, 1);
  assert.equal(state.resonance, 1);
});

test('memory shield absorbs damage; easy mode reduces enemy damage', () => {
  const normal = firstBattle('normal', true);
  const story = firstBattle('story');
  assert.ok(story.enemy.intent.damage < normal.enemy.intent.damage);
  const next = choose(normal, 'strike');
  assert.equal(next.hero.hp, next.hero.maxHp);
  assert.equal(next.openingShield, 3);
});

test('defeat can retry the same battle with all memories and upgrades retained', () => {
  let state = firstBattle('normal', true);
  state.hero.hp = 1;
  state.openingShield = 0;
  const before = JSON.parse(JSON.stringify(state));
  state = choose(state, 'strike');
  assert.equal(state.phase, 'defeat');
  assert.equal(state.hero.hp, 0);
  state = choose(state, 'retry');
  assert.equal(state.phase, 'battle');
  assert.equal(state.encounter, before.encounter);
  assert.equal(state.hero.hp, state.hero.maxHp);
  assert.equal(state.hero.energy, state.hero.maxEnergy);
  assert.equal(state.enemy.hp, ENEMIES[0].maxHp);
  assert.deepEqual(state.memories, before.memories);
  assert.deepEqual(state.upgrades, before.upgrades);
  assert.deepEqual(state.journal, before.journal);
  assert.equal(state.openingShield, 14);
});

test('save validation rejects damaged/incompatible saves', () => {
  const state = createGame();
  assert.equal(state.version, VERSION);
  assert.ok(isValidSave(state));
  for (const invalid of [null, {}, { ...state, version: 0 }, { ...state, encounter: 20 }, { ...state, resonance: 8 }, { ...state, storyIndex: 100 }, { ...state, storyAfter: 'unknown' }, { ...state, storyChoices: 'broken' }, { ...state, upgrades: ['heart', 'heart'] }, { ...state, phase: 'battle' }, { ...state, hero: { ...state.hero, hp: -1 } }]) {
    assert.equal(isValidSave(invalid), false);
  }
});
