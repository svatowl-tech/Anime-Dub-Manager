import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ffmpegBin: string = require('ffmpeg-static');
const {
  bakeSubtitles,
  transcodeToMp4,
  createVideoProxy,
  muxRelease,
  resolveSafeMp4AudioOptions,
  isAudioEncoderOrMuxError,
  getVideoMetadata,
} = require('../electron/services/ffmpegService.cjs');

const SAMPLE_ASS = `[Script Info]
ScriptType: v4.00+
PlayResX: 320
PlayResY: 240

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sign,Arial,18,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:00.90,Sign,,0,0,0,,TEST SIGN
`;

describe('FFmpeg multichannel (5.1 / unspecified 6 channels) safe MP4 export', () => {
  let tmpDir: string;
  let mp4SixChAac: string;
  let mkvSixChUnspecPcm: string;
  let wavSixChUnspec: string;
  let assPath: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-ffmpeg-6ch-'));
    mp4SixChAac = path.join(tmpDir, 'raw_video_edited_6ch.mp4');
    mkvSixChUnspecPcm = path.join(tmpDir, 'source_unspec_6ch.mkv');
    wavSixChUnspec = path.join(tmpDir, 'audio_unspec_6ch.wav');
    assPath = path.join(tmpDir, 'signs.ass');

    fs.writeFileSync(assPath, SAMPLE_ASS, 'utf8');

    // 1. MP4 with 5.1 (6ch) AAC audio (like edited episode video)
    execFileSync(
      ffmpegBin,
      [
        '-y',
        '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=24:d=1',
        '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=5.1',
        '-t', '1',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '256k',
        mp4SixChAac,
      ],
      { stdio: 'pipe' }
    );

    // 2. MKV with unspecified 6-channel (6c) PCM audio (triggers FFmpeg 6.1 "Unsupported channel layout 6 channels")
    execFileSync(
      ffmpegBin,
      [
        '-y',
        '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=24:d=1',
        '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=6c',
        '-t', '1',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        '-c:a', 'pcm_s16le',
        mkvSixChUnspecPcm,
      ],
      { stdio: 'pipe' }
    );

    // 3. Standalone 6-channel unspecified WAV for muxRelease
    execFileSync(
      ffmpegBin,
      [
        '-y',
        '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=6c',
        '-t', '1',
        '-c:a', 'pcm_s16le',
        wavSixChUnspec,
      ],
      { stdio: 'pipe' }
    );
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  });

  it('detects FFmpeg 6.1 Unsupported channel layout 6 channels error signature', () => {
    const userStderr = `[aac @ 000001a9a1ab3380] Unsupported channel layout "6 channels"
[aost#0:1/aac @ 000001a9a1b02000] Error while opening encoder - maybe incorrect parameters such as bit_rate, rate, width or height.
Error while filtering: Invalid argument`;
    expect(isAudioEncoderOrMuxError(userStderr)).toBe(true);
    expect(isAudioEncoderOrMuxError('h264_nvenc: driver does not support')).toBe(false);
  });

  it('selects lossless stream copy for MP4 AAC 6ch and explicit stereo AAC for non-AAC 6ch', () => {
    const copyPlan = resolveSafeMp4AudioOptions(
      { streams: [{ index: 0, codec_type: 'video' }, { index: 1, codec_type: 'audio', codec_name: 'aac', channels: 6 }] },
      mp4SixChAac,
      { allowAudioCopy: true }
    );
    expect(copyPlan.mode).toBe('copy');
    expect(copyPlan.outputOptions).toEqual(['-c:a', 'copy']);

    const mkvPlan = resolveSafeMp4AudioOptions(
      { streams: [{ index: 0, codec_type: 'video' }, { index: 1, codec_type: 'audio', codec_name: 'eac3', channels: 6 }] },
      mkvSixChUnspecPcm,
      { allowAudioCopy: true }
    );
    expect(mkvPlan.mode).toBe('aac-stereo');
    expect(mkvPlan.outputOptions).toEqual(['-c:a', 'aac', '-ac', '2', '-b:a', '256k']);

    const fallbackPlan = resolveSafeMp4AudioOptions(
      { streams: [{ index: 0, codec_type: 'video' }, { index: 1, codec_type: 'audio', codec_name: 'aac', channels: 6 }] },
      mp4SixChAac,
      { forceStereoAac: true }
    );
    expect(fallbackPlan.mode).toBe('force-stereo-aac');
    expect(fallbackPlan.outputOptions).toEqual(['-c:a', 'aac', '-ac', '2', '-ar', '48000', '-b:a', '192k']);

    const silentPlan = resolveSafeMp4AudioOptions(
      { streams: [{ index: 0, codec_type: 'video' }] },
      mp4SixChAac
    );
    expect(silentPlan.hasAudio).toBe(false);
    expect(silentPlan.outputOptions).toEqual([]);
  });

  it('bakeSubtitles succeeds on 6-channel MP4 (copies AAC losslessly) and on unspecified 6c MKV (transcodes cleanly)', async () => {
    const outFromMp4 = path.join(tmpDir, 'baked_from_6ch_mp4.mp4');
    await bakeSubtitles(mp4SixChAac, assPath, outFromMp4, undefined, undefined, { crf: 28 });
    expect(fs.existsSync(outFromMp4)).toBe(true);
    expect(fs.statSync(outFromMp4).size).toBeGreaterThan(1000);

    const outFromMkv = path.join(tmpDir, 'baked_from_unspec_6c_mkv.mp4');
    await bakeSubtitles(mkvSixChUnspecPcm, assPath, outFromMkv, undefined, undefined, { crf: 28 });
    expect(fs.existsSync(outFromMkv)).toBe(true);
    expect(fs.statSync(outFromMkv).size).toBeGreaterThan(1000);

    const meta = await getVideoMetadata(outFromMkv);
    const aStream = (meta?.streams || []).find((s: { codec_type?: string }) => s.codec_type === 'audio');
    expect(aStream?.codec_name).toBe('aac');
    expect(Number(aStream?.channels)).toBe(2);
  });

  it('transcodeToMp4, createVideoProxy, and muxRelease succeed on unspecified 6-channel audio', async () => {
    const outTranscoded = path.join(tmpDir, 'transcoded_from_6c.mp4');
    await transcodeToMp4(mkvSixChUnspecPcm, outTranscoded, undefined, undefined, { crf: 28 });
    expect(fs.existsSync(outTranscoded)).toBe(true);
    expect(fs.statSync(outTranscoded).size).toBeGreaterThan(1000);

    const outProxy = path.join(tmpDir, 'proxy_from_6c.mp4');
    await createVideoProxy(mkvSixChUnspecPcm, outProxy);
    expect(fs.existsSync(outProxy)).toBe(true);
    expect(fs.statSync(outProxy).size).toBeGreaterThan(1000);

    const outMux = path.join(tmpDir, 'muxed_from_6c_wav.mp4');
    await muxRelease(mp4SixChAac, wavSixChUnspec, null, outMux);
    expect(fs.existsSync(outMux)).toBe(true);
    expect(fs.statSync(outMux).size).toBeGreaterThan(1000);
  });
});
