/**
 * Mic audio recorder for replay testing.
 * Collects timestamped base64 PCM chunks during a live session.
 */

export interface RecordedChunk {
  ts: number;   // ms since recording start
  data: string; // base64 PCM
}

export interface Recording {
  chunks: RecordedChunk[];
  sampleRate: number;
}

export interface RecorderHandle {
  feed: (base64: string) => void;
  stop: () => Recording;
  download: (filename?: string) => void;
}

export function createRecorder(sampleRate = 16000): RecorderHandle {
  const chunks: RecordedChunk[] = [];
  const startTime = Date.now();

  return {
    feed(base64: string) {
      chunks.push({ ts: Date.now() - startTime, data: base64 });
    },

    stop(): Recording {
      return { chunks: [...chunks], sampleRate };
    },

    download(filename = 'recording.json') {
      const recording: Recording = { chunks, sampleRate };
      const blob = new Blob([JSON.stringify(recording)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
  };
}
