const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const manifest = require('../manifest.json');
const source = ['src/core/settings.js', 'src/background.js']
  .map((file) => fs.readFileSync(path.join(root, file), 'utf8'))
  .join('\n');

// Settles the storage read on a later turn.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// Runs background.js the way Firefox's and Safari's event page would (settings.js first).
function load({ stored = {}, icons = manifest.action.default_icon } = {}) {
  const icon = [];
  const title = [];
  const listeners = { changed: [], startup: [], installed: [] };
  const chrome = {
    runtime: {
      getManifest: () => ({ name: 'Stable Captions', action: { default_icon: icons } }),
      onStartup: { addListener: (f) => listeners.startup.push(f) },
      onInstalled: { addListener: (f) => listeners.installed.push(f) },
    },
    storage: {
      sync: { get: async (defaults) => ({ ...defaults, ...stored }) },
      onChanged: { addListener: (f) => listeners.changed.push(f) },
    },
    action: {
      setIcon: async ({ path: paths }) => { icon.push(paths); },
      setTitle: async ({ title: text }) => { title.push(text); },
    },
  };
  vm.runInNewContext(source, { chrome });
  return { icon, title, listeners };
}

test('the toolbar shows the manifest icon while on', async () => {
  const { icon, title, listeners } = load();
  await flush();
  assert.deepEqual({ ...icon.at(-1) }, { 16: '/icons/icon-16.png', 32: '/icons/icon-32.png', 48: '/icons/icon-48.png' });
  assert.equal(title.at(-1), 'Stable Captions');
  assert.equal(listeners.startup.length, 1, 'set again when the browser starts (it forgets set icons)');
  assert.equal(listeners.installed.length, 1);
});

test('the toolbar shows the off icon while switched off, and follows the switch', async () => {
  const { icon, title, listeners } = load({ stored: { enabled: false } });
  await flush();
  assert.deepEqual({ ...icon.at(-1) }, { 16: '/icons/icon-16-off.png', 32: '/icons/icon-32-off.png', 48: '/icons/icon-48-off.png' });
  assert.equal(title.at(-1), 'Stable Captions (off)');

  listeners.changed[0]({ enabled: { oldValue: false, newValue: true } }, 'sync');
  await flush();
  assert.equal(icon.at(-1)[16], '/icons/icon-16.png');
  listeners.changed[0]({ size: { newValue: 'large' } }, 'sync');
  await flush();
  assert.equal(icon.length, 2, 'other settings leave the icon alone');
});

test("Safari's toolbar glyph has its own off version", async () => {
  const { icon } = load({ stored: { enabled: false }, icons: { 16: 'icons/toolbar-16.png', 38: 'icons/toolbar-38.png' } });
  await flush();
  assert.deepEqual({ ...icon.at(-1) }, { 16: '/icons/toolbar-16-off.png', 38: '/icons/toolbar-38-off.png' });
});

test('every toolbar icon, on Chrome, Firefox and Safari, has an off version', () => {
  const safariBuild = fs.readFileSync(path.join(root, 'scripts/build-safari.js'), 'utf8');
  const safariIcons = [...safariBuild.matchAll(/'(icons\/toolbar-\d+\.png)'/g)].map((m) => m[1]);
  assert.ok(safariIcons.length, 'Safari build still lists its toolbar icons');
  for (const file of [...Object.values(manifest.action.default_icon), ...safariIcons]) {
    assert.ok(fs.existsSync(path.join(root, file)), file);
    assert.ok(fs.existsSync(path.join(root, file.replace(/\.png$/, '-off.png'))), `${file} has an -off version`);
  }
});

test('the manifest runs background.js as a service worker or an event page', () => {
  assert.equal(manifest.background.service_worker, 'src/background.js');
  assert.deepEqual(manifest.background.scripts, ['src/core/settings.js', 'src/background.js']);
});
