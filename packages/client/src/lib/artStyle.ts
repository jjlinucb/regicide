import { useSyncExternalStore } from 'react';

export type ArtStyle = 'classic' | 'anime';

const STORAGE_KEY = 'regicide-art-style';

function readStored(): ArtStyle {
  if (typeof window === 'undefined') return 'classic';
  return window.localStorage.getItem(STORAGE_KEY) === 'anime' ? 'anime' : 'classic';
}

let current: ArtStyle = readStored();
const listeners = new Set<() => void>();

function setStyle(style: ArtStyle) {
  current = style;
  window.localStorage.setItem(STORAGE_KEY, style);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Global, localStorage-backed toggle between the default painted-fantasy art and the alternate anime-styled art.
 * A module-level store (not per-component state) so every component sharing this hook re-renders in sync when it flips. */
export function useArtStyle(): [ArtStyle, () => void] {
  const style = useSyncExternalStore(subscribe, () => current);
  const toggle = () => setStyle(current === 'classic' ? 'anime' : 'classic');
  return [style, toggle];
}
