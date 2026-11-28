const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/core/text-utils.js');
require('../src/core/chunker.js');
require('../src/core/disfluency.js');

const { Disfluency, CaptionChunker } = globalThis.YTSC;

/** Words 300ms apart, 250ms long, from a plain sentence. */
const timed = (sentence) =>
  sentence.split(' ').map((text, i) => ({ text, startMs: i * 300, endMs: i * 300 + 250 }));
const cleanText = (sentence, opts) =>
  new Disfluency(opts).clean(timed(sentence)).map((w) => w.text).join(' ');

test('drops fillers in English, German and Vietnamese', () => {
  assert.equal(cleanText('So, um, we started. Uh, it worked.'), 'So we started. It worked.');
  assert.equal(cleanText('Also, äh, ich glaube, ähm, dass'), 'Also, ich glaube, dass');
  assert.equal(cleanText('Thì, ờ, mình nghĩ là, ừm, tụi mình'), 'Thì, mình nghĩ là, tụi mình');
});

test('strips a leftover comma after a conjunction that only set off a filler', () => {
  assert.equal(cleanText('Und, äh, am Anfang'), 'Und am Anfang');
  assert.equal(cleanText('And, uh, then we left'), 'And then we left');
  assert.equal(cleanText('But, um, wait.'), 'But wait.');
  assert.equal(cleanText('và, ờ, rồi đi'), 'và rồi đi');
});

test('keeps a clause comma that is not just wrapping a filler', () => {
  assert.equal(cleanText('ich glaube, ähm, dass'), 'ich glaube, dass');
});

test('keeps words that only look like fillers', () => {
  // "à" is also a Vietnamese particle; "like"/"you know" are opt-in.
  assert.equal(cleanText('Anh đi à'), 'Anh đi à');
  assert.equal(cleanText('I like it, you know'), 'I like it, you know');
});

test('keeps a repeated phrase in a manual caption', () => {
  const words = timed('là nhà là nhà của nhau').map((word) => ({ ...word, estimated: true }));
  assert.equal(new Disfluency().clean(words).map((w) => w.text).join(' '), 'là nhà là nhà của nhau');
});

test('collapses repeats, keeping the last copy', () => {
  assert.equal(cleanText('I I I think the the main thing'), 'I think the main thing');
  assert.equal(cleanText('with with the photos'), 'with the photos');
});

test('preserves repetitions that can carry emphasis or different grammatical roles', () => {
  for (const text of [
    'nobody, nobody believed it', 'không ai, không ai tin', 'No, no, no!',
    'WHOA WHOA WHOA?', 'very very good', 'tell you you did well', 'believe that that was me',
    'the problem is is it enough', 'she had had enough',
  ]) assert.equal(cleanText(text), text);
});

test('sees repeats through fillers', () => {
  assert.equal(cleanText("It's, um, it's surreal."), "It's surreal.");
  assert.equal(cleanText('but, uh, but here we are'), 'but here we are');
});

test('repairs capitals and sentence punctuation', () => {
  assert.equal(cleanText('It happened. Um, it just did.'), 'It happened. It just did.');
  assert.equal(cleanText('That was it um.'), 'That was it.');
  assert.equal(cleanText('Um, hello'), 'Hello');
});

test('a ♪ between a dropped sentence start and the next word keeps the capital for that word', () => {
  assert.equal(cleanText('Um [Music] so we start.'), '♪ So we start.');
  assert.equal(cleanText('Done. Uh, [Music] and then'), 'Done. ♪ And then');
});

test('absorbs dropped time into the previous word', () => {
  const words = [
    { text: 'So,', startMs: 0, endMs: 200 },
    { text: 'um,', startMs: 200, endMs: 900 },
    { text: 'we', startMs: 900, endMs: 1100 },
  ];
  const out = new Disfluency().clean(words);
  assert.deepEqual(out, [
    { text: 'So', startMs: 0, endMs: 900 },
    { text: 'we', startMs: 900, endMs: 1100 },
  ]);
  assert.equal(words[0].endMs, 200, 'input is not mutated');
  // Without absorbing, the 700ms "gap" would be a pause and split the chunk.
  assert.deepEqual(new CaptionChunker().build(out).map((c) => c.text), ['So we']);
});

test('aggressive mode also drops discourse markers', () => {
  assert.equal(
    cleanText('And, like, when we started, I mean, it was, you know, hard', { aggressive: true }),
    'And when we started, it was, hard'
  );
});

test('drop option removes only the chosen kinds', () => {
  assert.equal(cleanText('So, um, I I think', { drop: ['repeat'] }), 'So, um, I think');
  assert.equal(cleanText('So, um, I I think', { drop: ['filler'] }), 'So I I think');
});

test('turns [Music] tags into a standalone ♪', () => {
  assert.equal(cleanText('[Music] So today we'), '♪ So today we');
  assert.equal(cleanText('[Musik] Also, äh, ich'), '♪ Also, ich');
  assert.equal(cleanText('[âm nhạc] Xin chào'), '♪ Xin chào', 'multi-word tag');
  assert.equal(cleanText('[Applause] [Laughter] thanks'), '[Applause] [Laughter] thanks', 'other tags stay');
  assert.equal(cleanText('[Musical] notes'), '[Musical] notes', 'whole-tag match only');
  assert.equal(cleanText('[Music] um. Hi'), '♪ Hi', 'the note takes no punctuation from dropped words');
});

test('merges consecutive music tags into one note spanning their time', () => {
  const words = [
    { text: '[Music]', startMs: 0, endMs: 2000 },
    { text: '[Music]', startMs: 2000, endMs: 5000 },
    { text: 'Hello', startMs: 5200, endMs: 5500 },
  ];
  const out = new Disfluency().clean(words);
  assert.deepEqual(out.map((w) => [w.text, w.startMs, w.endMs]), [['♪', 0, 5000], ['Hello', 5200, 5500]]);
  // The note is its own chunk even without a pause before the next words.
  assert.deepEqual(new CaptionChunker().build(out).map((c) => c.text), ['♪', 'Hello']);
});

test('handles empty and filler-only input', () => {
  const d = new Disfluency();
  assert.deepEqual(d.clean([]), []);
  assert.deepEqual(d.clean(timed('um uh')), []);
});

test('shares unchanged words and copies only words repaired during cleaning', () => {
  const plain = timed('A completely ordinary caption.');
  const plainOut = new Disfluency().clean(plain);
  assert.deepEqual(plainOut, plain);
  plainOut.forEach((word, index) => assert.equal(word, plain[index]));

  const words = timed('So, um, we left.');
  const snapshot = words.map((word) => ({ ...word }));
  const out = new Disfluency().clean(words);
  assert.deepEqual(out.map((word) => word.text), ['So', 'we', 'left.']);
  assert.notEqual(out[0], words[0], 'text/timing repair does not mutate the source word');
  assert.equal(out[1], words[2]);
  assert.equal(out[2], words[3]);
  assert.deepEqual(words, snapshot);
});

const strictText = (sentence) => new Disfluency().clean(timed(sentence), { strict: true }).map((w) => w.text).join(' ');

test('strict cleaning drops every sound tag, [Music] included', () => {
  assert.equal(strictText('[Applause] Thank you so much'), 'Thank you so much');
  assert.equal(strictText('that was great [Laughter] anyway'), 'that was great anyway');
  assert.equal(strictText('[Music] So, um, today we'), 'So today we', 'no ♪ in strict mode');
  assert.equal(strictText('[Musik] [Applaus] Also, äh, ich'), 'Also, ich');
  assert.equal(strictText('[âm nhạc] Xin chào'), 'Xin chào', 'multi-word tag');
  assert.equal(strictText('[indistinct chatter in the background] hi'), 'hi', 'long tag');
});

test('strict cleaning keeps a tag’s stop, and bleeped words', () => {
  assert.equal(strictText('and that was it [Laughter]. So'), 'and that was it. So');
  assert.equal(strictText('It ended. [Applause]. Next'), 'It ended. Next');
  assert.equal(strictText('what the [ __ ] is that'), 'what the [ __ ] is that', '"[ __ ]" is a word, not a sound');
  assert.equal(strictText('[an unclosed bracket and many more words follow'), '[an unclosed bracket and many more words follow');
});

test('strict cleaning leaves the gap a sound tag covered, and finds repeats across it', () => {
  const words = [
    { text: 'Hello', startMs: 0, endMs: 300 },
    { text: '[Applause]', startMs: 300, endMs: 4000 },
    { text: 'everyone', startMs: 4000, endMs: 4400 },
  ];
  const out = new Disfluency().clean(words, { strict: true });
  assert.deepEqual(out.map((w) => [w.text, w.startMs, w.endMs]), [['Hello', 0, 300], ['everyone', 4000, 4400]]);
  assert.equal(strictText('I I [Laughter] I think'), 'I think');
});

test('without strict, sound tags other than [Music] stay', () => {
  assert.equal(cleanText('[Applause] Thank you'), '[Applause] Thank you');
});

test('strict cleaning stops a tag at its first "]", even before a full-width stop', () => {
  assert.equal(strictText('[拍手]。 ありがとう [音楽]'), 'ありがとう');
  assert.equal(strictText('はい [拍手]。 ありがとう'), 'はい。 ありがとう');
  assert.equal(strictText('[Applause]and more] words'), '[Applause]and more] words', 'a "]" glued to letters is no tag end');
});

test('strict cleaning turns a comma before a tag into the tag’s stop', () => {
  assert.equal(strictText('Well, [Laughter]. Next'), 'Well. Next');
  assert.equal(strictText('Well, [Laughter] next'), 'Well, next', 'no stop on the tag: the comma stays');
});

test('a dropped tag that opened a caption cue hands the cue start to the next word', () => {
  const words = [
    { text: 'First', startMs: 0, endMs: 400, estimated: true, preserveLine: true, cueStart: true },
    { text: 'line', startMs: 400, endMs: 800, estimated: true, preserveLine: true },
    { text: '[Applause]', startMs: 8000, endMs: 8500, estimated: true, preserveLine: true, cueStart: true },
    { text: 'Thank', startMs: 8500, endMs: 9000, estimated: true, preserveLine: true },
    { text: 'you', startMs: 9000, endMs: 10000, estimated: true, preserveLine: true },
  ];
  const out = new Disfluency().clean(words, { strict: true });
  assert.deepEqual(out.map((w) => [w.text, Boolean(w.cueStart)]), [['First', true], ['line', false], ['Thank', true], ['you', false]]);
  assert.deepEqual(new CaptionChunker().build(out).map((c) => c.text), ['First line', 'Thank you']);
  assert.equal(words[3].cueStart, undefined, 'the input words are not changed');
});

test('a filler right after a dropped tag does not stretch the word before it over the pause', () => {
  const words = [
    { text: 'well', startMs: 0, endMs: 300 },
    { text: '[Applause]', startMs: 300, endMs: 5300 },
    { text: 'um', startMs: 5300, endMs: 5600 },
    { text: 'anyway', startMs: 5600, endMs: 6000 },
  ];
  const out = new Disfluency().clean(words, { strict: true });
  assert.deepEqual(out.map((w) => [w.text, w.startMs, w.endMs]), [['well', 0, 300], ['anyway', 5600, 6000]]);
  assert.deepEqual(new CaptionChunker().build(out).map((c) => c.text), ['well', 'anyway']);
});

test('repetition never crosses sentence, speaker, manual-cue or pause boundaries', () => {
  for (const punctuation of ['.', '?', '!', '。', '؟']) {
    const input = `I${punctuation} I think`;
    assert.equal(cleanText(input), input);
  }
  for (const boundary of [{ speakerStart: true }, { cueStart: true }, { estimated: true }]) {
    const words = timed('I I think');
    Object.assign(words[1], boundary);
    assert.equal(new Disfluency().clean(words).map(w => w.text).join(' '), 'I I think');
  }
  const words = timed('I I think');
  words[1].startMs = 2000;
  words[1].endMs = 2200;
  words[2].startMs = 2300;
  assert.equal(new Disfluency().clean(words).map(w => w.text).join(' '), 'I I think');
  assert.equal(cleanText('I um. I think'), 'I. I think');
});

test('empty speaker turns disappear and never donate punctuation to another speaker', () => {
  assert.equal(cleanText('>> Um,'), '');
  assert.equal(cleanText('>> Um >> Hello'), 'Hello');
  assert.equal(strictText('Hello >> [Laughter]. >> Bye'), 'Hello Bye');
  assert.equal(strictText('>> [Applause] um'), '');
  const words = new Disfluency().clean(timed('Hello >> Um, she knows'));
  assert.equal(words[1].text, 'She');
  assert.equal(words[1].speakerStart, true);
  assert.equal(words[0].endMs, 250);
});

test('quote repair preserves opening and closing marks around removed fillers', () => {
  assert.equal(cleanText('I said, “Um hello.”'), 'I said, “Hello.”');
  assert.equal(cleanText('I said, "Uh hi."'), 'I said, "Hi."');
  assert.equal(cleanText('It was "fine um."'), 'It was "fine."');
  assert.equal(cleanText('>> "Uh >> hello'), 'hello', 'an unfinished quote stays with its speaker');
});

test('brief music next to speech stays without losing speaker boundaries', () => {
  const input = timed('Hello >> [Music] bye');
  const output = new Disfluency().clean(input);
  assert.equal(output[1].speakerStart, true);
  assert.equal(textOf(output), 'Hello ♪ bye');
  assert.equal(input[1].text, '>>');
  // Zero-duration words come from live captions: their actual duration is unknown.
  const live = [{ text: '[Music]', startMs: 0, endMs: 0 }, { text: 'Hello', startMs: 0, endMs: 0 }];
  assert.equal(textOf(new Disfluency().clean(live)), '♪ Hello');
  assert.equal(textOf(new Disfluency().clean(timed('[Music]'))), '♪', 'an isolated note remains');
});

const textOf = words => words.map(w => w.text).join(' ');

test('a retained sound description is not searched for hesitation fillers', () => {
  assert.equal(cleanText('[um] hello'), '[um] hello');
  assert.equal(cleanText('[people say uh] hello'), '[people say uh] hello');
});

test('self-contained quotes and parentheses disappear with a removed filler', () => {
  for (const [input, expected] of [
    ['He said "um" to him', 'He said to him'],
    ['I said, "Um." Next sentence', 'I said. Next sentence'],
    ['He said (uh) to him', 'He said to him'],
    ['He said “um” to him', 'He said to him'],
    ['He said ("um") to him', 'He said to him'],
    ['He said （uh） to him', 'He said to him'],
    ['He said "um". Next', 'He said. Next'],
    ['I said "hello uh"', 'I said "hello"'],
  ]) assert.equal(cleanText(input), expected, input);
});

test('terminal repair avoids duplicate stops and closers in multiple scripts', () => {
  for (const [input, expected] of [
    ['He said "Done." um.', 'He said "Done."'],
    ['終わり。 ờ.', '終わり。'],
    ['終わり！ ờ.', '終わり！'],
    ['انتهى؟ um.', 'انتهى؟'],
    ['I said, "Hi," um."', 'I said, "Hi."'],
    ['I said، um.', 'I said.'],
    ['I said， um.', 'I said.'],
    ['I said、 um.', 'I said.'],
  ]) assert.equal(cleanText(input), expected, input);
  assert.equal(strictText('انتهى؟ [Laughter].'), 'انتهى؟');
  assert.equal(strictText('I said، [Laughter].'), 'I said.');
});

test('a chain of fillers preserves its entire pause once cumulative absorption reaches one second', () => {
  const words = [
    { text: 'Well', startMs: 0, endMs: 300 },
    { text: 'um', startMs: 300, endMs: 800 },
    { text: 'uh', startMs: 800, endMs: 1400 },
    { text: 'er', startMs: 1400, endMs: 2000 },
    { text: 'okay', startMs: 2000, endMs: 2300 },
  ];
  const original = structuredClone(words);
  const out = new Disfluency().clean(words);
  assert.deepEqual(out, [words[0], words[4]]);
  assert.deepEqual(new CaptionChunker().build(out).map(c => c.text), ['Well', 'okay']);
  assert.deepEqual(words, original);
  const short = [words[0], words[1], { text: 'uh', startMs: 800, endMs: 1000 }, { text: 'okay', startMs: 1000, endMs: 1300 }];
  assert.equal(new Disfluency().clean(short)[0].endMs, 1000, 'a genuinely short hesitation can still be absorbed');
});

test('complete emphatic replies stay while unfinished repeated prefixes still clean', () => {
  for (const input of [
    'Yes, I am, I am.', 'He is, he is!', 'She was, she was.',
    'We are, we are', 'You have, you have.', 'Yes, I am, I am. Next question.',
    'I am, I am, I am.',
  ]) assert.equal(cleanText(input), input);
  assert.equal(cleanText('I was like I was like happy'), 'I was like happy');
  assert.equal(cleanText('I was I was I was happy'), 'I was happy');
  assert.equal(cleanText('So I was like so I was like okay'), 'So I was like okay');
});
