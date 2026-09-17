/**
 * Early-reader story copy for The Last Bell of Xenaland.
 * Original story. Oshn is a seven-year-old boy; Isha is his sister.
 * Isha's moth form is temporary magic. Their mother is alive and well.
 * ENDING_STORY[5] is the exact bell-ringing event (zero-based index).
 * Optional ENEMY_COPY names below map to the existing six encounter slots.
 * This module contains story copy only; it does not change game mechanics.
 */

const line = (speaker, text) => ({ speaker, text });

export const CHAPTERS = [
  {
    title: 'I · Across the Water',
    location: 'The Blue Stone Path',
    description: 'The storm has passed. Two bright notes wait by the water.',
    theme: 'shore',
  },
  {
    title: 'II · The Shiny Garden',
    location: 'The Glass Orchard',
    description: 'The trees shine like glass. Two more notes wait in the garden.',
    theme: 'orchard',
  },
  {
    title: 'III · Wake Up, Morning!',
    location: 'The Great Bell',
    description: 'Two notes left to find! Oshn and Isha climb the bell tower.',
    theme: 'tower',
  },
];

export const NODES = [
  {
    title: 'The Blue Stone Path',
    description: 'Blue stones make a path beside the sea. A shiny brass bird sits on the gate.',
    memoryTitle: 'A loaf of bread',
    memory: [
      line('Oshn', 'Mom packed bread in my bag. There is enough for a picnic!'),
      line('Isha', 'The little fish look hungry, too. One fish is making a very silly face.'),
    ],
    choices: ['Save bread for our picnic', 'Give crumbs to the fish'],
    kept: 'Oshn wraps the bread for a picnic. Thinking of lunch gives him a happy boost.',
    released: 'Oshn feeds the fish. The fish make a ring of bubbles to help keep him safe.',
    enemyIntro: 'The Brass Bird flaps its wings. The spell has mixed up its song. Help the bird find the right tune!',
  },
  {
    title: 'The Little Boat Dock',
    description: 'A little boat bobs by the dock. Soft voices sing under the water.',
    memoryTitle: 'A boat map',
    memory: [
      line('Oshn', 'Here is a map of the river. The garden is just across the water!'),
      line('Isha', 'We could take the map with us. Or hang it here to help other boats.'),
    ],
    choices: ['Take the map with us', 'Hang the map by the dock'],
    kept: 'Oshn puts the map in his bag. Knowing the way helps him feel brave.',
    released: 'Oshn hangs the map by the dock. The river sends a soft wave to help keep him safe.',
    enemyIntro: 'The River Singers hum the same sleepy note. Play a bright tune to help them sing again!',
  },
  {
    title: 'The Shiny Apple Trees',
    description: 'The trees shine like glass. Big red apples hang from their branches.',
    memoryTitle: 'A red apple',
    memory: [
      line('Isha', 'Can a moth eat an apple? I hope I still like snacks!'),
      line('Oshn', 'Let us try a tiny slice. We can save the rest or share with the birds.'),
    ],
    choices: ['Save some apple for later', 'Share the apple with birds'],
    kept: 'Isha nibbles a tiny slice. Oshn saves the rest, and the sweet snack makes him smile.',
    released: 'Oshn shares the apple with the birds. Soft feathers float down to help keep him safe.',
    enemyIntro: 'The Glass Heron hops across the path. Its shiny wings are full of sleepy magic. Help the heron wake up!',
  },
  {
    title: 'The Garden Gate',
    description: 'Green vines curl around the gate. A tall garden guard is taking a very long nap.',
    memoryTitle: 'A little seed',
    memory: [
      line('Oshn', 'I found a seed in this pot. What do you think will grow?'),
      line('Isha', 'A flower or a bean? I hope it is a pancake tree.'),
    ],
    choices: ['Save the seed for home', 'Plant the seed in the pot'],
    kept: 'Oshn saves the seed for their garden. He grins as he thinks of a pancake tree.',
    released: 'Oshn plants the seed. A green leaf pops up and makes a soft shield for him.',
    enemyIntro: 'The Garden Guard wakes with a yawn. Vines wiggle across the path. A bright song can loosen the spell!',
  },
  {
    title: 'The Bell Tower Steps',
    description: 'Wide steps curl up the bell tower. Small white clouds rest on the rails.',
    memoryTitle: 'Mom’s bright ribbon',
    memory: [
      line('Oshn', 'Mom tied this ribbon on my bag. Bright colors help us find things.'),
      line('Isha', 'We can use it to hold our notes. Or mark the steps for our friends.'),
    ],
    choices: ['Tie the ribbon around our notes', 'Tie the ribbon on the rail'],
    kept: 'Oshn ties the ribbon around their four notes. The bright bow gives him a brave feeling.',
    released: 'Oshn ties the ribbon on the rail. A soft breeze curls around him like a shield.',
    enemyIntro: 'A Cloud Guard bounces onto the steps. Sleepy sparks puff from its hat. Help the guard clear the way!',
  },
  {
    title: 'Beside the Great Bell',
    description: 'Vadish stands beside the great bell. His silver sleep spell curls around the rope.',
    memoryTitle: 'Our family song',
    memory: [
      line('Oshn', 'Mom sings this song at breakfast. I like the funny bit about toast.'),
      line('Isha', 'Sing it now, Oshn. I will hum the wobbly part!'),
    ],
    choices: ['Save a verse to sing at home', 'Sing a verse for Vadish'],
    kept: 'Oshn saves one funny verse for Mom. Thinking of home makes his little bell stronger.',
    released: 'Oshn and Isha sing for Vadish. Their gentle tune makes a soft shield around Oshn.',
    enemyIntro: 'Vadish taps his staff. His sleep spell swirls around the bell. A bright song can break the spell!',
  },
];

export const OPENING = [
  line('Meet Oshn', 'This is Oshn. He is a seven-year-old boy who loves songs and little bells.'),
  line('Last night', 'A storm shook Xenaland last night. Vadish the wizard cast a sleep spell to help the town rest.'),
  line('Oshn', 'The storm is gone, but our town still sleeps. Even Mom is snoring!'),
  line('Isha', 'Oshn, it is me, your sister Isha! The spell turned me into a moth.'),
  line('Oshn', 'We will fix this, Isha. First, please stop tickling my nose.'),
  line('Isha', 'Six song notes will wake the great bell. Let us find the notes and ask Vadish for help.'),
  line('The path ahead', 'The spell has mixed up the guards. Oshn and Isha can help with their bright song.'),
  line('Oshn', 'I have my bell, and you have wings. Let us bring back morning!'),
];

export const AFTER_BATTLES = [
  [
    line('The Brass Bird', 'The sleepy sparks pop away. The Brass Bird sings one clear note.'),
    line('Isha', 'Our first note! That bird has a good voice.'),
    line('Oshn', 'Thanks, Brass Bird! We will bring your song to the great bell.'),
  ],
  [
    line('The River Singers', 'The River Singers find their happy tune. A second note floats into Oshn’s hand.'),
    line('Isha', 'We have two notes now! Hop in the boat, Oshn, and I will be the captain.'),
    line('Oshn', 'You can be the captain. Please point us toward the garden, not the snacks.'),
  ],
  [
    line('The Glass Heron', 'The Glass Heron shakes its shiny wings. The third note lands beside Oshn.'),
    line('Oshn', 'Three notes! We are halfway there, Isha.'),
    line('Isha', 'Well done, brother! Now let us find the garden gate.'),
  ],
  [
    line('The Garden Guard', 'The guard stretches and smiles. A fourth note shines on a leaf.'),
    line('Oshn', 'Good morning, Garden Guard! Well, nearly morning.'),
    line('Isha', 'Four notes, and the gate is open! Next stop, the bell tower!'),
  ],
  [
    line('The Cloud Guard', 'The Cloud Guard gives a happy puff. The fifth note floats down like a snowflake.'),
    line('Oshn', 'Five notes! We only need one more.'),
    line('Isha', 'There is Vadish beside the bell. Come on, Oshn, we can help him too!'),
  ],
];

export const ENDING_STORY = [
  line('The last note', 'The last sleepy spell pops like a bubble. Oshn catches the sixth note.'),
  line('Vadish', 'I wanted the town to rest. I am sorry I kept the sleep spell on too long.'),
  line('Oshn', 'The storm has passed, Vadish. You can help us wake the town now.'),
  line('A kind choice', 'Vadish smiles with love in his heart. He thanks Oshn and gently lifts Isha onto his hand.'),
  line('Isha', 'Oshn, play our six notes on your bell. Vadish, please ring the bell!'),
  line('DING! The great bell', 'Oshn and Isha stand beside Vadish. The wizard pulls the rope himself, and morning shines across Xenaland.'),
  line('Isha', 'My wings are gone, and I am a girl again. Come here, little brother!'),
  line('Mom', 'Welcome home, Oshn and Isha! Vadish, come in too, and have some warm pancakes with us.'),
  line('A happy morning', 'Vadish serves pancakes with a loving smile. Oshn, Isha, and the sleepy cat sing their family song.'),
];

export function endingSummary(state) {
  const kept = Number(state?.memories?.kept) || 0;
  const shared = Number(state?.memories?.released) || 0;
  return {
    title: 'Good morning, Xenaland!',
    text: 'Oshn and Isha found six notes. Vadish rang the great bell. Everyone is awake, and Mom has made pancakes!',
    epilogue: kept >= shared
      ? 'Oshn puts a little bell by his bed. Isha helps him ring it each morning. Vadish brings the pancakes.'
      : 'Oshn and Isha share songs all over town. Vadish shares pancakes. There is enough happiness for everyone.',
    dedication: 'For brothers, sisters, and friends who help each other.',
  };
}

// Optional display-copy replacements, in the unchanged encounter order.
export const ENEMY_COPY = [
  { name: 'Brass Bird', subtitle: 'A shiny bird with a mixed-up song', heavyName: 'Big Wing Flap' },
  { name: 'River Singers', subtitle: 'Sleepy singers who need a new tune', heavyName: 'Big River Wave' },
  { name: 'Glass Heron', subtitle: 'A shiny bird with sleepy wings', heavyName: 'Shiny Wing Flap' },
  { name: 'Garden Guard', subtitle: 'A friendly guard under a sleepy spell', heavyName: 'Big Vine Hug' },
  { name: 'Cloud Guard', subtitle: 'A bouncy guard with a puffy hat', heavyName: 'Great Big Puff' },
  { name: 'Vadish', subtitle: 'A wizard with a sleep spell to fix', heavyName: 'Big Sleepy Swirl' },
];

export const RING_INDEX = 5;
export const GIRL_INDEX = 6;
