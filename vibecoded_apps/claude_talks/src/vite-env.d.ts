/// <reference types="vite/client" />

// Web Speech API — not in DOM lib (tsconfig targets es2017, no DOM)
interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly [index: number]: { readonly transcript: string };
}

interface SpeechRecognitionEvent extends Event {
  readonly results: { readonly length: number; readonly [index: number]: SpeechRecognitionResult };
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

declare var webkitSpeechRecognition: { new (): SpeechRecognition } | undefined;
