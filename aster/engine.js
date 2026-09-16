/** The Last Bell of Xenaland — original, deterministic, JSON-safe adventure engine. */
export const VERSION = 1;

export const CHAPTERS = [
  { title: 'I · The Shore of Unsaid Things', location: 'The Drowned Causeway', description: 'Bells lie beneath the water. One of them is still listening.', theme: 'shore' },
  { title: 'II · A Garden for Tomorrow', location: 'The Glass Orchard', description: 'Every fruit holds a day that someone was afraid to lose.', theme: 'orchard' },
  { title: 'III · What the Morning Keeps', location: 'The Bell at the End of the Sea', description: 'At the edge of the world, silence has learned your name.', theme: 'tower' },
];

export const ENEMIES = [
  { id: 'brasswing', name: 'Brasswing Sentinel', subtitle: 'A faithful machine with no one left to guard', maxHp: 64, damage: 11, heavy: 26, heavyName: 'Falling Anchor', special: 'plain', portrait: 'sentinel' },
  { id: 'choir', name: 'The Silt Choir', subtitle: 'A thousand voices, afraid to sing alone', maxHp: 86, damage: 13, heavy: 29, heavyName: 'Undertow Anthem', special: 'drain', portrait: 'choir' },
  { id: 'heron', name: 'Mirror Heron', subtitle: 'It remembers every sky except the real one', maxHp: 104, damage: 14, heavy: 33, heavyName: 'Shattering Flight', special: 'armor', portrait: 'heron' },
  { id: 'warden', name: 'The Orchard Warden', subtitle: 'Love, rooted so deeply it cannot let go', maxHp: 120, damage: 16, heavy: 36, heavyName: 'Winter’s Embrace', special: 'siphon', portrait: 'warden' },
  { id: 'unrung', name: 'The Unrung', subtitle: 'The shape of every word left unsaid', maxHp: 134, damage: 17, heavy: 39, heavyName: 'Borrowed Thunder', special: 'drain', portrait: 'unrung' },
  { id: 'vadish', name: 'Vadish', subtitle: 'A wizard who mistook stillness for safety', maxHp: 132, damage: 18, heavy: 42, heavyName: 'The Last Quiet', special: 'boss', portrait: 'vadish' },
];

export const ABILITIES = {
  strike: { id: 'strike', label: 'Needle strike', description: '12 damage. Gain 1 breath and 1 resonance.', kind: 'attack' },
  chime: { id: 'chime', label: 'Bright chime', description: '20 damage. Costs 2 breath. Interrupts a heavy attack.', kind: 'magic' },
  mend: { id: 'mend', label: 'Mend', description: 'Restore 27 health. Costs 2 breath.', kind: 'heal' },
  guard: { id: 'guard', label: 'Shelter', description: 'Take 70% less damage this turn. Gain 2 breath.', kind: 'defend' },
  harmony: { id: 'harmony', label: 'Moth & metal', description: 'Spend 3 resonance: 35 damage and restore 15 health.', kind: 'special' },
};

const line = (speaker, text) => ({ speaker, text });
const NODES = [
  {
    title: 'The Causeway', description: 'A road of blue stones disappears into a sleeping sea. Above it, a brass bird circles the same empty cradle.',
    memoryTitle: 'A lunch wrapped in cloth', memory: [
      line('Oshn', 'Someone left a lunch on the milestone. The bread is still warm.'),
      line('Isha', 'The bell kept the last moment of every life in Xenaland. Warm bread. An unfinished letter. A goodbye that never arrived.'),
      line('Oshn', 'My mother used to leave a second slice. She always said that fixing something was hungry work.'),
    ], choices: ['Keep the warmth', 'Share it with the sea'],
    kept: 'You wrap the warm bread in your mending cloth. Some small things deserve to travel.', released: 'You leave crumbs for the silver fish. For a moment, the water remembers how to move.',
    enemyIntro: 'The brass bird lands. Its wings become a shield between you and the road.',
  },
  {
    title: 'The Ferry Without a Shore', description: 'An empty ferry waits beneath a lamp made of sea glass. Voices hum under its hull. They have forgotten where they were going.',
    memoryTitle: 'A ticket for two', memory: [
      line('Oshn', 'Two tickets. The date is the day the sea stopped.'),
      line('Isha', 'Someone waited here for a person who never came.'),
      line('Oshn', 'You can spend a whole life calling that a betrayal. Or you can leave them a light and take the boat.'),
    ], choices: ['Carry the spare ticket', 'Light the ferry lamp'],
    kept: 'You tuck the ticket beside your tools. A place can remain open without keeping you still.', released: 'The lamp wakes. A path of amber shivers over the water, and the ferry turns toward it.',
    enemyIntro: 'The voices rise together. They ask you to stay. They do not yet know how to ask gently.',
  },
  {
    title: 'The Glass Orchard', description: 'Transparent trees grow out of flooded houses. Within each hanging fruit, an ordinary afternoon repeats forever.',
    memoryTitle: 'An imperfect afternoon', memory: [
      line('Oshn', 'That is our kitchen. I broke the green cup. Mother laughed so hard she burned the soup.'),
      line('Isha', 'You could watch it once more.'),
      line('Oshn', 'I have watched it in my head for seven years. I always forget the soup.'),
    ], choices: ['Remember the laughter', 'Open a window in the memory'],
    kept: 'You keep the whole afternoon, burnt soup and all. The fruit dims; the memory stays yours.', released: 'You turn the glass latch. The afternoon exhales into the orchard, carrying the smell of soup.',
    enemyIntro: 'A heron steps out of your reflection. In its wings are all the skies you wish you could return to.',
  },
  {
    title: 'The Gardener’s Table', description: 'A stone table holds thousands of names, carefully watered. Roots curl around a single empty chair.',
    memoryTitle: 'The chair beside hers', memory: [
      line('Isha', 'This gardener planted memories so that no one would have to be lonely.'),
      line('Oshn', 'And then nobody could leave.'),
      line('Isha', 'When I first woke, I thought I was a letter. A little paper moth with nowhere to deliver itself.'),
      line('Oshn', 'You found somewhere.'),
    ], choices: ['Carve Isha’s name beside yours', 'Plant an unwritten page'],
    kept: 'OSHN. ISHA. Two small names among thousands. Isha reads his several times.', released: 'You plant a blank page. A pale shoot unfolds, bearing no memory at all. Only possibility.',
    enemyIntro: 'The gardener’s roots gather into a towering figure. “Nothing precious leaves this place,” it says.',
  },
  {
    title: 'The Unfinished Stair', description: 'The tower is built from bells that never rang. Between its steps, the entire sea hangs in the air.',
    memoryTitle: 'The last repair', memory: [
      line('Oshn', 'Mother’s tools. She came here before the sea rose.'),
      line('Tamsin’s note', 'Oshn — the great bell is not broken. It is frightened. We asked it to keep our loved ones safe, and it mistook safe for still.'),
      line('Tamsin’s note', 'I cannot promise to get home. Please do not make a monument of waiting. Make breakfast. Fix the window. Live a little badly, and then try again.'),
      line('Oshn', 'I was so angry that she left. I think I can be angry and love her at the same time.'),
    ], choices: ['Fold the note beside your heart', 'Read it aloud to the sleeping sea'],
    kept: 'You fold the note along its old creases. You will read it on ordinary days, too.', released: 'Your voice shakes, then steadies. Far below, someone sleeping turns toward a sound.',
    enemyIntro: 'All the words you never said gather on the stair. This time, you will go through them.',
  },
  {
    title: 'The Heart of the Bell', description: 'An immense bell hangs over the horizon. Beneath its rim stands Vadish, a wizard weaving the dawn shut with silver threads of magic.',
    memoryTitle: 'A loose silver thread', memory: [
      line('Isha', 'There is something I should tell you. This thread, and the paper in my wings… I am made from the bell’s last unanswered wish.'),
      line('Oshn', 'Whose wish?'),
      line('Isha', 'Your mother’s. That you would not have to walk home alone.'),
      line('Oshn', 'Then it worked. Whatever happens when the bell rings, it worked.'),
    ], choices: ['Tie a thread around Isha’s wing', 'Teach Isha your mother’s tune'],
    kept: 'You tie a careful mender’s knot. Not to hold him in place. To help him find his way.', released: 'You hum, badly. Isha hums worse. For the first time, the tower contains a song nobody remembers.',
    enemyIntro: 'The wizard lowers his staff. “If morning comes,” says Vadish, “you will lose her all over again.”',
  },
];

const OPENING = [
  line('The sea remembers', 'For seven years, morning has waited beneath the sea. The people of Xenaland sleep inside their final happy moment. Nothing grows old. Nothing grows.'),
  line('Oshn', 'I mend bells. Doorbells, ship bells, the little ones people tie to cats. Mother taught me that anything can ring again if you find the right place to listen.'),
  line('Oshn', 'She went to repair the great bell on the day the water rose. I have been waiting for her ever since.'),
  line('Isha', 'Then a paper moth knocked on my window. That is me, by the way. Isha. Please do not confuse me with the enormous, alarming sea.'),
  line('Isha', 'The great bell is still there. So is the road to it. I could show you, if you are finished waiting.'),
  line('Oshn', 'I take my needle, my tuning fork, and the coat Mother said I would grow into. It fits now.'),
];

const AFTER_BATTLES = [
  [line('Oshn', 'The sentinel folds into a small brass bird. No longer a guard. Just a thing that might learn to fly.'), line('Isha', 'You did not break it.'), line('Oshn', 'You can mend something by helping it stop.')],
  [line('The Silt Choir', 'One voice finds a melody of its own. Another answers. The ferry begins to move.'), line('Isha', 'The first note of morning. Not bad for a bell mender and some nervous stationery.'), line('Oshn', 'Beyond the water, glass trees catch a light that has no source. We follow it.')],
  [line('Oshn', 'The heron steps into the sky. For an instant, it casts a reflection in the air.'), line('Isha', 'Did you see what was inside it?'), line('Oshn', 'Tomorrow. I think it had never seen tomorrow before.')],
  [line('The Warden', '“If they leave,” the gardener whispers, “who will remember me?”'), line('Oshn', 'They will. Some days. While making tea, or hearing a song. You do not have to keep them here to be loved.'), line('The garden', 'A root loosens. Then another. The empty chair remains. Around it, real leaves begin to grow.')],
  [line('Oshn', 'The unfinished words settle into my hands. I do not say all of them. I only say, “I wish we had more time.”'), line('Isha', 'The stair makes room for us.'), line('Oshn', 'Above, the great bell is silent. A silence so careful it must be afraid.')],
];

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
    return { name: enemy.heavyName, damage, kind: 'heavy', description: `Gathering a heavy attack: ${damage} damage. Bright chime interrupts it; Shelter reduces it by 70%.` };
  }
  const damage = Math.round(enemy.damage * scale);
  if (enemy.special === 'drain' && state.turn % 3 === 2) {
    return { name: 'Borrowed Breath', damage, kind: 'drain', description: `${damage} damage and drains 1 breath. Shelter prevents the breath drain.` };
  }
  if (enemy.special === 'siphon' && state.turn % 3 === 2) {
    return { name: 'Root & Remember', damage, kind: 'siphon', description: `${damage} damage, then restores 6 enemy health. Shelter prevents its healing.` };
  }
  const armor = enemy.special === 'armor' ? 4 : 0;
  return { name: enemy.bossPhase === 2 ? 'Daybreak’s Edge' : 'Echoing Blow', damage, kind: 'attack', description: `${damage} damage.${armor ? ' Mirror feathers reduce Needle strike damage by 4 this turn.' : ' Your action resolves first.'}`, armor };
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
  state.log = [NODES[state.encounter].enemyIntro, 'Your health and breath are restored. Read the enemy’s next move before choosing yours.'];
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
    state.ending = {
      title: 'Morning, together.',
      text: 'Oshn brought courage. Isha brought a song. Vadish opened his heart, and together they brought the morning back to Xenaland.',
      epilogue: state.memories.kept >= state.memories.released
        ? 'Oshn hangs her keepsakes above the workbench. Isha hums along as they sway. Outside, the loving wizard Vadish is teaching the village bells a brand-new song.'
        : 'Oshn leaves the workshop door open. Isha brings songs from the sea, and Vadish brings breakfast. None of them sings quite in tune. All of them sing anyway.',
      dedication: 'For the courage to change. For the love that lets the morning in.',
    };
  }
}

function endingStory(state) {
  return [
    line('Vadish', 'The wizard’s silver spell falls away. He kneels beside his staff. “I thought that if I held the world perfectly still, no one would ever have to lose someone again.”'),
    line('Oshn', 'You were trying to love them. You can still love them. Let them have a morning.'),
    line('Isha', 'And a terrible breakfast. And a beautiful mistake. Those are surprisingly important.'),
    line('Vadish', 'For the first time in seven years, the wizard laughs. He opens his hands. The magic that had bound the sea turns warm and golden. “Then let me help them begin.”'),
    line('The great bell', 'Vadish rises and gently offers his hand to Oshn. Isha settles on his staff. Together, the three climb into the bell’s heart, where the last note of morning waits.'),
    line('Vadish', '“For every person I tried to keep,” he says, “and every day I kept from them.” Oshn sets her tuning fork against the brass. Isha fills the hollow with his small, brave song.'),
    line('The morning returns', 'With Oshn and Isha beside him, Vadish takes the bell’s rope in both hands and rings it himself. Their notes become one. The sea falls like glittering rain. Across Xenaland, windows open and sleepers wake into the sunrise.'),
    line('Oshn', 'Mother does not come home. I cry, and Vadish sits quietly beside me. He does not try to stop the tears. Isha warms my hand. Love, I begin to understand, can stay without keeping anything still.'),
    line('A new morning', 'Later, the loving wizard opens the orchard gates and helps the people of Xenaland home. He mends a broken bridge, finds a lost cat, and burns the toast. Nobody has ever been so happy to make a mistake.'),
    line('Isha', 'I think I would like to see where the boats go.'),
    line('Oshn', 'I put on my coat. Vadish leaves the workshop door open for our return. Somewhere beyond the window, a bell begins to ring.'),
  ];
}


function winBattle(state) {
  state.battlesWon += 1;
  state.shards += 1;
  state.hero.hp = state.hero.maxHp;
  state.hero.energy = state.hero.maxEnergy;
  state.phase = 'reward';
  state.enemy.hp = 0;
  state.reward = {
    title: state.encounter === 5 ? 'A heart opens' : 'A note returned',
    text: state.encounter === 5 ? 'Vadish’s spell loosens. Beneath his fear, a loving heart is waiting to be heard.' : 'One more note joins the song. Your health and breath are fully restored.',
    upgrade: state.encounter === 1 || state.encounter === 3,
  };
  state.journal.push({ title: ENEMIES[state.encounter].name, text: `You freed ${ENEMIES[state.encounter].name.toLowerCase()} and recovered a note of morning.` });
  addLog(state, `${ENEMIES[state.encounter].name} is quiet. A note of morning is yours.`);
  state.effect = { kind: 'victory', text: 'A note returned', target: 'all' };
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
    addLog(state, `Oshn’s needle rings against the dark: ${damage} damage. +1 breath.`);
  } else if (id === 'chime') {
    damage = 20 + power(state);
    state.hero.energy -= 2;
    interrupted = intent.kind === 'heavy';
    addLog(state, `Bright chime deals ${damage} damage.${interrupted ? ` ${intent.name} is interrupted!` : ''}`);
  } else if (id === 'mend') {
    state.hero.energy -= 2;
    heal = 27 + (has(state, 'thread') ? 8 : 0);
    addLog(state, `Oshn stitches a little warmth into the world: +${Math.min(heal, state.hero.maxHp - state.hero.hp)} health.`);
  } else if (id === 'guard') {
    state.hero.energy += 2;
    guarded = true;
    addLog(state, 'Isha folds his wings around Oshn. Shelter reduces the next hit by 70%. +2 breath.');
  } else if (id === 'harmony') {
    damage = 35 + power(state) * 2;
    heal = 15 + (has(state, 'thread') ? 8 : 0);
    state.resonance = 0;
    addLog(state, `Moth & metal sing together: ${damage} damage and +${Math.min(heal, state.hero.maxHp - state.hero.hp)} health.`);
  }
  state.hero.hp = clamp(state.hero.hp + heal, 0, state.hero.maxHp);
  state.hero.energy = clamp(state.hero.energy, 0, state.hero.maxEnergy);
  if (id !== 'harmony') state.resonance = Math.min(3, state.resonance + 1);
  enemy.hp = Math.max(0, enemy.hp - damage);
  state.effect = { kind: id, text: damage ? `−${damage}` : heal ? `+${heal}` : 'Sheltered', target: damage ? 'enemy' : 'hero' };

  if (enemy.hp === 0) {
    if (enemy.special === 'boss' && enemy.bossPhase === 1) {
      enemy.bossPhase = 2;
      enemy.name = 'Vadish · Unbound';
      enemy.subtitle = 'A frightened heart beneath the spell';
      enemy.maxHp = 96;
      enemy.hp = 96;
      enemy.damage = 20;
      enemy.heavy = 44;
      enemy.heavyName = 'Unmaking the Dawn';
      state.hero.hp = Math.min(state.hero.maxHp, state.hero.hp + 24);
      state.hero.energy = Math.min(state.hero.maxEnergy, state.hero.energy + 2);
      state.turn = 1;
      enemy.intent = intentFor(state);
      addLog(state, 'The silver shell breaks. “If you wake them, they will grieve.” Vadish becomes a storm. Isha restores 24 health and 2 breath.');
      state.effect = { kind: 'transform', text: 'The silence breaks open', target: 'all' };
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
      if (absorbed) addLog(state, `The memory you released shelters you from ${absorbed} damage.`);
    }
    state.hero.hp = Math.max(0, state.hero.hp - incoming);
    addLog(state, `${enemy.name} uses ${intent.name}: ${incoming} damage${guarded ? ' after Shelter' : ''}.`);
    if (intent.kind === 'drain' && !guarded) {
      state.hero.energy = Math.max(0, state.hero.energy - 1);
      addLog(state, 'An echo carries away 1 breath.');
    }
    if (intent.kind === 'siphon' && !guarded) {
      enemy.hp = Math.min(enemy.maxHp, enemy.hp + 6);
      addLog(state, 'The roots recover 6 health. Shelter can prevent this.');
    }
  } else addLog(state, `${enemy.name} loses its turn. The heavy attack dissolves into sparks.`);

  if (state.hero.hp === 0) {
    state.phase = 'defeat';
    state.effect = { kind: 'defeat', text: 'Even a small light can begin again', target: 'hero' };
    addLog(state, 'Isha catches the loose thread. Your progress and choices are safe.');
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
    return [{ id: 'next', label: state.storyIndex === state.story.length - 1 ? 'Continue' : 'Listen', description: '', kind: 'story' }];
  }
  if (state.phase === 'explore') {
    const choices = [];
    if (!state.explored) choices.push({ id: 'investigate', label: NODES[state.encounter].memoryTitle, description: 'Find a memory. Choose how to carry it, and gain a gift for the coming battle.', kind: 'memory' });
    choices.push({ id: 'travel', label: state.encounter === 5 ? 'Approach the great bell' : 'Follow the next note', description: `${state.explored ? '' : 'You may leave this memory behind. ' }Face ${ENEMIES[state.encounter].name}. Health and breath are restored before battle.`, kind: 'travel' });
    return choices;
  }
  if (state.phase === 'battle') {
    const extra = power(state);
    return [
      { ...ABILITIES.strike, description: `${12 + extra} damage. Gain 1 breath and 1 resonance.` },
      { ...ABILITIES.chime, description: `${20 + extra} damage · 2 breath. Interrupts a heavy attack.`, disabled: state.hero.energy < 2 },
      { ...ABILITIES.mend, description: `Restore ${27 + (has(state, 'thread') ? 8 : 0)} health · 2 breath. Gain 1 resonance.`, disabled: state.hero.energy < 2 || state.hero.hp === state.hero.maxHp },
      { ...ABILITIES.guard, description: 'Take 70% less damage. Gain 2 breath and 1 resonance.' },
      { ...ABILITIES.harmony, description: `${35 + extra * 2} damage + ${15 + (has(state, 'thread') ? 8 : 0)} health · 3 resonance.`, disabled: state.resonance < 3 },
    ];
  }
  if (state.phase === 'reward') {
    if (state.reward.upgrade) {
      return [
        { id: 'upgrade-heart', label: 'A wider heart', description: '+20 maximum health, permanently.', kind: 'upgrade', disabled: has(state, 'heart') },
        { id: 'upgrade-voice', label: 'A clearer voice', description: '+3 Needle strike and Bright chime damage; +6 Moth & metal damage.', kind: 'upgrade', disabled: has(state, 'voice') },
        { id: 'upgrade-thread', label: 'A stronger thread', description: '+8 healing from Mend and Moth & metal. Begin battles with 1 resonance.', kind: 'upgrade', disabled: has(state, 'thread') },
      ];
    }
    return [{ id: 'continue', label: state.encounter === 5 ? 'Ring the bell together' : 'Carry the note onward', description: state.encounter === 5 ? 'Join Vadish and Isha. Let the morning come.' : 'The road continues.', kind: 'continue' }];
  }
  if (state.phase === 'defeat') return [{ id: 'retry', label: 'Pick up the thread', description: 'Retry this battle with full health and breath. All story progress is kept.', kind: 'retry' }];
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
    version: VERSION, difficulty: difficulty === 'story' ? 'story' : 'normal',
    phase: 'story', chapter: 0, encounter: 0, story: OPENING, storyIndex: 0,
    storyAfter: 'explore', storyChoices: null,
    hero: { name: 'Oshn', hp: maxHp, maxHp, energy: 5, maxEnergy: 5 },
    companion: { name: 'Isha', description: 'A paper moth with an unfinished wish.' },
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
      setStory(state, [line('A small choice', text), line('The gift of remembering', kept ? 'A warm note settles in your tuning fork. This battle, Needle strike and Bright chime deal 2 extra damage, and Moth & metal deals 4 extra.' : 'A silver thread follows you. This battle, it will absorb the first 14 damage you take.')], 'explore');
      state.effect = { kind: 'memory', text: kept ? 'Courage remembered' : 'A sheltering thread', target: 'all' };
    }
  } else if (state.phase === 'explore') {
    if (id === 'investigate') {
      const node = NODES[state.encounter];
      setStory(state, node.memory, 'explore', [
        { id: 'choice-keep', label: node.choices[0], description: 'Carry it with you. Gain +2 strike and chime damage, +4 harmony damage this battle.', kind: 'choice' },
        { id: 'choice-release', label: node.choices[1], description: 'Let it change. Gain a shield that absorbs the first 14 damage this battle.', kind: 'choice' },
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
      if (state.encounter === 5) setStory(state, endingStory(state), 'ending');
      else setStory(state, AFTER_BATTLES[state.encounter], 'next-encounter');
    }
  } else if (state.phase === 'defeat' && id === 'retry') {
    state.resonance = 0;
    beginBattle(state);
    addLog(state, 'A fresh beginning. Chime interrupts heavy attacks; Shelter buys breath; Moth & metal heals while dealing damage.');
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
