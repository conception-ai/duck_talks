/**
 * Corrections store — persisted text pairs (original → corrected).
 * Same localStorage pattern as ui.svelte.ts.
 */

import type { Correction } from '../types';

const STORAGE_KEY = 'duck_talk:corrections';
const OLD_STORAGE_KEY = 'claude-talks:corrections';

function load(): Correction[] {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    // Migrate from old key
    if (!raw) {
      raw = localStorage.getItem(OLD_STORAGE_KEY);
      if (raw) {
        localStorage.setItem(STORAGE_KEY, raw);
        localStorage.removeItem(OLD_STORAGE_KEY);
      }
    }
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const list: Record<string, unknown>[] = parsed.corrections ?? parsed;
    if (!Array.isArray(list)) return [];
    // Migrate old STTCorrection format (heard/meant → original/corrected)
    return list.map((c) => ({
      id: (c.id as string) ?? crypto.randomUUID(),
      original: (c.heard ?? c.original ?? '') as string,
      corrected: (c.meant ?? c.corrected ?? '') as string,
    }));
  } catch { return []; }
}

function save(corrections: Correction[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ corrections }));
}

export function createCorrectionsStore() {
  let corrections = $state<Correction[]>(load());

  return {
    get corrections() { return corrections; },
    add(original: string, corrected: string) {
      corrections.push({ id: crypto.randomUUID(), original, corrected });
      save(corrections);
    },
    remove(id: string) {
      corrections = corrections.filter((c) => c.id !== id);
      save(corrections);
    },
  };
}
