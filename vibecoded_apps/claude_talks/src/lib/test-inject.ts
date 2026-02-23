/**
 * Audio injection for E2E testing (Chrome MCP).
 * Overrides getUserMedia with a fake stream, then injects audio into it.
 *
 * Not imported by production code. Dynamically imported via:
 *   const { setup, inject, listReplays, injectFromDB } = await import('/src/lib/test-inject.ts');
 *
 * Usage:
 *   Step 1 (before clicking Start):
 *     setup();
 *
 *   Step 2 (after connection) — replay from IndexedDB:
 *     const replays = await listReplays();  // see available recordings
 *     await injectFromDB(0);                // inject first recording
 *
 *   Step 2 (after connection) — TTS alternative:
 *     const { speak } = await import('/src/lib/tts.ts');
 *     const key = JSON.parse(localStorage.getItem('claude-talks:ui') || '{}').apiKey;
 *     inject((await speak(key, 'Say naturally: <prompt> OVER')).data, 24000);
 */

const WIN = window as unknown as Record<string, unknown>;
const CTX_KEY = '__testAudioCtx';
const DEST_KEY = '__testAudioDest';

/** Override getUserMedia with a fake silent stream. Idempotent. */
export function setup(): void {
  if (WIN[CTX_KEY]) {
    console.log('[test] already set up');
    return;
  }
  const ctx = new AudioContext({ sampleRate: 16000 });
  const dest = ctx.createMediaStreamDestination();
  const osc = ctx.createOscillator();
  osc.frequency.value = 0;
  osc.connect(dest);
  osc.start();

  WIN[CTX_KEY] = ctx;
  WIN[DEST_KEY] = dest;

  navigator.mediaDevices.getUserMedia = async () => {
    console.log('[test] getUserMedia intercepted');
    await ctx.resume();
    return dest.stream;
  };
  console.warn(
    '%c[test] getUserMedia OVERRIDDEN — real mic is disabled. Refresh page to restore.',
    'background:red;color:white;font-weight:bold;padding:2px 8px;border-radius:3px;font-size:14px',
  );
}

/** Decode base64 PCM (int16) to Float32Array. */
function decodeBase64PCM(base64pcm: string): Float32Array {
  const binary = atob(base64pcm);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
  return float32;
}

/** Resample audio to target rate using OfflineAudioContext. */
async function resample(samples: Float32Array, fromRate: number, toRate: number): Promise<Float32Array> {
  const duration = samples.length / fromRate;
  const offCtx = new OfflineAudioContext(1, Math.ceil(duration * toRate), toRate);
  const buf = offCtx.createBuffer(1, samples.length, fromRate);
  buf.getChannelData(0).set(samples);
  const src = offCtx.createBufferSource();
  src.buffer = buf;
  src.connect(offCtx.destination);
  src.start();
  const rendered = await offCtx.startRendering();
  return rendered.getChannelData(0);
}

/**
 * Push base64 PCM audio into the fake mic stream.
 * Auto-resamples to 16kHz if sampleRate differs (e.g. 24kHz TTS output).
 */
export async function inject(base64pcm: string, sampleRate: number): Promise<void> {
  const ctx = WIN[CTX_KEY] as AudioContext | undefined;
  const dest = WIN[DEST_KEY] as MediaStreamAudioDestinationNode | undefined;
  if (!ctx || !dest) throw new Error('call setup() first');

  let float32 = decodeBase64PCM(base64pcm);
  const targetRate = ctx.sampleRate; // 16000

  if (sampleRate !== targetRate) {
    console.log(`[test] resampling ${sampleRate}Hz → ${targetRate}Hz`);
    float32 = await resample(float32, sampleRate, targetRate);
  }

  const buffer = ctx.createBuffer(1, float32.length, targetRate);
  buffer.getChannelData(0).set(float32);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(dest);
  source.start();
  console.log(`[test] injected ${float32.length} samples at ${targetRate}Hz (${(float32.length / targetRate).toFixed(1)}s)`);
}

/** List available recordings from IndexedDB. */
export async function listReplays(): Promise<{ index: number; transcript: string; chunks: number }[]> {
  const { getAllRecordings } = await import('./recording-db');
  const recordings = await getAllRecordings();
  return recordings.map((r, i) => ({ index: i, transcript: r.transcript, chunks: r.chunks.length }));
}

/** Inject a recorded utterance from IndexedDB into the fake mic stream. */
export async function injectFromDB(index = 0): Promise<string> {
  const { getAllRecordings } = await import('./recording-db');
  const { combineChunks } = await import('./stt');
  const recordings = await getAllRecordings();
  const rec = recordings[index];
  if (!rec) throw new Error(`No recording at index ${index}`);
  await inject(combineChunks(rec.chunks), 16000);
  return rec.transcript;
}
