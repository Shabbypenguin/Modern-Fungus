/**
 * Interface zoom on top of the automatic viewport scaling. Stored per device.
 * Mouse wheel (in game) and + / − / 0 keys (anywhere) change it.
 */
import { load, save } from './storage';

export const ZOOM_MIN = 0.7;
export const ZOOM_MAX = 1.8;
const STEP = 0.1;

let zoom = 1;
let toast: HTMLElement | null = null;
let toastTimer = 0;

export function initZoom(): void {
  zoom = clamp(load().zoom);
  apply(false);
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '+' || e.key === '=') changeZoom(1);
    else if (e.key === '-' || e.key === '_') changeZoom(-1);
    else if (e.key === '0') setZoom(1);
  });
}

export function changeZoom(dir: 1 | -1): void {
  setZoom(zoom + dir * STEP);
}

export function setZoom(z: number): void {
  const next = clamp(z);
  if (next === zoom) return showToast();
  zoom = next;
  apply(true);
  try {
    save({ ...load(), zoom });
  } catch {
    /* ignore */
  }
}

function clamp(z: number): number {
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number.isFinite(z) ? z : 1)) * 10) / 10;
}

function apply(announce: boolean): void {
  document.documentElement.style.setProperty('--zoom', String(zoom));
  if (announce) showToast();
}

function showToast(): void {
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    document.body.append(toast);
  }
  toast.textContent = `Zoom ${Math.round(zoom * 100)}%`;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast && (toast.hidden = true), 1100);
}
