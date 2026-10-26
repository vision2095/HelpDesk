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

function optimizeWorkingSet() {
  if (!mod || typeof mod.optimizeWorkingSet !== 'function') return { ok: false };
  return mod.optimizeWorkingSet();
}

function isElevatedAdmin() {
  if (!mod || typeof mod.isElevatedAdmin !== 'function') return { isElevated: false, integrityLevel: 0 };
  return mod.isElevatedAdmin();
}

function configureUIPIFilters(hwnd) {
  if (!mod || typeof mod.configureUIPIFilters !== 'function') return false;
  return mod.configureUIPIFilters(hwnd);
}

function setOverlayClickThrough(hwnd, enable) {
  if (!mod || typeof mod.setOverlayClickThrough !== 'function') return false;
  return mod.setOverlayClickThrough(hwnd, enable);
}

function sendHardwareScancode(vk, holdMs) {
  if (!mod || typeof mod.sendHardwareScancode !== 'function') return false;
  return mod.sendHardwareScancode(vk, holdMs);
}

function postBackgroundMessage(hwnd, msg, wParam, lParam) {
  if (!mod || typeof mod.postBackgroundMessage !== 'function') return false;
  return mod.postBackgroundMessage(hwnd, msg, wParam, lParam);
}

function sendCaretNudge() {
  if (!mod || typeof mod.sendCaretNudge !== 'function') return false;
  return mod.sendCaretNudge();
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
  optimizeWorkingSet,
  isElevatedAdmin,
  configureUIPIFilters,
  setOverlayClickThrough,
  sendHardwareScancode,
  postBackgroundMessage,
  sendCaretNudge,
};
