/**
 * Shows the popup's master switch on the toolbar button: the manifest's icon while
 * Stable Captions is on, its `-off` sibling (greyed colour icon, or Safari's glyph
 * with a slash) while it is off. The browser forgets a set icon when it quits, so
 * this runs again at startup, on install and on every change of the setting.
 * Runs as Chrome's service worker, or as Firefox's and Safari's event page
 * (manifest `background.scripts`, which loads settings.js first).
 * Single responsibility: the `enabled` setting -> toolbar icon and tooltip.
 */
if (typeof importScripts === 'function' && !globalThis.YTSC?.Settings) importScripts('/src/core/settings.js');

(() => {
  'use strict';

  const api = globalThis.browser ?? globalThis.chrome;
  const store = api.storage.sync ?? api.storage.local; // Safari may lack sync
  const action = api.action ?? api.browserAction;
  const { DEFAULTS } = globalThis.YTSC.Settings;

  /** The toolbar icons for a state. Absolute paths: a service worker's are not the root. */
  const toolbarIcons = (enabled, manifest = api.runtime.getManifest()) => {
    const icons = manifest.action?.default_icon || {};
    return Object.fromEntries(Object.entries(icons).map(([size, file]) => [
      size,
      `/${enabled ? file : file.replace(/\.png$/, '-off.png')}`,
    ]));
  };

  const show = (enabled) => {
    enabled = enabled !== false;
    const { name } = api.runtime.getManifest();
    // Promise form (Chrome, Safari and Firefox MV3); a failure only keeps the old icon.
    Promise.resolve(action.setIcon({ path: toolbarIcons(enabled) })).catch(() => {});
    Promise.resolve(action.setTitle({ title: enabled ? name : `${name} (off)` })).catch(() => {});
  };

  const sync = () => store.get({ enabled: DEFAULTS.enabled }).then((saved) => show(saved.enabled), () => {});

  api.runtime.onStartup?.addListener(sync);
  api.runtime.onInstalled?.addListener(sync);
  api.storage.onChanged.addListener((changes, area) => {
    if ((area === 'sync' || area === 'local') && changes.enabled) show(changes.enabled.newValue);
  });
  sync(); // the worker or page also starts for other events; cheap, and covers a reload
})();
