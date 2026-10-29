'use strict';

const TOPMOST_LEVEL = 'screen-saver';

function applyStealthFlags(win, opts = {}) {
  const platform = opts.platform || process.platform;
  const stealth = opts.stealth !== false;
  const clickThrough = opts.clickThrough === true;

  if (!win || (win.isDestroyed && win.isDestroyed())) return [];

  const applied = [];
  const call = (name, ...args) => {
    try {
      if (typeof win[name] === 'function') { win[name](...args); applied.push(name); }
    } catch {}
  };

  call('setAlwaysOnTop', true, TOPMOST_LEVEL);
  call('setVisibleOnAllWorkspaces', true, { visibleOnFullScreen: true });
  call('setSkipTaskbar', true);
  call('setContentProtection', stealth);
  call('setIgnoreMouseEvents', clickThrough, { forward: true });
  call('setTitle', '');
  // The single floating window must remain focusable: sign-in, the composer
  // and the settings modal are all keyboard surfaces. Click-through remains a
  // separate, user-controlled mode.
  call('setFocusable', true);
  if (platform === 'darwin') call('setWindowButtonVisibility', false);

  return applied;
}

module.exports = { TOPMOST_LEVEL, applyStealthFlags };
