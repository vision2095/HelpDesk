'use strict';

const path = require('path');
const fs = require('fs');

function tryLoad(p) {
  try {
    if (fs.existsSync(p)) return require(p);
  } catch {}
  try {
    const unpacked = p.replace('app.asar', 'app.asar.unpacked');
    if (unpacked !== p && fs.existsSync(unpacked)) return require(unpacked);
  } catch {}
  return null;
}

let mod =
  tryLoad(path.join(__dirname, 'prebuilt', `${process.platform}-${process.arch}`, 'win_diagnostic.node')) ||
  tryLoad(path.join(__dirname, '..', 'build', 'Release', 'win_diagnostic.node')) ||
  tryLoad(path.join(__dirname, 'build', 'Release', 'win_diagnostic.node'));

const available = !!mod;

function info() {
  if (!mod || typeof mod.info !== 'function') return { available: false, arch: process.arch, reason: 'addon not loaded' };
  try { return mod.info(); } catch (e) { return { available: false, arch: process.arch, error: e.message }; }
}

function getForegroundInfo() {
  if (!mod || typeof mod.getForegroundInfo !== 'function') return { hwnd: '0', pid: 0, threadId: 0, isCurrentProcess: false };
  try { return mod.getForegroundInfo(); } catch { return { hwnd: '0', pid: 0, threadId: 0, isCurrentProcess: false }; }
}

function activateWindow(hwnd) {
  if (!mod || typeof mod.activateWindow !== 'function') return false;
  try { return mod.activateWindow(hwnd); } catch { return false; }
}

function setAlwaysOnTop(hwnd, isTopmost) {
  if (!mod || typeof mod.setAlwaysOnTop !== 'function') return false;
  try { return mod.setAlwaysOnTop(hwnd, isTopmost); } catch { return false; }
}

function setWindowStyles(hwnd, removeMask, addMask) {
  if (!mod || typeof mod.setWindowStyles !== 'function') return null;
  try { return mod.setWindowStyles(hwnd, removeMask, addMask); } catch { return null; }
}

function setCaptureAffinity(hwnd, enable) {
  if (!mod || typeof mod.setCaptureAffinity !== 'function') return false;
  try { return mod.setCaptureAffinity(hwnd, enable); } catch { return false; }
}

function getCaptureAffinity(hwnd) {
  if (!mod || typeof mod.getCaptureAffinity !== 'function') return null;
  try { return mod.getCaptureAffinity(hwnd); } catch { return null; }
}

function getFocusDiagnostics(hwnd) {
  if (!mod || typeof mod.getFocusDiagnostics !== 'function') return { ok: false, isTargetForeground: false, isTargetActive: false, isTargetFocused: false };
  try { return mod.getFocusDiagnostics(hwnd); } catch { return { ok: false, isTargetForeground: false, isTargetActive: false, isTargetFocused: false }; }
}

function safeAutoType(targetHwnd, text, delayMs) {
  if (!mod || typeof mod.safeAutoType !== 'function') throw new Error('Native autoType not available');
  return mod.safeAutoType(targetHwnd, text, delayMs);
}

function optimizeWorkingSet() {
  if (!mod || typeof mod.optimizeWorkingSet !== 'function') return { ok: false };
  try { return mod.optimizeWorkingSet(); } catch { return { ok: false }; }
}

function isElevatedAdmin() {
  if (!mod || typeof mod.isElevatedAdmin !== 'function') return { isElevated: false, integrityLevel: 0 };
  try { return mod.isElevatedAdmin(); } catch { return { isElevated: false, integrityLevel: 0 }; }
}

function configureUIPIFilters(hwnd) {
  if (!mod || typeof mod.configureUIPIFilters !== 'function') return false;
  try { return mod.configureUIPIFilters(hwnd); } catch { return false; }
}

function setOverlayClickThrough(hwnd, enable) {
  if (!mod || typeof mod.setOverlayClickThrough !== 'function') return false;
  try { return mod.setOverlayClickThrough(hwnd, enable); } catch { return false; }
}

function sendHardwareScancode(vk, holdMs) {
  if (!mod || typeof mod.sendHardwareScancode !== 'function') return false;
  try { return mod.sendHardwareScancode(vk, holdMs); } catch { return false; }
}

function postBackgroundMessage(hwnd, msg, wParam, lParam) {
  if (!mod || typeof mod.postBackgroundMessage !== 'function') return false;
  try { return mod.postBackgroundMessage(hwnd, msg, wParam, lParam); } catch { return false; }
}

function sendCaretNudge() {
  if (!mod || typeof mod.sendCaretNudge !== 'function') return false;
  try { return mod.sendCaretNudge(); } catch { return false; }
}

function getInputDesktopInfo() {
  if (!mod || typeof mod.getInputDesktopInfo !== 'function') return { ok: true, desktop: 'Default', isDefault: true };
  try { return mod.getInputDesktopInfo(); } catch { return { ok: true, desktop: 'Default', isDefault: true }; }
}

function isWindowFullscreen(hwnd) {
  if (!mod || typeof mod.isWindowFullscreen !== 'function') return { ok: true, isFullscreen: false };
  try { return mod.isWindowFullscreen(hwnd); } catch { return { ok: true, isFullscreen: false }; }
}

function initDpiAwareness() {
  if (!mod || typeof mod.initDpiAwareness !== 'function') return false;
  try { return mod.initDpiAwareness(); } catch { return false; }
}

function startForegroundHook() {
  if (!mod || typeof mod.startForegroundHook !== 'function') return false;
  try { return mod.startForegroundHook(); } catch { return false; }
}

function stopForegroundHook() {
  if (!mod || typeof mod.stopForegroundHook !== 'function') return false;
  try { return mod.stopForegroundHook(); } catch { return false; }
}

function getLastForegroundHwnd() {
  if (!mod || typeof mod.getLastForegroundHwnd !== 'function') return '0';
  try { return mod.getLastForegroundHwnd(); } catch { return '0'; }
}

function sendNativePaste() {
  if (!mod || typeof mod.sendNativePaste !== 'function') return false;
  try { return mod.sendNativePaste(); } catch { return false; }
}

function isAnyModifierDown() {
  if (!mod || typeof mod.isAnyModifierDown !== 'function') return false;
  try { return mod.isAnyModifierDown(); } catch { return false; }
}

function isSameApplication(pid1, pid2) {
  if (!mod || typeof mod.isSameApplication !== 'function') return Number.isInteger(pid1) && Number.isInteger(pid2) && pid1 > 0 && pid1 === pid2;
  try { return mod.isSameApplication(pid1, pid2); } catch { return false; }
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
  getInputDesktopInfo,
  isWindowFullscreen,
  initDpiAwareness,
  startForegroundHook,
  stopForegroundHook,
  getLastForegroundHwnd,
  sendNativePaste,
  isAnyModifierDown,
  isSameApplication,
};
