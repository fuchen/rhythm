import { File, Paths } from 'expo-file-system';

const SAMPLE_RATE = 22050;
const TICK_DURATION_SECONDS = 0.08;
const TICK_INTERVAL_SECONDS = 1;
const TICK_FREQUENCY = 880;
const TICK_FILE_NAME = 'rhythm-tick-loop-v2.wav';

let tickSoundPromise: Promise<string> | null = null;

export function ensureTickSoundAsync() {
  if (!tickSoundPromise) tickSoundPromise = createTickSoundAsync();
  return tickSoundPromise;
}

async function createTickSoundAsync() {
  const tickFile = new File(Paths.cache, TICK_FILE_NAME);
  if (!tickFile.exists) {
    tickFile.create({ overwrite: true });
    tickFile.write(createTickWav());
  }
  return tickFile.uri;
}

function createTickWav() {
  const sampleCount = Math.ceil(SAMPLE_RATE * TICK_INTERVAL_SECONDS);
  const bytes = new Uint8Array(44 + sampleCount * 2);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, 'RIFF');
  view.setUint32(4, 36 + sampleCount * 2, true);
  writeAscii(bytes, 8, 'WAVE');
  writeAscii(bytes, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(bytes, 36, 'data');
  view.setUint32(40, sampleCount * 2, true);
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const elapsedSeconds = sampleIndex / SAMPLE_RATE;
    const tickElapsedSeconds = elapsedSeconds % TICK_INTERVAL_SECONDS;
    const fadeOut = 1 - tickElapsedSeconds / TICK_DURATION_SECONDS;
    const sample = tickElapsedSeconds < TICK_DURATION_SECONDS
      ? Math.sin(2 * Math.PI * TICK_FREQUENCY * tickElapsedSeconds) * 0.38 * Math.max(0, fadeOut)
      : 0;
    view.setInt16(44 + sampleIndex * 2, Math.round(sample * 32767), true);
  }
  return bytes;
}

function writeAscii(bytes: Uint8Array, offset: number, value: string) {
  for (let characterIndex = 0; characterIndex < value.length; characterIndex += 1) bytes[offset + characterIndex] = value.charCodeAt(characterIndex);
}
