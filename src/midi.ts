import { File, Paths } from 'expo-file-system';

type MidiEvent =
  | { tick: number; order: number; kind: 'tempo'; microsecondsPerQuarter: number }
  | { tick: number; order: number; kind: 'noteOn'; channel: number; note: number; velocity: number }
  | { tick: number; order: number; kind: 'noteOff'; channel: number; note: number };

type MidiNote = {
  startSec: number;
  endSec: number;
  note: number;
  velocity: number;
};

type TempoPoint = {
  tick: number;
  seconds: number;
  microsecondsPerQuarter: number;
};

type ParsedMidi = {
  notes: MidiNote[];
  durationSec: number;
};

const MIDI_HEADER = 'MThd';
const MIDI_TRACK = 'MTrk';
const DEFAULT_TEMPO = 500000;
const SAMPLE_RATE = 22050;
const MAX_RENDER_SECONDS = 600;
const MAX_NOTE_COUNT = 6000;

export const isMidiFile = (name: string, mimeType?: string) => {
  const normalizedMimeType = mimeType?.toLowerCase() ?? '';
  return /\.(mid|midi)$/i.test(name) || normalizedMimeType === 'audio/mid' || normalizedMimeType === 'audio/midi' || normalizedMimeType === 'audio/x-midi' || normalizedMimeType === 'application/midi' || normalizedMimeType === 'application/x-midi';
};

export async function convertMidiToWav(uri: string, originalName: string) {
  const sourceFile = new File(uri);
  const sourceBytes = await sourceFile.bytes();
  const parsed = parseMidi(sourceBytes);
  const wavBytes = renderMidi(parsed);
  const outputFile = new File(Paths.document, `rhythm-midi-${Date.now()}.wav`);
  outputFile.create({ overwrite: true });
  outputFile.write(wavBytes);
  return {
    uri: outputFile.uri,
    name: `${originalName}（MIDI）`,
    durationSec: parsed.durationSec,
  };
}

function parseMidi(bytes: Uint8Array): ParsedMidi {
  if (readAscii(bytes, 0, 4) !== MIDI_HEADER) throw new Error('这不是有效的 MIDI 文件。');
  const headerLength = readUint32(bytes, 4);
  if (headerLength < 6 || bytes.length < 8 + headerLength) throw new Error('MIDI 文件头损坏。');
  const format = readUint16(bytes, 8);
  const trackCount = readUint16(bytes, 10);
  const division = readUint16(bytes, 12);
  if (format > 1) throw new Error('暂不支持这种 MIDI 格式，请使用 Type 0 或 Type 1 文件。');
  if (trackCount === 0) throw new Error('MIDI 文件没有可播放的音轨。');
  if ((division & 0x8000) !== 0 || division === 0) throw new Error('暂不支持 SMPTE 时间格式的 MIDI 文件。');

  const events: MidiEvent[] = [];
  let cursor = 8 + headerLength;
  let order = 0;
  let lastTick = 0;
  for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
    if (readAscii(bytes, cursor, 4) !== MIDI_TRACK) throw new Error('MIDI 音轨数据损坏。');
    const trackLength = readUint32(bytes, cursor + 4);
    const trackStart = cursor + 8;
    const trackEnd = trackStart + trackLength;
    if (trackEnd > bytes.length) throw new Error('MIDI 音轨超出文件范围。');
    let trackCursor = trackStart;
    let absoluteTick = 0;
    let runningStatus = 0;
    while (trackCursor < trackEnd) {
      const delta = readVariableLength(bytes, trackCursor);
      trackCursor = delta.nextOffset;
      absoluteTick += delta.value;
      lastTick = Math.max(lastTick, absoluteTick);
      if (trackCursor >= trackEnd) break;
      let status = bytes[trackCursor];
      if (status < 0x80) {
        if (runningStatus === 0) throw new Error('MIDI 运行状态数据损坏。');
        status = runningStatus;
      } else {
        trackCursor += 1;
        if (status < 0xf0) runningStatus = status;
      }

      if (status === 0xff) {
        runningStatus = 0;
        if (trackCursor >= trackEnd) break;
        const metaType = bytes[trackCursor];
        trackCursor += 1;
        const metaLength = readVariableLength(bytes, trackCursor);
        trackCursor = metaLength.nextOffset;
        if (trackCursor + metaLength.value > trackEnd) throw new Error('MIDI 元数据损坏。');
        if (metaType === 0x51 && metaLength.value === 3) {
          const microsecondsPerQuarter = (bytes[trackCursor] << 16) | (bytes[trackCursor + 1] << 8) | bytes[trackCursor + 2];
          events.push({ tick: absoluteTick, order, kind: 'tempo', microsecondsPerQuarter });
          order += 1;
        }
        trackCursor += metaLength.value;
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        runningStatus = 0;
        const sysexLength = readVariableLength(bytes, trackCursor);
        trackCursor = sysexLength.nextOffset + sysexLength.value;
        if (trackCursor > trackEnd) throw new Error('MIDI 系统独占数据损坏。');
        continue;
      }

      if (status >= 0xf1) {
        const systemDataLength = status === 0xf1 || status === 0xf3 ? 1 : status === 0xf2 ? 2 : 0;
        trackCursor += systemDataLength;
        if (trackCursor > trackEnd) throw new Error('MIDI 系统消息数据损坏。');
        continue;
      }

      const eventType = status & 0xf0;
      const channel = status & 0x0f;
      const dataLength = eventType === 0xc0 || eventType === 0xd0 ? 1 : 2;
      if (trackCursor + dataLength > trackEnd) throw new Error('MIDI 事件数据损坏。');
      const firstData = bytes[trackCursor];
      const secondData = dataLength === 2 ? bytes[trackCursor + 1] : 0;
      trackCursor += dataLength;
      if (eventType === 0x90 && secondData > 0) {
        events.push({ tick: absoluteTick, order, kind: 'noteOn', channel, note: firstData, velocity: secondData });
        order += 1;
      } else if (eventType === 0x80 || (eventType === 0x90 && secondData === 0)) {
        events.push({ tick: absoluteTick, order, kind: 'noteOff', channel, note: firstData });
        order += 1;
      }
    }
    cursor = trackEnd;
  }

  const sortedEvents = events.slice().sort((left, right) => left.tick - right.tick || left.order - right.order);
  const tempoPoints = buildTempoPoints(sortedEvents, division);
  const activeNotes = new Map<string, Array<{ tick: number; velocity: number }>>();
  const notes: MidiNote[] = [];
  for (const event of sortedEvents) {
    if (event.kind === 'noteOn') {
      const key = `${event.channel}:${event.note}`;
      const queuedNotes = activeNotes.get(key) ?? [];
      queuedNotes.push({ tick: event.tick, velocity: event.velocity });
      activeNotes.set(key, queuedNotes);
      continue;
    }
    if (event.kind !== 'noteOff') continue;
    const key = `${event.channel}:${event.note}`;
    const queuedNotes = activeNotes.get(key);
    const noteStart = queuedNotes?.pop();
    if (!noteStart) continue;
    notes.push({ startSec: tickToSeconds(noteStart.tick, tempoPoints, division), endSec: tickToSeconds(Math.max(event.tick, noteStart.tick + 1), tempoPoints, division), note: event.note, velocity: noteStart.velocity });
    if (queuedNotes && queuedNotes.length === 0) activeNotes.delete(key);
  }
  for (const [key, queuedNotes] of activeNotes) {
    const noteNumber = Number(key.split(':')[1]);
    for (const noteStart of queuedNotes) {
      notes.push({ startSec: tickToSeconds(noteStart.tick, tempoPoints, division), endSec: tickToSeconds(Math.max(lastTick, noteStart.tick + 1), tempoPoints, division), note: noteNumber, velocity: noteStart.velocity });
    }
  }
  if (notes.length === 0) throw new Error('MIDI 文件中没有可播放的音符。');
  if (notes.length > MAX_NOTE_COUNT) throw new Error('MIDI 音符数量过多，暂时无法在手机上转换。');
  const durationSec = Math.min(MAX_RENDER_SECONDS, Math.max(...notes.map((note) => note.endSec)) + 0.25);
  if (durationSec >= MAX_RENDER_SECONDS) throw new Error('MIDI 文件过长，请选择 10 分钟以内的文件。');
  return { notes, durationSec };
}

function buildTempoPoints(events: MidiEvent[], division: number) {
  const tempoEvents = events.filter((event): event is Extract<MidiEvent, { kind: 'tempo' }> => event.kind === 'tempo');
  const points: TempoPoint[] = [{ tick: 0, seconds: 0, microsecondsPerQuarter: DEFAULT_TEMPO }];
  let previousTick = 0;
  let previousSeconds = 0;
  let previousTempo = DEFAULT_TEMPO;
  for (const tempoEvent of tempoEvents) {
    const elapsedSeconds = (tempoEvent.tick - previousTick) * previousTempo / division / 1000000;
    previousSeconds += elapsedSeconds;
    previousTick = tempoEvent.tick;
    previousTempo = tempoEvent.microsecondsPerQuarter;
    points.push({ tick: tempoEvent.tick, seconds: previousSeconds, microsecondsPerQuarter: previousTempo });
  }
  return points;
}

function tickToSeconds(tick: number, tempoPoints: TempoPoint[], division: number) {
  let selectedPoint = tempoPoints[0];
  for (const tempoPoint of tempoPoints) {
    if (tempoPoint.tick > tick) break;
    selectedPoint = tempoPoint;
  }
  return selectedPoint.seconds + (tick - selectedPoint.tick) * selectedPoint.microsecondsPerQuarter / division / 1000000;
}

function renderMidi(parsed: ParsedMidi) {
  const totalSamples = Math.ceil(parsed.durationSec * SAMPLE_RATE);
  const samples = new Float32Array(totalSamples);
  for (const note of parsed.notes) {
    const startSample = Math.max(0, Math.floor(note.startSec * SAMPLE_RATE));
    const endSample = Math.min(totalSamples, Math.ceil(note.endSec * SAMPLE_RATE));
    const frequency = 440 * Math.pow(2, (note.note - 69) / 12);
    const amplitude = (note.velocity / 127) * 0.16;
    for (let sampleIndex = startSample; sampleIndex < endSample; sampleIndex += 1) {
      const elapsed = (sampleIndex - startSample) / SAMPLE_RATE;
      const noteDuration = Math.max(0.02, note.endSec - note.startSec);
      const remaining = noteDuration - elapsed;
      const attack = Math.min(1, elapsed / 0.015);
      const release = Math.min(1, remaining / 0.12);
      const envelope = Math.min(attack, release);
      const phase = 2 * Math.PI * frequency * elapsed;
      const tone = Math.sin(phase) * 0.78 + Math.sin(phase * 2) * 0.16 + Math.sin(phase * 3) * 0.06;
      samples[sampleIndex] += tone * amplitude * envelope;
    }
  }

  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const normalization = peak > 0.92 ? 0.92 / peak : 1;
  const wavBytes = new Uint8Array(44 + totalSamples * 2);
  const dataView = new DataView(wavBytes.buffer);
  writeAscii(wavBytes, 0, 'RIFF');
  dataView.setUint32(4, 36 + totalSamples * 2, true);
  writeAscii(wavBytes, 8, 'WAVE');
  writeAscii(wavBytes, 12, 'fmt ');
  dataView.setUint32(16, 16, true);
  dataView.setUint16(20, 1, true);
  dataView.setUint16(22, 1, true);
  dataView.setUint32(24, SAMPLE_RATE, true);
  dataView.setUint32(28, SAMPLE_RATE * 2, true);
  dataView.setUint16(32, 2, true);
  dataView.setUint16(34, 16, true);
  writeAscii(wavBytes, 36, 'data');
  dataView.setUint32(40, totalSamples * 2, true);
  for (let sampleIndex = 0; sampleIndex < totalSamples; sampleIndex += 1) {
    const fadeOut = sampleIndex > totalSamples - SAMPLE_RATE / 10 ? Math.max(0, (totalSamples - sampleIndex) / (SAMPLE_RATE / 10)) : 1;
    const pcmValue = Math.max(-1, Math.min(1, samples[sampleIndex] * normalization * fadeOut));
    dataView.setInt16(44 + sampleIndex * 2, Math.round(pcmValue * 32767), true);
  }
  return wavBytes;
}

function readAscii(bytes: Uint8Array, offset: number, length: number) {
  let value = '';
  for (let characterIndex = 0; characterIndex < length; characterIndex += 1) value += String.fromCharCode(bytes[offset + characterIndex]);
  return value;
}

function readUint16(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32(bytes: Uint8Array, offset: number) {
  return bytes[offset] * 0x1000000 + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function readVariableLength(bytes: Uint8Array, offset: number) {
  let value = 0;
  let nextOffset = offset;
  for (let valueIndex = 0; valueIndex < 4; valueIndex += 1) {
    if (nextOffset >= bytes.length) throw new Error('MIDI 可变长度数据损坏。');
    const currentByte = bytes[nextOffset];
    nextOffset += 1;
    value = (value << 7) | (currentByte & 0x7f);
    if ((currentByte & 0x80) === 0) return { value, nextOffset };
  }
  throw new Error('MIDI 可变长度数据过长。');
}

function writeAscii(bytes: Uint8Array, offset: number, value: string) {
  for (let characterIndex = 0; characterIndex < value.length; characterIndex += 1) bytes[offset + characterIndex] = value.charCodeAt(characterIndex);
}
