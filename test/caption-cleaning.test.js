const test = require('node:test');
const assert = require('node:assert/strict');
const { Json3Parser } = require('../src/core/json3-parser.js');
const { Disfluency } = require('../src/core/disfluency.js');
const { CaptionChunker } = require('../src/core/chunker.js');
const { clips } = require('./fixtures/clean-verbatim-video.json');

const parser = new Json3Parser();
const cleaner = new Disfluency();
const parse = name => parser.parseWords(clips[name], { asr: true });
const text = words => words.map(w => w.text).join(' ');

for (const strict of [false, true]) {
  const clean = name => cleaner.clean(parse(name), { strict });
  test(`video: questions, grammatical repetition and emphasis survive (strict=${strict})`, () => {
    assert.equal(text(clean('question')), 'What do I do? I what?');
    assert.match(text(clean('secondQuestion')), /What What do I do\? I thought/);
    assert.match(text(clean('grammar')), /tell you you did such a beautiful job/);
    assert.match(text(clean('that')), /believe that that was me/);
    assert.match(text(clean('no')), /No\. No, no, no, no,/);
    assert.match(text(clean('whoa')), /WHOA WHOA WHOA\?/);
    assert.equal(text(clean('hurry')), 'Hurry. Hurry. Hurry.');
    assert.equal(text(clean('speakers')), text(parse('speakers')));
  });

  test(`video: three- and four-word unfinished restarts are cleaned (strict=${strict})`, () => {
    assert.equal(text(clean('restart')), 'I had a really big crush on you.');
    const result = text(clean('longRestart'));
    assert.match(result, /all week I was like he's going to ask me out/);
    assert.match(result, /And so I was like okay/);
    assert.doesNotMatch(result, /I was like I was like|so I was like so I was like/);
    assert.match(result, /I'm doing it\. I'm doing it\./, 'complete repeated sentences are intentional');
  });

  test(`video: speaker starts and quoted fillers retain capitals and quotes (strict=${strict})`, () => {
    const capital = clean('capital');
    assert.match(text(capital), /^She taught me/);
    assert.equal(capital[0].speakerStart, true);
    const quoted = text(clean('quotes'));
    assert.match(quoted, /I go, "Hi Clive, I'm Jimmy Fallon\."/);
    assert.match(quoted, /he goes, "Is he going to kiss him on the cheek\?"/);
  });

  test(`video: removed restarts and long hesitations do not extend earlier sentences (strict=${strict})`, () => {
    const raw = parse('timing');
    const cleaned = clean('timing');
    assert.match(text(cleaned), /wine\. And then I went/);
    assert.deepEqual(cleaned.find(w => w.text === 'wine.'), raw.find(w => w.text === 'wine.'));
    const hesitation = clean('hesitation');
    assert.deepEqual(hesitation.find(w => w.text === 'were'), parse('hesitation').find(w => w.text === 'were'));
    for (const style of ['frosted', 'tiktok', 'boring']) {
      const chunks = new CaptionChunker({ style }).build(hesitation);
      assert.ok(!chunks.some(c => /were I wrote/.test(c.text)), 'a long hesitation remains a caption break');
    }
  });
}

test('video: repeated speech retains its own timestamps before the clean switch is applied', () => {
  const repeated = parse('repeatedSentence');
  assert.match(text(repeated), /"Don't look drunk\. Don't look drunk\."/);
  assert.equal(repeated.find(w => w.text === "Don't").startMs, 592760);
  const speakers = parse('speakers');
  const yeah = speakers.find(w => w.startMs === 622160);
  assert.equal(yeah.text, 'Yeah,');
  assert.equal(yeah.speakerStart, true);
  assert.equal(text(parse('restart')), 'I had a I had a really big crush on you.');
});

test('video: every style and cleaning level keeps sound tags and single speaker markers with their content', () => {
  for (const name of Object.keys(clips)) {
    const words = parse(name);
    const original = structuredClone(words);
    for (const style of ['frosted', 'tiktok', 'boring']) {
      for (const strict of [null, false, true]) {
        const chunks = new CaptionChunker({ style }).build(strict === null ? words : cleaner.clean(words, { strict }));
        for (const [i, chunk] of chunks.entries()) {
          assert.equal(chunk.text.startsWith('>> '), Boolean(chunk.words[0].speakerStart), `${name}: ${chunk.text}`);
          assert.doesNotMatch(chunk.text, />>\s*>>|^>>[.\s]*$/, `${name}: ${chunk.text}`);
          assert.equal(chunk.text.includes('['), chunk.text.includes(']'), `${name}: ${chunk.text}`);
          assert.ok(chunk.endMs > chunk.startMs);
          if (chunks[i + 1]) assert.ok(chunk.endMs <= chunks[i + 1].startMs);
          assert.ok(chunk.words.slice(1).every(w => !w.speakerStart), 'speaker changes begin a new caption');
          if (strict) assert.doesNotMatch(chunk.text, /\[/);
        }
      }
    }
    assert.deepEqual(words, original, 'repeated cleaning/style changes must not mutate source words');
  }
});

test('video: brief background music still becomes a music note', () => {
  const words = parse('music');
  assert.ok(words.some(w => w.text === '[music]'));
  const normal = cleaner.clean(words);
  const note = normal.find(w => w.text === '♪');
  const tag = words.find(w => w.text === '[music]');
  assert.ok(note);
  assert.equal(note.startMs, tag.startMs);
  assert.equal(note.endMs, tag.endMs);
  assert.equal(text(normal), text(words).replace('[music]', '♪'));
});
