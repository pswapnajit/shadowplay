/**
 * The Lantern's understudy: a small hand-written storyteller that takes over
 * when the network or the story server isn't available. It speaks the same
 * protocol (beats of narration, cues and actions, then an ask or the end), so
 * the theatre can't tell the difference, and it still bends the tale around
 * whatever the player actually makes.
 */

import { CAST, type Beat, type CreatureId, type Cue, type Ending, type Keepsake, moonOf, type Next, type Step, type StoryEvent, teaser, TEASERS } from './protocol.js';

const NAME: Record<CreatureId, string> = {
  bird: 'the Chatterbird',
  rabbit: 'the rabbit',
  dog: 'the dog',
  wolf: 'the wolf',
  fox: 'the fox',
  swan: 'the swan',
  crocodile: 'the crocodile',
  deer: 'the deer',
  butterfly: 'the butterfly',
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const titled = (id: CreatureId) => NAME[id].replace(/\b\w/g, (c) => c.toUpperCase());

const ARRIVE: Record<CreatureId, string> = {
  bird: 'Out of the hedge tumbled the Chatterbird, talking before she had even landed.',
  rabbit: 'A rabbit came racing through the long grass, ears first, as rabbits do.',
  dog: 'A dog trotted up, tail going like a windmill, saying hello to absolutely everything.',
  wolf: 'Down from the hilltop came the wolf, slow and silver, nose lifted to the sky.',
  fox: 'A fox slipped out of the shadows, looking very pleased with himself about something.',
  swan: 'Along the dark water glided a swan, as if the river had been saving a place for her.',
  crocodile: 'Up from the reeds rose a crocodile, grumbling that some of us were trying to sleep.',
  deer: 'Between the trees stood a deer, as still and careful as a held breath.',
  butterfly: 'A butterfly, far too late for butterflies, came fluttering into the light.',
};
const SOUND: Record<CreatureId, string> = {
  bird: 'chattered',
  rabbit: 'thumped a foot',
  dog: 'barked',
  wolf: 'howled',
  fox: 'yipped',
  swan: 'called',
  crocodile: 'snapped',
  deer: 'called softly',
  butterfly: 'fluttered',
};

interface Setting {
  lines: string[];
  cue: Cue;
  prompt: string;
}
const SETTINGS: Setting[] = [
  {
    lines: ['The village by the river had gone to sleep, every window dark but one.', 'Even the river was whispering, so as not to wake anybody.'],
    cue: 'night',
    prompt: 'Who was still awake?',
  },
  {
    lines: ['At the edge of the pine wood, the moon was late, and the trees were waiting.', 'Then, at last, it came up over the hill, round and a little embarrassed.'],
    cue: 'moon',
    prompt: 'Who came out to see it?',
  },
  {
    lines: ['On the hill above the sea, the wind dropped, and the stars came out to listen.', 'Somebody down below was about to have an adventure.'],
    cue: 'stars',
    prompt: 'Who was it?',
  },
  {
    lines: ['In a garden behind a sleeping house, the roses had closed and the frogs had gone quiet.', 'Only the fireflies were still out, lighting their tiny lamps.'],
    cue: 'fireflies',
    prompt: 'Who followed the fireflies?',
  },
];

/** The understudy's tales. Their order matches TEASERS, the promises it makes for them. */
interface Quest {
  problem: string;
  goal: string;
  title: string;
  ending: string;
  summary: string;
  keepsake: Keepsake;
}
const QUESTS: Quest[] = [
  {
    problem: "{L} had lost the moon's reflection. It had been in the pond at supper, and now the pond was empty.",
    goal: "find the moon's reflection",
    title: '{L} and the Missing Moon',
    ending: 'There it was, in the very last puddle on the road, shining up at them as if nothing had happened.',
    summary: "{L} and friends searched all night for the moon's lost reflection and found it in the last puddle on the road.",
    keepsake: 'moon',
  },
  {
    problem: '{L} had found a fallen star in the grass, still warm, and it was getting dimmer.',
    goal: 'carry the star home',
    title: '{L} and the Fallen Star',
    ending: 'At the top of the hill they let it go, and the star climbed back into the sky, blinking thank you.',
    summary: '{L} found a fallen star and, with some help, carried it up the hill until it could climb back into the sky.',
    keepsake: 'star',
  },
  {
    problem: '{L} wanted to see the sea before morning, but nobody knew the way.',
    goal: 'reach the sea',
    title: '{L} Goes to the Sea',
    ending: 'Just as the sky turned pink, they heard it: the sea, breathing in and out, like someone fast asleep.',
    summary: '{L} set out to see the sea before morning and arrived, with friends, just as the sun came up.',
    keepsake: 'shell',
  },
  {
    problem: "{L} couldn't sleep, because somewhere, somebody was crying very softly.",
    goal: 'find who was crying',
    title: '{L} and the Small Sad Sound',
    ending: 'It was only the old windmill, lonely on its hill. They sat with it until it creaked a happy creak.',
    summary: '{L} followed a small sad sound through the night and found a lonely old windmill that needed company.',
    keepsake: 'bell',
  },
];

/** On full-moon nights the old friends of the theatre come back. */
const FULL_MOON: Setting = {
  lines: ['The moon was full tonight, and on full-moon nights, everyone comes back.', 'One by one, the old friends of the theatre began to arrive.'],
  cue: 'moon',
  prompt: 'Who came first?',
};

const WEATHER: { cue: Cue; line: string }[] = [
  { cue: 'rain', line: 'Then the sky grumbled, and the rain came down in long silver threads.' },
  { cue: 'snow', line: 'Then the air went very still, and the first snow began to fall, quiet as a secret.' },
  { cue: 'thunder', line: 'Then thunder rolled over the hills, and lightning lit up everything at once.' },
];

const say = (s: string): Step => ({ say: s });

export class OfflineTeller {
  private rnd: () => number;
  private setting: Setting;
  private quest: Quest;
  private weather: { cue: Cue; line: string };
  private lead: CreatureId | null = null;
  private cast: CreatureId[] = [];
  private known: CreatureId[] = [];
  private asks = 0;
  private questNo: number;
  private oneHand = false;
  private fullMoon = false;
  /** Tonight keeps last night's promise: this creature leads the promised tale. */
  private promised: CreatureId | null = null;

  constructor(seed = Date.now()) {
    let s = seed >>> 0 || 1;
    this.rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    this.setting = this.pick(SETTINGS);
    this.questNo = Math.floor(this.rnd() * QUESTS.length);
    this.quest = QUESTS[this.questNo];
    this.weather = this.pick(WEATHER);
  }

  private pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.rnd() * xs.length)];
  }

  private fill(s: string): string {
    const L = this.lead ? NAME[this.lead] : 'the night';
    return s.replace(/\{L\}/g, s.startsWith('{L}') ? cap(L) : L);
  }

  /** A creature to ask for: someone the player knows who isn't on stage yet, or an easy newcomer. */
  private wish(prefer: 'known' | 'new'): CreatureId {
    const offstage = (id: CreatureId) => !this.cast.includes(id);
    const known = this.known.filter(offstage);
    const fresh = (Object.keys(CAST) as CreatureId[]).filter((id) => offstage(id) && !this.known.includes(id) && CAST[id].difficulty < 3);
    const fits = (id: CreatureId) => !this.oneHand || CAST[id].hands === 1;
    const pool = (prefer === 'new' && !this.fullMoon ? (fresh.length ? fresh : known) : known.length ? known : fresh).filter(fits);
    return pool.length ? this.pick(pool) : 'rabbit';
  }

  /** The end of the tale: its title, a keepsake, and a promise for tomorrow night. */
  private ending(): Ending {
    const lead = this.lead ?? 'rabbit';
    const others = TEASERS.map((_, i) => i).filter((i) => i !== this.questNo);
    const quest = others[Math.floor(this.rnd() * others.length)];
    // Tomorrow's lead: one of tonight's friends, so the next tale picks up a thread.
    const friends = this.cast.filter((id) => id !== lead);
    const who = friends.length ? this.pick(friends) : lead;
    return {
      end: this.quest.title.replace('{L}', titled(lead)),
      summary: this.fill(this.quest.summary),
      keepsake: this.quest.keepsake,
      tomorrow: teaser(quest, who),
      plan: { quest, who },
    };
  }

  /** The beat answering the latest event. `events[0]` must be the opening. */
  beat(events: StoryEvent[]): Beat {
    const e = events[events.length - 1];
    if (e.type === 'open') {
      this.known = e.known;
      this.oneHand = e.hands === 1;
      this.fullMoon = !!e.night && moonOf(e.night).phase === 'full';
      if (this.fullMoon) this.setting = FULL_MOON;
      if (e.keep && e.keep !== 'last') {
        // Last night's promise: that tale, led by that creature.
        this.questNo = e.keep.quest;
        this.quest = QUESTS[this.questNo];
        this.promised = e.keep.who;
        return {
          script: [say(`Last time, I promised you a story about ${NAME[e.keep.who]}. Here it is.`), say(this.setting.lines[0]), { cue: this.setting.cue }],
          next: { ask: e.keep.who, prompt: `Where was ${NAME[e.keep.who]}?` },
        };
      }
      return { script: [say(this.setting.lines[0]), { cue: this.setting.cue }, say(this.setting.lines[1])], next: { ask: 'any', prompt: this.setting.prompt } };
    }
    this.asks++;
    const script: Step[] = [];
    let arrived: CreatureId | null = null;
    if (e.type === 'made') {
      arrived = e.made;
      if (e.friend) script.push(say(`From the far side of the wall, where the other lantern burns, came ${NAME[e.made]}.`));
      else if (e.asked !== 'any' && e.asked !== e.made) script.push(say(`You might have expected ${NAME[e.asked]}. Instead, here came ${NAME[e.made]}!`));
      else if (e.helped || e.seconds > 30) script.push(say(`It took a little coaxing, but at last ${NAME[e.made]} came.`));
      script.push(say(this.cast.includes(e.made) ? `Back came ${NAME[e.made]}, who had never really gone far.` : ARRIVE[e.made]));
      if (e.calls > 1) script.push(say(`${cap(NAME[e.made])} ${SOUND[e.made]}, twice, just to be sure everyone had noticed.`));
      if (!this.cast.includes(e.made)) this.cast.push(e.made);
    } else {
      script.push(say(this.lead ? `Nobody came. ${cap(NAME[this.lead])} waited, then decided to be brave alone.` : 'Nobody came. The night held its breath a little longer.'));
    }

    if (!this.lead) {
      if (!arrived) return { script, next: { ask: 'any', prompt: 'Who finally answered?' } };
      this.lead = arrived;
      script.push(say(this.fill(this.quest.problem)));
      const helper = this.wish('known');
      return { script, next: { ask: helper, prompt: 'Who came to help?' } };
    }
    const L = cap(NAME[this.lead]);
    if (this.asks <= 2) {
      script.push(say(`Together, they set off to ${this.quest.goal}.`), { who: this.lead, does: 'walk' }, { cue: 'wind' });
      return { script, next: { ask: 'any', prompt: 'Who did they meet on the way?' } };
    }
    if (this.asks === 3) {
      script.push(say(this.weather.line), { cue: this.weather.cue }, say(`${L} was a little frightened, and pretended not to be.`), { who: this.lead, does: 'hide' });
      return { script, next: { ask: this.wish('new'), prompt: 'Who knew the way through?' } };
    }
    // The ending.
    const finale: Step[] = [{ cue: 'calm' }, say(this.quest.ending), { cue: 'dawn' }];
    if (this.fullMoon) {
      finale.push(say('And because the moon was full, everybody danced until the sky went pink.'));
      for (const id of this.cast) finale.push({ who: id, does: 'dance' });
    }
    for (const id of this.cast) finale.push({ who: id, does: 'bow' });
    finale.push(say('And everyone went home to bed, except the Lantern, who stayed up to remember it all.'));
    return { script: [...script, ...finale], next: this.ending() };
  }

  /**
   * Takes over a story the Lantern started: replays the earlier events so the
   * lead and the cast carry over, then answers the latest one.
   */
  takeOver(events: StoryEvent[]): Beat {
    for (let i = 1; i < events.length; i++) this.beat(events.slice(0, i));
    return this.beat(events);
  }

  /** The ask (or ending) after a beat whose storyteller went quiet halfway through. */
  bridge(events: StoryEvent[]): Next {
    for (let i = 1; i <= events.length; i++) this.beat(events.slice(0, i));
    if (this.asks >= 3 && this.lead) return this.ending();
    return { ask: 'any', prompt: 'Who came next?' };
  }
}
