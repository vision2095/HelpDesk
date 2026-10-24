'use strict';

let uio = null, Key = null, started = false;
let enabled = false, shift = false, caps = false;
let getWin = () => null;
let codeToName = new Map(), combos = new Map();

const NAME_TO_CHAR = {
  A:'a',B:'b',C:'c',D:'d',E:'e',F:'f',G:'g',H:'h',I:'i',J:'j',K:'k',L:'l',M:'m',
  N:'n',O:'o',P:'p',Q:'q',R:'r',S:'s',T:'t',U:'u',V:'v',W:'w',X:'x',Y:'y',Z:'z',
  '1':'1','2':'2','3':'3','4':'4','5':'5','6':'6','7':'7','8':'8','9':'9','0':'0',
  Space:' ', Minus:'-', Equal:'=', BracketLeft:'[', BracketRight:']', Backslash:'\\',
  Semicolon:';', Quote:"'", Backquote:'`', Comma:',', Period:'.', Slash:'/',
};
const NAME_TO_SHIFTED = {
  '1':'!','2':'@','3':'#','4':'$','5':'%','6':'^','7':'&','8':'*','9':'(','0':')',
  Minus:'_', Equal:'+', BracketLeft:'{', BracketRight:'}', Backslash:'|',
  Semicolon:':', Quote:'"', Backquote:'~', Comma:'<', Period:'>', Slash:'?',
};
const NAME_TO_ACTION = {
  Enter:'enter', NumpadEnter:'enter', Backspace:'backspace', Tab:'tab',
  Delete:'delete', Escape:'escape',
  ArrowLeft:'left', ArrowRight:'right', ArrowUp:'up', ArrowDown:'down',
};

function emit(p) { try { getWin()?.webContents?.send('gkey', p); } catch {} }

function signature(e) {
  const n = codeToName.get(e.keycode) || `K${e.keycode}`;
  return `${e.ctrlKey?'C':''}${e.shiftKey?'S':''}${e.altKey?'A':''}${e.metaKey?'M':''}+${n}`;
}

function normalizeAccel(accel) {
  const parts = accel.split('+').map(s => s.trim());
  const key = parts.pop();
  let sig = '';
  for (const p of parts) {
    const l = p.toLowerCase();
    if (l === 'control' || l === 'ctrl' || l === 'commandorcontrol' || l === 'cmdorctrl') sig += 'C';
    else if (l === 'shift') sig += 'S';
    else if (l === 'alt' || l === 'option') sig += 'A';
    else if (l === 'super' || l === 'meta' || l === 'command' || l === 'cmd') sig += 'M';
  }
  return `${sig}+${key.length === 1 ? key.toUpperCase() : key}`;
}

function onKeyDown(e) {
  const hit = combos.get(signature(e));
  if (hit) { hit(); return; }

  if (!enabled) return;
  const name = codeToName.get(e.keycode) || `K${e.keycode}`;

  if (name === 'Shift' || name === 'ShiftLeft' || name === 'ShiftRight') { shift = true; return; }
  if (name === 'CapsLock') { caps = !caps; return; }
  if (e.ctrlKey || e.altKey || e.metaKey) return;

  const base = NAME_TO_CHAR[name];
  if (base) {
    let text;
    if (/^[a-z]$/.test(base)) text = (shift !== caps) ? base.toUpperCase() : base;
    else if (shift && NAME_TO_SHIFTED[name]) text = NAME_TO_SHIFTED[name];
    else text = base;
    return emit({ type: 'char', text });
  }

  const action = NAME_TO_ACTION[name];
  if (action) emit({ type: 'action', action });
}

function onKeyUp(e) {
  const n = codeToName.get(e.keycode);
  if (n === 'Shift' || n === 'ShiftLeft' || n === 'ShiftRight') shift = false;
}

function start(opts = {}) {
  getWin = opts.getWindow || getWin;
  if (started) return true;
  try {
    const m = require('uiohook-napi');
    uio = m.uIOhook;
    Key = m.UiohookKey;
  } catch (e) {
    console.warn('[gkeys] uiohook unavailable:', e.message);
    return false;
  }
  try {
    for (const [n, c] of Object.entries(Key)) {
      if (typeof c === 'number' && !codeToName.has(c)) codeToName.set(c, n);
    }
    uio.on('keydown', onKeyDown);
    uio.on('keyup', onKeyUp);
    uio.start();
    started = true;
    return true;
  } catch (e) {
    console.warn('[gkeys] hook start failed:', e.message);
    uio = null;
    Key = null;
    return false;
  }
}

const stop = () => { try { uio?.stop(); } catch {} started = false; };
function rehook() {
  try { uio?.stop(); } catch {}
  try { uio?.start(); } catch {}
}
const setTyping = (v) => { enabled = !!v; shift = false; emit({ type: 'mode', typing: enabled }); };
const isTyping = () => enabled;
const isAvailable = () => started;
const registerCombo = (accel, fn) => combos.set(normalizeAccel(accel), fn);
const hasCombo = (accel) => combos.has(normalizeAccel(accel));
const clearCombos = () => combos.clear();

module.exports = { start, stop, rehook, setTyping, isTyping, isAvailable, registerCombo, hasCombo, clearCombos, normalizeAccel };
