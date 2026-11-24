import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { applySoftTimeFitToTrackClips } from '../src/components/timing/timing.edgeRules.service';
import type { AudioClip, SubtitleLine } from '../src/components/timing/timing.types';

const require = createRequire(import.meta.url);
const AutoTimingService = require('../electron/services/AutoTimingService.cjs');

function writeWav16(
  filePath: string,
  sampleRate: number,
  channels: number,
  samples: Int16Array
): void {
  const dataBytes = samples.length * 2;
  const header = AutoTimingService.createWavHeader(dataBytes, sampleRate, channels, 16);
  const pcm = Buffer.alloc(dataBytes);
  for (let i = 0; i < samples.length; i++) {
    pcm.writeInt16LE(samples[i], i * 2);
  }
  fs.writeFileSync(filePath, Buffer.concat([header, pcm]));
}

function writeWav24(
  filePath: string,
  sampleRate: number,
  channels: number,
  floatSamples: Float32Array
): void {
  const dataBytes = floatSamples.length * 3;
  const header = AutoTimingService.createWavHeader(dataBytes, sampleRate, channels, 24);
  const pcm = Buffer.alloc(dataBytes);
  for (let i = 0; i < floatSamples.length; i++) {
    const val = Math.max(-8388608, Math.min(8388607, Math.round(floatSamples[i] * 8388608.0)));
    const off = i * 3;
    pcm[off] = val & 0xff;
    pcm[off + 1] = (val >> 8) & 0xff;
    pcm[off + 2] = (val >> 16) & 0xff;
  }
  fs.writeFileSync(filePath, Buffer.concat([header, pcm]));
}

function readWavHeader(filePath: string): {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  dataOffset: number;
  dataSize: number;
} {
  const buf = fs.readFileSync(filePath);
  expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
  expect(buf.toString('ascii', 8, 12)).toBe('WAVE');
  return {
    channels: buf.readUInt16LE(22),
    sampleRate: buf.readUInt32LE(24),
    bitDepth: buf.readUInt16LE(34),
    dataOffset: 44,
    dataSize: buf.readUInt32LE(40),
  };
}

function readWav16Samples(filePath: string): Int16Array {
  const buf = fs.readFileSync(filePath);
  const dataSize = buf.readUInt32LE(40);
  const count = Math.floor(dataSize / 2);
  const out = new Int16Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = buf.readInt16LE(44 + i * 2);
  }
  return out;
}

describe('AutoTiming audio quality: zero metallic artifacts & zero phrase doubling', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-autotiming-dsp-'));
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures on temp dir
    }
  });

  it('preserves native 44.1 kHz mono 16-bit format and produces bit-transparent waveform without resampling', async () => {
    const sampleRate = 44100;
    const channels = 1;
    const durationSec = 3.0;
    const totalSamples = Math.round(sampleRate * durationSec);
    const srcSamples = new Int16Array(totalSamples);

    // Pure 440 Hz tone from 0.5s to 2.0s at 0.5 amplitude (16384 peak)
    for (let i = Math.round(0.5 * sampleRate); i < Math.round(2.0 * sampleRate); i++) {
      srcSamples[i] = Math.round(16384 * Math.sin((2 * Math.PI * 440 * i) / sampleRate));
    }

    const srcWav = path.join(tmpDir, 'native_44k_mono_16.wav');
    const outWav = path.join(tmpDir, 'out_44k_mono_16.wav');
    writeWav16(srcWav, sampleRate, channels, srcSamples);

    const probed = await AutoTimingService.probeAudioFormat(srcWav);
    expect(probed).toEqual({ sampleRate: 44100, channels: 1, bitDepth: 16 });

    await AutoTimingService.assembleMultiSourceTrack(
      srcWav,
      [
        {
          id: 'p1',
          sourceStartSec: 0.5,
          sourceEndSec: 2.0,
          durationSec: 1.5,
          targetStartSec: 0.5,
          targetEndSec: 2.0,
        },
      ],
      outWav,
      { timingExport: true }
    );

    const hdr = readWavHeader(outWav);
    expect(hdr.sampleRate).toBe(44100);
    expect(hdr.channels).toBe(1);
    expect(hdr.bitDepth).toBe(16);

    const outSamples = readWav16Samples(outWav);
    // Check interior away from 6ms/8ms click-free edge fades: [0.60s .. 1.90s]
    let maxDiff = 0;
    for (let i = Math.round(0.6 * sampleRate); i < Math.round(1.9 * sampleRate); i++) {
      const diff = Math.abs(outSamples[i] - srcSamples[i]);
      if (diff > maxDiff) maxDiff = diff;
    }
    expect(maxDiff).toBeLessThanOrEqual(1);
  });

  it('preserves native 48 kHz stereo 24-bit format without truncating to 16-bit', async () => {
    const sampleRate = 48000;
    const channels = 2;
    const totalFrames = Math.round(sampleRate * 2.0);
    const srcFloats = new Float32Array(totalFrames * channels);

    for (let s = Math.round(0.3 * sampleRate); s < Math.round(1.5 * sampleRate); s++) {
      srcFloats[s * 2] = 0.4 * Math.sin((2 * Math.PI * 330 * s) / sampleRate);
      srcFloats[s * 2 + 1] = 0.25 * Math.sin((2 * Math.PI * 660 * s) / sampleRate);
    }

    const srcWav = path.join(tmpDir, 'native_48k_stereo_24.wav');
    const outWav = path.join(tmpDir, 'out_48k_stereo_24.wav');
    writeWav24(srcWav, sampleRate, channels, srcFloats);

    const probed = await AutoTimingService.probeAudioFormat(srcWav);
    expect(probed).toEqual({ sampleRate: 48000, channels: 2, bitDepth: 24 });

    await AutoTimingService.assembleMultiSourceTrack(
      srcWav,
      [
        {
          id: 'p24',
          sourceStartSec: 0.3,
          sourceEndSec: 1.5,
          durationSec: 1.2,
          targetStartSec: 0.3,
          targetEndSec: 1.5,
        },
      ],
      outWav,
      { timingExport: true }
    );

    const hdr = readWavHeader(outWav);
    expect(hdr.sampleRate).toBe(48000);
    expect(hdr.channels).toBe(2);
    expect(hdr.bitDepth).toBe(24);
  });

  it('parses FLAC STREAMINFO header directly for native sample rate, channels, and bit depth', async () => {
    // Minimal synthetic FLAC header: "fLaC" + STREAMINFO block (type=0, length=34)
    // SampleRate = 44100 (0x0AC44), Channels = 1 (encoded 0), BitsPerSample = 24 (encoded 23 = 0x17)
    const buf = Buffer.alloc(42, 0);
    buf.write('fLaC', 0, 'ascii');
    buf[4] = 0x80; // last metadata block, type 0 (STREAMINFO)
    buf[7] = 34;   // length 34 bytes
    const sr = 44100;
    const chMinus1 = 0; // mono
    const bpsMinus1 = 23; // 24-bit
    buf[18] = (sr >> 12) & 0xff;
    buf[19] = (sr >> 4) & 0xff;
    buf[20] = ((sr & 0x0f) << 4) | ((chMinus1 & 0x07) << 1) | ((bpsMinus1 >> 4) & 0x01);
    buf[21] = (bpsMinus1 & 0x0f) << 4;

    const fakeFlac = path.join(tmpDir, 'synthetic_44k_mono_24.flac');
    fs.writeFileSync(fakeFlac, buf);

    const probed = await AutoTimingService.probeAudioFormat(fakeFlac);
    expect(probed).toEqual({ sampleRate: 44100, channels: 1, bitDepth: 24 });
  });

  it('never applies automatic atempo / metallic time-stretching by default in backend or frontend edge rules', async () => {
    // 1. Backend applySoftTimeFitToTrackPhrases must never produce playbackRate > 1.0 even on colliding overlong phrase
    const backendPhrases = [
      {
        id: 'b1',
        trackId: 't1',
        sourceStartSec: 1.0,
        sourceEndSec: 3.0,
        durationSec: 2.0,
        unscaledDurationSec: 2.0,
        targetStartSec: 1.0,
        targetEndSec: 3.0,
        subStartSec: 1.0,
        subEndSec: 2.5,
        speechOffsetSec: 1.95,
        playbackRate: 1.15,
        timeStretch: 1.15,
      },
      {
        id: 'b2',
        trackId: 't1',
        sourceStartSec: 3.0,
        sourceEndSec: 4.5,
        durationSec: 1.5,
        unscaledDurationSec: 1.5,
        targetStartSec: 2.7,
        targetEndSec: 4.2,
        subStartSec: 2.7,
        subEndSec: 4.2,
        speechOffsetSec: 1.4,
      },
    ];
    AutoTimingService.applySoftTimeFitToTrackPhrases(
      backendPhrases,
      backendPhrases,
      new Set(),
      0.12,
      []
    );
    expect(backendPhrases[0].playbackRate).toBe(1.0);
    expect(backendPhrases[0].timeStretch).toBe(1.0);

    // 2. Frontend applySoftTimeFitToTrackClips must never produce playbackRate > 1.0
    const subs: SubtitleLine[] = [
      { id: 1, start: '0:00:01.00', end: '0:00:02.50', startSec: 1.0, endSec: 2.5, style: 'Default', name: 'A', text: 'Line 1', rawLineIndex: 0 },
      { id: 2, start: '0:00:02.70', end: '0:00:04.20', startSec: 2.7, endSec: 4.2, style: 'Default', name: 'A', text: 'Line 2', rawLineIndex: 1 },
    ];
    const clips: AudioClip[] = [
      {
        id: 'c1',
        clipStartSec: 1.0,
        offsetSec: 0,
        sourceStartSec: 1.0,
        sourceEndSec: 3.0,
        durationSec: 2.0,
        unscaledDurationSec: 2.0,
        playbackRate: 1.16,
        matchedSubId: '1',
        targetSubEndSec: 2.5,
        speechOffsetSec: 1.95,
      } as AudioClip,
      {
        id: 'c2',
        clipStartSec: 2.7,
        offsetSec: 0,
        sourceStartSec: 3.0,
        sourceEndSec: 4.5,
        durationSec: 1.5,
        unscaledDurationSec: 1.5,
        matchedSubId: '2',
        targetSubEndSec: 4.2,
        speechOffsetSec: 1.4,
      } as AudioClip,
    ];
    const fitRes = applySoftTimeFitToTrackClips({
      trackId: 'tr1',
      clipsMap: { tr1: clips },
      trackSubLinesMap: { tr1: subs },
      subtitles: subs,
    });
    expect(fitRes.stretchedCount).toBe(0);
    expect(clips[0].playbackRate).toBe(1.0);

    // 3. assembleMultiSourceTrack ignores playbackRate/timeStretch unless allowTimeStretch === true
    const sampleRate = 48000;
    const totalSamples = sampleRate * 3;
    const srcSamples = new Int16Array(totalSamples);
    for (let i = Math.round(0.5 * sampleRate); i < Math.round(2.0 * sampleRate); i++) {
      srcSamples[i] = Math.round(14000 * Math.sin((2 * Math.PI * 500 * i) / sampleRate));
    }
    const srcWav = path.join(tmpDir, 'no_atempo_src.wav');
    const outWav = path.join(tmpDir, 'no_atempo_out.wav');
    writeWav16(srcWav, sampleRate, 1, srcSamples);

    await AutoTimingService.assembleMultiSourceTrack(
      srcWav,
      [
        {
          id: 'p_stretch_ignored',
          sourceStartSec: 0.5,
          sourceEndSec: 2.0,
          durationSec: 1.5,
          targetStartSec: 0.5,
          targetEndSec: 2.0,
          playbackRate: 1.18,
          timeStretch: 1.18,
        },
      ],
      outWav,
      { timingExport: true }
    );

    const outSamples = readWav16Samples(outWav);
    let maxDiff = 0;
    for (let i = Math.round(0.6 * sampleRate); i < Math.round(1.9 * sampleRate); i++) {
      const diff = Math.abs(outSamples[i] - srcSamples[i]);
      if (diff > maxDiff) maxDiff = diff;
    }
    expect(maxDiff).toBeLessThanOrEqual(1);
  });

  it('prevents phrase doubling ("заевшая пластинка") and comb-filtering on split/adjacent phrases and duplicate segments', async () => {
    const sampleRate = 48000;
    const totalSamples = sampleRate * 4;
    const srcSamples = new Int16Array(totalSamples);

    // Phrase 1 in source [0.500 .. 1.500]: 440 Hz tone, peak 12000
    for (let i = Math.round(0.5 * sampleRate); i < Math.round(1.5 * sampleRate); i++) {
      srcSamples[i] = Math.round(12000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate));
    }
    // Phrase 2 in source [1.500 .. 2.500]: 880 Hz tone, peak 12000 (immediately touching Phrase 1!)
    for (let i = Math.round(1.5 * sampleRate); i < Math.round(2.5 * sampleRate); i++) {
      srcSamples[i] = Math.round(12000 * Math.sin((2 * Math.PI * 880 * i) / sampleRate));
    }

    const srcWav = path.join(tmpDir, 'split_phrases_src.wav');
    const outWav = path.join(tmpDir, 'split_phrases_out.wav');
    writeWav16(srcWav, sampleRate, 1, srcSamples);

    // Phrase 1 stays at [0.500 .. 1.500], Phrase 2 shifts to [1.640 .. 2.640],
    // PLUS inject a corrupt duplicate overlapping segment AND safetyPaddingMs: 80 (from fix module)
    await AutoTimingService.assembleMultiSourceTrack(
      srcWav,
      [
        {
          id: 'p1',
          sourceStartSec: 0.5,
          sourceEndSec: 1.5,
          durationSec: 1.0,
          targetStartSec: 0.5,
          targetEndSec: 1.5,
        },
        {
          id: 'p_dup_stutter',
          sourceStartSec: 1.4,
          sourceEndSec: 2.1,
          durationSec: 0.7,
          targetStartSec: 1.56,
          targetEndSec: 2.26,
        },
        {
          id: 'p2',
          sourceStartSec: 1.5,
          sourceEndSec: 2.5,
          durationSec: 1.0,
          targetStartSec: 1.64,
          targetEndSec: 2.64,
        },
      ],
      outWav,
      { safetyPaddingMs: 80 }
    );

    const outSamples = readWav16Samples(outWav);

    // 1. Peak amplitude across entire track must NEVER exceed source peak (no += comb-filter doubling!)
    let peak = 0;
    for (let i = 0; i < outSamples.length; i++) {
      const a = Math.abs(outSamples[i]);
      if (a > peak) peak = a;
    }
    expect(peak).toBeLessThanOrEqual(12002);

    // 2. Gap [1.510 .. 1.630] MUST be silent — no 880 Hz bleed from Phrase 2 into Phrase 1's end
    let gapPeak = 0;
    for (let i = Math.round(1.51 * sampleRate); i < Math.round(1.63 * sampleRate); i++) {
      const a = Math.abs(outSamples[i]);
      if (a > gapPeak) gapPeak = a;
    }
    expect(gapPeak).toBe(0);

    // 3. Phrase 1 interior [0.55 .. 1.45] matches source 440 Hz within 1 LSB
    let p1MaxDiff = 0;
    for (let i = Math.round(0.55 * sampleRate); i < Math.round(1.45 * sampleRate); i++) {
      const diff = Math.abs(outSamples[i] - srcSamples[i]);
      if (diff > p1MaxDiff) p1MaxDiff = diff;
    }
    expect(p1MaxDiff).toBeLessThanOrEqual(1);

    // 4. Phrase 2 interior [1.70 .. 2.58] matches shifted source [1.56 .. 2.44] within 1 LSB
    const shiftFrames = Math.round(0.14 * sampleRate);
    let p2MaxDiff = 0;
    for (let i = Math.round(1.70 * sampleRate); i < Math.round(2.58 * sampleRate); i++) {
      const diff = Math.abs(outSamples[i] - srcSamples[i - shiftFrames]);
      if (diff > p2MaxDiff) p2MaxDiff = diff;
    }
    expect(p2MaxDiff).toBeLessThanOrEqual(1);
  });

  it('sanitizeSingleTrackRenderSegments removes out-of-order source duplicates and clamps partial overlaps', () => {
    const cleaned = AutoTimingService.sanitizeSingleTrackRenderSegments(
      [
        {
          id: 'take_late',
          sourceStartSec: 10.0,
          sourceEndSec: 12.0,
          durationSec: 2.0,
          targetStartSec: 1.0,
          targetEndSec: 3.0,
        },
        {
          id: 'take_early',
          sourceStartSec: 2.0,
          sourceEndSec: 4.0,
          durationSec: 2.0,
          targetStartSec: 4.0,
          targetEndSec: 6.0,
        },
        {
          id: 'take_early_dup',
          sourceStartSec: 2.2,
          sourceEndSec: 3.9,
          durationSec: 1.7,
          targetStartSec: 6.5,
          targetEndSec: 8.2,
        },
        {
          id: 'take_partial_overlap',
          sourceStartSec: 3.8,
          sourceEndSec: 5.5,
          durationSec: 1.7,
          targetStartSec: 9.0,
          targetEndSec: 10.7,
        },
      ],
      path.join(tmpDir, 'source.flac')
    );

    expect(cleaned.map((s: { id: string }) => s.id)).toEqual([
      'take_late',
      'take_early',
      'take_partial_overlap',
    ]);
    // Partial overlap [3.8..5.5] against [2.0..4.0] must be clamped to start at 4.0 (target shifted by +0.2s)
    expect(cleaned[2].sourceStartSec).toBe(4.0);
    expect(cleaned[2].targetStartSec).toBe(9.2);
    expect(cleaned[2].durationSec).toBe(1.5);
  });
});
