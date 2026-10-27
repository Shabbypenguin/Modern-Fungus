/**
 * Interface size (text, buttons, panels) on top of the automatic viewport
 * scaling. Board zoom is separate and lives in the renderer's camera.
 */
import { load, save } from './storage';

export const UI_SCALES: { label: string; value: number }[] = [
  { label: 'Small', value: 0.85 },
  { label: 'Normal', value: 1 },
  { label: 'Large', value: 1.2 },
  { label: 'Larger', value: 1.4 },
];

export function initUiScale(): void {
  apply(load().uiScale);
}

export function setUiScale(v: number): void {
  apply(v);
  save({ ...load(), uiScale: v });
}

function apply(v: number): void {
  const ok = UI_SCALES.some((s) => s.value === v) ? v : 1;
  document.documentElement.style.setProperty('--zoom', String(ok));
}
