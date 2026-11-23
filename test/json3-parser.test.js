const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/core/text-utils.js');
require('../src/core/rolling-merger.js');
require('../src/core/json3-parser.js');
require('../src/core/cue-lookup.js');

const { Json3Parser } = globalThis.YTSC;
const { cueAtTime } = globalThis.YTSC;

test('word-level events merge into phrase cues and keep real end times', () => {
  const cues = new Json3Parser().parse({
    events: [
      { tStartMs: 0, dDurationMs: 700, segs: [{ utf8: 'Wir ' }] },
      { tStartMs: 700, dDurationMs: 700, segs: [{ utf8: 'sprechen ' }] },
      { tStartMs: 1300, dDurationMs: 800, segs: [{ utf8: 'Deutsch.' }] },
      { tStartMs: 2500, dDurationMs: 1000, segs: [{ utf8: 'Danach.' }] },
    ],
  });
  assert.deepEqual(cues, [
    { startMs: 0, endMs: 2100, text: 'Wir sprechen Deutsch.', index: 0 },
    { startMs: 2500, endMs: 3500, text: 'Danach.', index: 1 },
  ]);
  assert.equal(cueAtTime(cues, 0)?.text, 'Wir sprechen Deutsch.');
  assert.equal(cueAtTime(cues, 2099)?.index, 0);
  assert.equal(cueAtTime(cues, 2100), null);
  assert.equal(cueAtTime(cues, 2500)?.index, 1);
  assert.equal(cueAtTime(cues, 3500), null);
});

test('events without durations infer an end from the next cue', () => {
  const cues = new Json3Parser().parse({
    events: [
      { tStartMs: 1000, segs: [{ utf8: 'Hallo ' }] },
      { tStartMs: 2000, segs: [{ utf8: 'Welt' }] },
    ],
  });
  assert.equal(cues[0].text, 'Hallo Welt');
  assert.equal(cues[0].startMs, 1000);
  assert.equal(cues[0].endMs, 3800);
  assert.equal(cueAtTime(cues, 3799)?.text, 'Hallo Welt');
  assert.equal(cueAtTime(cues, 3800), null);
});

test('empty and malformed caption events are ignored', () => {
  const parser = new Json3Parser();
  assert.deepEqual(parser.parse({ events: [] }), []);
  assert.deepEqual(parser.parse({ events: [{ tStartMs: 10, segs: [{ utf8: '  ' }] }] }), []);
  assert.deepEqual(parser.parse({}), []);
});

test('rolling ASR windows replace prefixes instead of duplicating words', () => {
  const cues = new Json3Parser().parse({
    events: [
      { tStartMs: 0, dDurationMs: 900, segs: [{ utf8: 'Was' }] },
      { tStartMs: 500, dDurationMs: 900, segs: [{ utf8: 'Was bedeutet' }] },
      { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: 'Was bedeutet dieses Wort?' }] },
    ],
  });
  assert.equal(cues.length, 1);
  assert.equal(cues[0].text, 'Was bedeutet dieses Wort?');
  assert.equal(cues[0].text.includes('Was Was'), false);
});

test('aAppend events merge by overlap without repeating shared words', () => {
  const cues = new Json3Parser().parse({
    events: [
      { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Wir lernen' }] },
      { tStartMs: 800, dDurationMs: 1200, aAppend: 1, segs: [{ utf8: 'lernen Deutsch.' }] },
    ],
  });
  assert.equal(cues.length, 1);
  assert.equal(cues[0].text, 'Wir lernen Deutsch.');
});

test('rollup rows become stable two-line cues instead of one giant cue', () => {
  const cues = new Json3Parser().parse({
    events: [
      { tStartMs: 0, dDurationMs: 1180400, wWinId: 0 },
      { tStartMs: 480, dDurationMs: 5720, wWinId: 1, segs: [{ utf8: 'Liebe Freunde der Sonne, herzlich' }] },
      { tStartMs: 3629, dDurationMs: 2571, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] },
      { tStartMs: 3639, dDurationMs: 5201, wWinId: 1, segs: [{ utf8: 'willkommen zu einem neuen Video. Wir' }] },
      { tStartMs: 6190, dDurationMs: 2650, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] },
      { tStartMs: 6200, dDurationMs: 5280, wWinId: 1, segs: [{ utf8: 'wollen heute über das Wort erst' }] },
      { tStartMs: 8830, dDurationMs: 2650, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] },
      { tStartMs: 8840, dDurationMs: 5120, wWinId: 1, segs: [{ utf8: 'sprechen. Was bedeutet dieses Wort? In' }] },
      { tStartMs: 11470, dDurationMs: 2490, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] },
      { tStartMs: 11480, dDurationMs: 5639, wWinId: 1, segs: [{ utf8: 'welchen Kontexten benutzen wir das?' }] },
      { tStartMs: 13950, dDurationMs: 3169, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] },
      { tStartMs: 13960, dDurationMs: 5520, wWinId: 1, segs: [{ utf8: 'Diese Fragen werde ich euch heute in' }] },
      { tStartMs: 17109, dDurationMs: 2371, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] },
      { tStartMs: 17119, dDurationMs: 7721, wWinId: 1, segs: [{ utf8: 'diesem Video beantworten und wir' }] },
      { tStartMs: 19470, dDurationMs: 5370, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] },
      { tStartMs: 19480, dDurationMs: 5360, wWinId: 1, segs: [{ utf8: 'benutzen dafür natürlich unsere Fantasie' }] },
      { tStartMs: 25230, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] },
      { tStartMs: 25240, dDurationMs: 6160, wWinId: 1, segs: [{ utf8: 'Fantasie an. [räuspern]' }] },
      { tStartMs: 28710, dDurationMs: 2690, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] },
      { tStartMs: 28720, dDurationMs: 4999, wWinId: 1, segs: [{ utf8: 'Und bevor es losgeht, möchte ich mich' }] },
    ],
  });

  assert.equal(cues.length, 5);
  assert.deepEqual(cues[3], {
    startMs: 17119,
    endMs: 25240,
    text: 'diesem Video beantworten und wir benutzen dafür natürlich unsere Fantasie',
    index: 3,
  });
  assert.equal(cues[4].text, 'Fantasie an. [räuspern] Und bevor es losgeht, möchte ich mich');
  assert.equal(cueAtTime(cues, 20000)?.index, 3);
  assert.equal(cueAtTime(cues, 26000)?.index, 4);
});

test('parseWords folds punctuation segs into the neighbouring word', () => {
  const words = new Json3Parser().parseWords({
    events: [
      {
        tStartMs: 0,
        dDurationMs: 2000,
        segs: [
          { utf8: 'hello' },
          { utf8: ' ,', tOffsetMs: 300 },
          { utf8: ' world', tOffsetMs: 400 },
          { utf8: ' !', tOffsetMs: 800 },
        ],
      },
    ],
  });
  assert.deepEqual(
    words.map((w) => [w.text, w.startMs, w.endMs]),
    [['hello,', 0, 300], ['world!', 400, 800]]
  );
});

test('parseWords drops a repeated window even when its punctuation segs split differently', () => {
  const words = new Json3Parser().parseWords({
    events: [
      { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'hello ,' }, { utf8: ' world', tOffsetMs: 400 }] },
      {
        tStartMs: 1000,
        dDurationMs: 1000,
        segs: [
          { utf8: 'hello' },
          { utf8: ' ,', tOffsetMs: 100 },
          { utf8: ' world', tOffsetMs: 200 },
          { utf8: ' again', tOffsetMs: 400 },
        ],
      },
    ],
  });
  assert.deepEqual(words.map((w) => w.text), ['hello,', 'world', 'again']);
  assert.equal(words[2].startMs, 1400);
});

test('parseWords keeps word order when untimed two-line ASR blocks overlap the next block', () => {
  // YouTube ASR (Nov 2026): one seg per two-line block, no word offsets, and
  // each block stays up seconds after the next one starts.
  const words = new Json3Parser().parseWords({
    events: [
      { tStartMs: 0, id: 1, wpWinPosId: 2, wsWinStyleId: 1 },
      {
        tStartMs: 2879,
        dDurationMs: 6401,
        wWinId: 1,
        segs: [{ utf8: 'So Oliver, we\'re recording a video right\nnow just a day or two before the release', acAsrConf: 0 }],
      },
      {
        tStartMs: 7520,
        dDurationMs: 4880,
        wWinId: 1,
        segs: [{ utf8: 'of Grand Theft Auto 6. We\'ve been\nplaying it. We have a lot of opinions to', acAsrConf: 0 }],
      },
      {
        tStartMs: 11280,
        dDurationMs: 5200,
        wWinId: 1,
        segs: [{ utf8: 'share today, which we\'re going to get\ninto, but I wanted to ask you first,', acAsrConf: 0 }],
      },
    ],
  });
  assert.equal(
    words.map((w) => w.text).join(' '),
    'So Oliver, we\'re recording a video right now just a day or two before the release ' +
      'of Grand Theft Auto 6. We\'ve been playing it. We have a lot of opinions to ' +
      'share today, which we\'re going to get into, but I wanted to ask you first,'
  );
  const release = words.find((w) => w.text === 'release');
  assert.ok(release.endMs <= 7520, 'a block\'s words end before the next block starts');
  assert.equal(words.find((w) => w.text === 'of').startMs, 7520);
  assert.ok(words.every((w) => !w.lineBreak), 'formatted newlines are not kept as lines');
});

test('an untimed block runs until the next block says a word, not until it starts', () => {
  const words = new Json3Parser().parseWords({
    events: [
      { tStartMs: 0, dDurationMs: 2400, segs: [{ utf8: 'first cue here\nsecond line' }] },
      { tStartMs: 500, dDurationMs: 3000, segs: [{ utf8: 'later', tOffsetMs: 2500 }, { utf8: ' words', tOffsetMs: 2800 }] },
    ],
  });
  assert.equal(words.find((w) => w.text === 'line').endMs, 2400);
  assert.equal(words.find((w) => w.text === 'later').startMs, 3000);
});

test('a repeated window does not cut the block it repeats short', () => {
  const line = 'a lyric line here\nand another one';
  const words = new Json3Parser().parseWords({
    events: [
      { tStartMs: 0, dDurationMs: 4000, segs: [{ utf8: line }] },
      { tStartMs: 500, dDurationMs: 3500, segs: [{ utf8: line }] },
    ],
  });
  assert.deepEqual(words.map((w) => w.text), ['a', 'lyric', 'line', 'here', 'and', 'another', 'one']);
  assert.equal(words.at(-1).endMs, 4000);
});

test('a block in another caption window does not cut an untimed block short', () => {
  const words = new Json3Parser().parseWords({
    events: [
      { tStartMs: 0, dDurationMs: 6000, wWinId: 1, segs: [{ utf8: 'a six second lyric\nthat keeps on going' }] },
      { tStartMs: 1000, dDurationMs: 500, wWinId: 2, segs: [{ utf8: '[bell]' }] },
    ],
  });
  assert.equal(words.find((w) => w.text === 'going').endMs, 6000);
});

test('a two-line ASR block starts its second line when the previous block leaves', () => {
  // YouTube ASR (Nov 2026, `exp=xpe`): no word offsets, but a block stays up
  // until the next block's second line is said. Word-timed ASR of the same talk
  // has "conference," at 27320 and "I" at 30400.
  const words = new Json3Parser().parseWords({
    events: [
      { tStartMs: 0, dDurationMs: 354800, id: 1, wpWinPosId: 1, wsWinStyleId: 1 },
      { tStartMs: 19560, dDurationMs: 7760, wWinId: 1, segs: [{ utf8: 'Hear that?\nThat\'s nothing.' }] },
      {
        tStartMs: 24840,
        dDurationMs: 5560,
        wWinId: 1,
        segs: [{ utf8: 'Which is what I, as a speaker at today\'s\nconference,' }],
      },
      { tStartMs: 28520, dDurationMs: 5280, wWinId: 1, segs: [{ utf8: 'have for you all.\nI have nothing.' }] },
    ],
  }, { asr: true });
  const at = (text) => words.find((w) => w.text === text).startMs;
  assert.equal(at('conference,'), 27320);
  assert.equal(at('I'), 30400);
  assert.ok(words.find((w) => w.text === 'today\'s').endMs <= 27320, 'the first line ends where the second starts');
  // The first block has no previous block, so it is spread as one span.
  assert.ok(at('That\'s') > 19560 && at('That\'s') < 24840);
});

test('only an untimed block in the same window marks when the second line starts', () => {
  const secondLine = (events) =>
    new Json3Parser().parseWords({ events }, { asr: true }).find((w) => w.text === 'second').startMs;
  const block = { tStartMs: 1000, dDurationMs: 4000, wWinId: 1, segs: [{ utf8: 'first line\nsecond line' }] };
  assert.equal(secondLine([{ tStartMs: 0, dDurationMs: 3000, wWinId: 1, segs: [{ utf8: 'before' }] }, block]), 3000);
  const otherWindow = { tStartMs: 0, dDurationMs: 3000, wWinId: 2, segs: [{ utf8: 'before' }] };
  assert.notEqual(secondLine([otherWindow, block]), 3000);
  const timed = { tStartMs: 0, dDurationMs: 3000, wWinId: 1, segs: [{ utf8: 'timed' }, { utf8: ' words', tOffsetMs: 500 }] };
  assert.notEqual(secondLine([timed, block]), 3000);
});

test('untimed words leave room for the pause after a sentence end', () => {
  const words = new Json3Parser().parseWords({
    events: [{ tStartMs: 0, dDurationMs: 3000, segs: [{ utf8: 'Stop. Then go on' }] }],
  });
  const then = words.find((w) => w.text === 'Then');
  const go = words.find((w) => w.text === 'go');
  // "Stop." takes its length plus the pause; "Then" takes its length plus a word gap.
  assert.ok(then.startMs - 0 > 2 * (go.startMs - then.startMs), 'the pause follows "Stop."');
});

test('overlapping manual cues do not time their second line from the previous cue', () => {
  // Manual cues don't roll up: the previous one ending says nothing about the next one's lines.
  const events = [
    { tStartMs: 0, dDurationMs: 1100, segs: [{ utf8: 'previous cue' }] },
    { tStartMs: 1000, dDurationMs: 4000, segs: [{ utf8: 'one two three four\nfive six seven eight' }] },
  ];
  const words = new Json3Parser().parseWords({ events });
  const at = (text) => words.find((w) => w.text === text).startMs;
  assert.ok(at('four') > 2000, 'the first line is not squeezed into 100 ms');
  assert.ok(at('five') > 2500, 'the second line starts partway through the cue');
});

test('Arabic and full-width marks leave room for a pause like Latin ones', () => {
  const gapAfter = (text) => {
    const words = new Json3Parser().parseWords({
      events: [{ tStartMs: 0, dDurationMs: 3000, segs: [{ utf8: `${text} bb cc` }] }],
    });
    return words[1].startMs - words[0].startMs;
  };
  const plain = gapAfter('aa');
  for (const text of ['aa،', 'aa؛', 'aa，', 'aa、', 'aa；']) assert.ok(gapAfter(text) > plain, `${text} is a clause pause`);
  for (const text of ['aa؟', 'aa。', 'aa！', 'aa？']) assert.ok(gapAfter(text) > gapAfter('aa،'), `${text} is a sentence pause`);
});
