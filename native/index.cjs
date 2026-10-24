'use strict';

const path = require('path');
const fs = require('fs');

function tryLoad(p) {
  try { return fs.existsSync(p) ? require(p) : null; } catch { return null; }
}

let mod =
  tryLoad(path.join(__dirname, 'prebuilt', `${process.platform}-${process.arch}`, 'win_diagnostic.node')) ||
  tryLoad(path.join(__dirname, '..', 'build', 'Release', 'win_diagnostic.node'));

const available = !!mod;

function info() {
  if (!mod) return { available: false, arch: process.arch, reason: 'addon not loaded' };
  return mod.info();
}

function getForegroundInfo() {
  if (!mod) return { hwnd: '0', pid: 0, threadId: 0, isCurrentProcess: false };
  return mod.getForegroundInfo();
}

function activateWindow(hwnd) {
  if (!mod) return false;
  return mod.activateWindow(hwnd);
}

function setAlwaysOnTop(hwnd, isTopmost) {
  if (!mod) return false;
  return mod.setAlwaysOnTop(hwnd, isTopmost);
}

function setWindowStyles(hwnd, removeMask, addMask) {
  if (!mod) return null;
  return mod.setWindowStyles(hwnd, removeMask, addMask);
}

function setCaptureAffinity(hwnd, enable) {
  if (!mod) return false;
  return mod.setCaptureAffinity(hwnd, enable);
}

function getCaptureAffinity(hwnd) {
  if (!mod) return null;
  return mod.getCaptureAffinity(hwnd);
}

function getFocusDiagnostics(hwnd) {
  if (!mod) return { ok: false, isTargetForeground: false, isTargetActive: false, isTargetFocused: false };
  return mod.getFocusDiagnostics(hwnd);
}

function safeAutoType(targetHwnd, text, delayMs) {
  if (!mod) throw new Error('Native autoType not available');
  return mod.safeAutoType(targetHwnd, text, delayMs);
}

module.exports = {
  available,
  info,
  getForegroundInfo,
  activateWindow,
  setAlwaysOnTop,
  setWindowStyles,
  setCaptureAffinity,
  getCaptureAffinity,
  getFocusDiagnostics,
  safeAutoType,
};
