const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const popup = fs.readFileSync(path.join(__dirname, '../src/popup/popup.js'), 'utf8');
const statusStart = popup.indexOf('  const VIDEO_SITES =');
const statusEnd = popup.indexOf('\n  // ---------- Start ----------');
assert.ok(statusStart >= 0 && statusEnd > statusStart, 'popup status section remains extractable');
const statusScript = popup.slice(statusStart, statusEnd);

function setup(url, granted, { enabled = true } = {}) {
  const checks = [];
  const status = { hidden: false, dataset: {}, attrs: {}, setAttribute(name, value) { this.attrs[name] = value; } };
  const grant = { hidden: true, addEventListener() {} };
  const statusText = { textContent: '' };
  const elements = { status, grant, 'status-text': statusText };
  const context = {
    state: { enabled },
    $: (id) => elements[id],
    api: {
      permissions: {
        async contains(sites) {
          checks.push(sites);
          return sites.origins.every((origin) => granted.includes(origin));
        },
      },
      tabs: { query: async () => [{ url }] },
    },
  };
  vm.runInNewContext(statusScript, context);
  return { showStatus: context.showStatus, paintStatus: context.paintStatus, context, checks, status, grant, statusText };
}

for (const [name, url, required] of [
  ['YouTube', 'https://www.youtube.com/watch?v=abc', ['https://www.youtube.com/*']],
  ['youtube-nocookie', 'https://www.youtube-nocookie.com/embed/abc', ['https://www.youtube-nocookie.com/*']],
  ['HackerTube', 'https://hackertube.org/watch/abc', ['https://hackertube.org/*', 'https://www.youtube-nocookie.com/*']],
]) {
  test(`popup status only requires the active page's permissions on ${name}`, async () => {
    // Deliberately leave every unrelated video-site permission ungranted.
    const { showStatus, checks, status, grant, statusText } = setup(url, required);
    await showStatus();
    assert.equal(checks.length, 1);
    assert.deepEqual(Array.from(checks[0].origins), required);
    assert.equal(status.hidden, false);
    assert.equal(grant.hidden, true);
    assert.equal(statusText.textContent, 'on the tube');
  });
}

test('popup still asks for access when the active page permission is missing', async () => {
  const granted = ['https://www.youtube-nocookie.com/*', 'https://hackertube.org/*'];
  const { showStatus, checks, status, grant } = setup('https://www.youtube.com/watch?v=abc', granted);
  await showStatus();
  assert.deepEqual(Array.from(checks[0].origins), ['https://www.youtube.com/*']);
  assert.equal(status.hidden, false, 'the TV stays: it is the power switch');
  assert.equal(status.dataset.state, 'idle');
  assert.equal(grant.hidden, false);
});

test('HackerTube status asks for its caption iframe permission', async () => {
  const { showStatus, checks, status, grant } = setup('https://hackertube.org/watch/abc', ['https://hackertube.org/*']);
  await showStatus();
  assert.deepEqual(Array.from(checks[0].origins), ['https://hackertube.org/*', 'https://www.youtube-nocookie.com/*']);
  assert.equal(status.hidden, false);
  assert.equal(grant.hidden, false);
});

test('the TV is the power switch: off on a video, and lit again when switched back on', async () => {
  const { showStatus, paintStatus, context, status, statusText } = setup(
    'https://www.youtube.com/watch?v=abc', ['https://www.youtube.com/*'], { enabled: false }
  );
  await showStatus();
  assert.equal(status.dataset.state, 'off');
  assert.equal(status.attrs['aria-checked'], 'false');
  assert.equal(status.title, 'Switch Stable Captions on');
  assert.equal(statusText.textContent, 'switched off');
  context.state.enabled = true;
  paintStatus();
  assert.equal(status.dataset.state, 'on');
  assert.equal(status.attrs['aria-checked'], 'true');
  assert.equal(status.title, 'Switch Stable Captions off');
  assert.equal(statusText.textContent, 'on the tube');
});

test('switched on, a page that is not a video site is "no video here", not "off"', async () => {
  const { showStatus, status, statusText } = setup('https://example.com/', [
    'https://www.youtube.com/*', 'https://www.youtube-nocookie.com/*', 'https://hackertube.org/*',
  ]);
  await showStatus();
  assert.equal(status.dataset.state, 'idle');
  assert.equal(statusText.textContent, 'no video here');
});

test('switched off before the tab is known, the TV already says so', () => {
  const { paintStatus, status, statusText } = setup('https://www.youtube.com/watch?v=abc', [], { enabled: false });
  paintStatus();
  assert.equal(status.dataset.state, 'off');
  assert.equal(statusText.textContent, 'switched off');
});

test('the popup title links to the home page in the manifest', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/popup/popup.html'), 'utf8');
  const { homepage_url: home } = require('../manifest.json');
  assert.equal(home, 'https://stable.monster');
  assert.match(html, new RegExp(`<h1><a id="home" href="${home}"[^>]*>(<span[^>]*>)?Stable Captions(</span>)?</a></h1>`));
});

test('without site access the TV can still switch Stable Captions off', async () => {
  const { showStatus, paintStatus, context, status, statusText, grant } = setup('https://example.com/', ['https://www.youtube.com/*']);
  await showStatus();
  assert.equal(grant.hidden, false);
  assert.equal(statusText.textContent, 'needs access');
  context.state.enabled = false;
  paintStatus();
  assert.equal(status.attrs['aria-checked'], 'false');
  assert.equal(statusText.textContent, 'switched off');
});

test('the title link survives tabs.create failing (the click event is over by then)', async () => {
  const popup = fs.readFileSync(path.join(__dirname, '../src/popup/popup.js'), 'utf8');
  const start = popup.indexOf("  $('home').addEventListener");
  const end = popup.indexOf('\n  });', start) + 6;
  let handler;
  const opened = [];
  const context = {
    $: () => ({ addEventListener: (type, f) => { handler = f; } }),
    api: { tabs: { create: () => Promise.reject(new Error('no tabs API')) } },
    window: { close() {}, open: (url) => opened.push(url) },
  };
  vm.runInNewContext(popup.slice(start, end), context);
  const event = { currentTarget: { href: 'https://stable.monster/' }, preventDefault() {} };
  handler(event);
  event.currentTarget = null; // as after dispatch
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(opened, ['https://stable.monster/']);
});
