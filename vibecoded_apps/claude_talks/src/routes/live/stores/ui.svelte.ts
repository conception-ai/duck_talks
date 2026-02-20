/**
 * UI store — screen state owned by UI components.
 * Distinct from core app data (stores/data).
 * Can persist across sessions (e.g. user preferences).
 * Grows as UI complexity grows.
 */

import type { InteractionMode } from '../types';
import { DEFAULT_MODEL, DEFAULT_SYSTEM_PROMPT } from '../defaults';

const STORAGE_KEY = 'claude-talks:ui';

interface Persisted {
  voiceEnabled: boolean;
  apiKey: string | null;
  mode: InteractionMode;
  pttMode: boolean;
  model: string;
  systemPrompt: string;
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migrate old learningMode boolean → mode enum
      if ('learningMode' in parsed && !('mode' in parsed)) {
        return { ...parsed, mode: parsed.learningMode ? 'review' : 'direct' };
      }
      return parsed;
    }
  } catch { /* corrupted — fall through to default */ }
  return { voiceEnabled: true, apiKey: null, mode: 'direct', pttMode: false,
           model: DEFAULT_MODEL, systemPrompt: DEFAULT_SYSTEM_PROMPT };
}

function save(state: Persisted) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function createUIStore() {
  const persisted = load();
  let voiceEnabled = $state(persisted.voiceEnabled);
  let apiKey = $state<string | null>(persisted.apiKey);
  let apiKeyModalOpen = $state(!apiKey);
  let mode = $state<InteractionMode>(persisted.mode);
  let pttMode = $state(persisted.pttMode);
  let model = $state(persisted.model);
  let systemPrompt = $state(persisted.systemPrompt);

  function persist() {
    save({ voiceEnabled, apiKey, mode, pttMode, model, systemPrompt });
  }

  function toggleVoice() {
    voiceEnabled = !voiceEnabled;
    persist();
  }

  const MODE_CYCLE: InteractionMode[] = ['direct', 'review', 'correct'];

  function cycleMode() {
    const i = MODE_CYCLE.indexOf(mode);
    mode = MODE_CYCLE[(i + 1) % MODE_CYCLE.length];
    persist();
  }

  function togglePttMode() {
    pttMode = !pttMode;
    persist();
  }

  function setApiKey(key: string) {
    const trimmed = key.trim();
    if (!trimmed) return;
    apiKey = trimmed;
    apiKeyModalOpen = false;
    persist();
  }

  function openApiKeyModal() {
    apiKeyModalOpen = true;
  }

  function closeApiKeyModal() {
    apiKeyModalOpen = false;
  }

  return {
    get voiceEnabled() { return voiceEnabled; },
    get apiKey() { return apiKey; },
    get apiKeyModalOpen() { return apiKeyModalOpen; },
    get mode() { return mode; },
    get pttMode() { return pttMode; },
    toggleVoice,
    cycleMode,
    togglePttMode,
    setApiKey,
    openApiKeyModal,
    closeApiKeyModal,
    get model() { return model; },
    get systemPrompt() { return systemPrompt; },
    setModel(m: string) { model = m; persist(); },
    setSystemPrompt(p: string) { systemPrompt = p; persist(); },
    resetSystemPrompt() { systemPrompt = DEFAULT_SYSTEM_PROMPT; persist(); },
  };
}
