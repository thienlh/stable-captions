const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/core/text-utils.js');
require('../src/core/rolling-merger.js');
require('../src/core/chunker.js');
require('../src/content/live-source.js');

const { LiveWordDiff, LiveChunker } = globalThis.YTSC;

test('live diff returns only newly spoken words from rolling windows', () => {
  const d = new LiveWordDiff();
  assert.deepEqual(d.push('Was'), ['Was']);
  assert.deepEqual(d.push('Was bedeutet'), ['bedeutet']);
  assert.deepEqual(d.push('Was bedeutet dieses Wort?'), ['dieses', 'Wort?']);
});

test('live diff handles a scrolled-off row and new text in one snapshot', () => {
  const d = new LiveWordDiff();
  d.push('row one words row two');
  assert.deepEqual(d.push('row two and more'), ['and', 'more']);
});

test('live diff ignores partial re-renders and last-word corrections', () => {
  const d = new LiveWordDiff();
  d.push('wir lernen das Wort');
  assert.deepEqual(d.push('wir lernen'), []); // half-rendered snapshot
  assert.deepEqual(d.push('wir lernen das Worte heute'), ['heute']);
});

test('live chunker emits whole chunks only, capped in size', () => {
  const c = new LiveChunker({ maxWords: 4 });
  assert.deepEqual(c.push(['one', 'two', 'three'], 0), []);
  const closed = c.push(['four', 'five'], 100);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].text, 'one two three four');
  assert.equal(c.flush().text, 'five');
  assert.equal(c.flush(), null);
});

test('live chunks are a little longer for Boring and follow a style change', () => {
  const words = 'one two three four five six seven'.split(' ');
  assert.equal(new LiveChunker().push(words, 0)[0].text, 'one two three four five');
  const live = new LiveChunker({ style: 'boring' });
  assert.equal(live.push(words, 0)[0].text, 'one two three four five six');
  live.setStyle('frosted');
  assert.deepEqual(live.push(['eight', 'nine', 'ten', 'eleven', 'twelve'], 0).map((c) => c.text), ['seven eight nine ten eleven']);
  assert.equal(live.flush().text, 'twelve');
});

test('live chunker closes at sentence end', () => {
  const c = new LiveChunker();
  const closed = c.push(['Das', 'ist', 'fertig.', 'Und'], 0);
  assert.deepEqual(closed.map((x) => x.text), ['Das ist fertig.']);
});

test('live chunks keep a "[…]" sound tag whole, so clean verbatim can drop it', () => {
  const live = new LiveChunker(); // five words a chunk
  const chunks = live.push('one two three four [âm nhạc] Hello'.split(' '), 0);
  assert.deepEqual(chunks.map((c) => c.text), ['one two three four [âm nhạc]']);
  assert.equal(live.flush().text, 'Hello');
  const unclosed = new LiveChunker({ maxWords: 3 });
  const words = '[one two three four five six seven eight'.split(' ');
  assert.ok(unclosed.push(words, 0).length, 'an unclosed "[" does not hold chunks back forever');
});

test('live speaker markers split turns and never become words or empty chunks', () => {
  const live = new LiveChunker();
  const closed = live.push(['hello', '>>', '>>', 'Um,', 'she', 'knows.'], 0);
  assert.deepEqual(closed.map(c => c.text), ['hello', '>> Um, she knows.']);
  assert.equal(closed[1].words[0].speakerStart, true);
  assert.deepEqual(live.push(['>>'], 10), []);
  assert.equal(live.flush(), null);
  assert.equal(live.push(['Bye.'], 20)[0].words[0].speakerStart, true);
});

test('live diff preserves new short turns instead of treating markers as stable speech', () => {
  for (const next of ['>> Hi', '>> Hello there']) {
    const d = new LiveWordDiff();
    assert.deepEqual(d.push('>> Um'), ['>>', 'Um']);
    assert.deepEqual(d.push(next), next.split(' '));
    assert.deepEqual(d.push(`${next} again`), ['again']);
  }
});

test('live diff still recognizes growing turns and corrections with a real speech prefix', () => {
  const d = new LiveWordDiff();
  assert.deepEqual(d.push('>> Was'), ['>>', 'Was']);
  assert.deepEqual(d.push('>> Was bedeutet'), ['bedeutet']);
  assert.deepEqual(d.push('>> Was bedeutet dieses Wort'), ['dieses', 'Wort']);
  assert.deepEqual(d.push('>> Was bedeutet dieses Worte heute'), ['heute']);
});

test('live short-turn delivery reaches the chunker with its speaker marker', () => {
  const diff = new LiveWordDiff();
  const chunker = new LiveChunker();
  chunker.push(diff.push('>> Um'), 0);
  assert.equal(chunker.flush().text, '>> Um');
  chunker.push(diff.push('>> Hi'), 1000);
  assert.equal(chunker.flush().text, '>> Hi');
});
