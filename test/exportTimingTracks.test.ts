import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { prepareQATracksForTiming } from '../src/lib/qaTimingHelper';

const require = createRequire(import.meta.url);
const AutoTimingService = require('../electron/services/AutoTimingService.cjs');
const { sanitizeDubberNick } = require('../electron/lib/pathSanitizer.cjs');

describe('Export & Timing track matching, naming, and preservation', () => {
  let tmpDir: string;
  let subPath: string;

  const createDummyFile = (name: string, bytes = 2048) => {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, Buffer.alloc(bytes, 1));
    return p;
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-export-tracks-'));
    subPath = path.join(tmpDir, 'ep6.ass');
    const assContent = [
      '[Script Info]',
      'Title: Episode 6',
      'ScriptType: v4.00+',
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:01.00,0:00:03.00,Default,Сидзури Мугино,0,0,0,,Привет, это Мугино.',
      'Dialogue: 0,0:00:04.00,0:00:06.00,Default,Ханаяма,0,0,0,,Реплика Ханаямы.',
      'Dialogue: 0,0:00:07.00,0:00:09.00,Default,Френда Сейвелун,0,0,0,,Реплика Френды.',
      'Dialogue: 0,0:00:10.00,0:00:12.00,Default,Ванигути,0,0,0,,Реплика Ванигути.',
      'Dialogue: 0,0:00:13.00,0:00:15.00,Default,Сайай Кинухата,0,0,0,,Реплика Сайай.',
      'Dialogue: 0,0:00:16.00,0:00:18.00,Default,Ханацую,0,0,0,,Реплика Ханацую.',
      'Dialogue: 0,0:00:19.00,0:00:21.00,Default,Иботанокикодзи,0,0,0,,Реплика Иботанокикодзи.',
      'Dialogue: 0,0:00:22.00,0:00:24.00,Default,Тёби Ханано,0,0,0,,Реплика Тёби.',
      'Dialogue: 0,0:00:25.00,0:00:27.00,Default,Рико Такицубо,0,0,0,,Реплика Рико.',
      'Dialogue: 0,0:00:28.00,0:00:30.00,Default,Куродзума,0,0,0,,Реплика Куродзумы.',
    ].join('\n');
    fs.writeFileSync(subPath, assContent, 'utf8');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('sanitizes backticks in dubber nicknames consistently (Vi`sk0nsiK -> Visk0nsiK)', () => {
    expect(sanitizeDubberNick('Vi`sk0nsiK')).toBe('Visk0nsiK');
    expect(sanitizeDubberNick('Женьшень')).toBe('Женьшень');
    expect(sanitizeDubberNick('7pies')).toBe('7pies');
  });

  it('never mismatches Сидзури Мугино to short participant РИ and preserves all 6 dubber tracks + all assigned roles', async () => {
    const participants = [
      { id: 'p_ri', nickname: 'РИ' },
      { id: 'p_visk', nickname: 'Vi`sk0nsiK' },
      { id: 'p_kitsune', nickname: 'Kitsune' },
      { id: 'p_vorob', nickname: 'Воробейка' },
      { id: 'p_zhen', nickname: 'Женьшень' },
      { id: 'p_7pies', nickname: '7pies' },
    ];

    const assignments = [
      { id: 'a_ibota', characterName: 'Иботанокикодзи', dubberId: 'p_zhen' },
      { id: 'a_sayai', characterName: 'Сайай Кинухата', dubberId: 'p_zhen' },
      { id: 'a_hana', characterName: 'Ханацую', dubberId: 'p_zhen' },
      { id: 'a_mugino', characterName: 'Сидзури Мугино', dubberId: 'p_old', substituteId: 'p_visk' },
      { id: 'a_hanayama', characterName: 'Ханаяма', dubberId: 'p_visk' },
      { id: 'a_frenda', characterName: 'Френда Сейвелун', dubberId: 'p_kitsune' },
      { id: 'a_waniguti', characterName: 'Ванигути', dubberId: 'p_kitsune' },
      { id: 'a_tobi', characterName: 'Тёби Ханано', dubberId: 'p_vorob' },
      { id: 'a_riko', characterName: 'Рико Такицубо', dubberId: 'p_vorob' },
      { id: 'a_kuro', characterName: 'Куродзума', dubberId: 'p_7pies' },
    ];

    const audioFiles = [
      {
        id: 'u_vorob_fix',
        path: createDummyFile('fix_1794645027539-Тёби Ханано-1794648379068-utcc_1795340161767.flac'),
        type: 'FIXES',
        isFix: true,
        uploadedById: 'p_vorob',
        dubberId: 'p_vorob',
        dubberNick: 'Воробейка',
        trackNumber: 1,
      },
      {
        id: 'u_kitsune',
        path: createDummyFile('dub_1794645027539-Френда Сейвелун-1794648379068-z8g2_1795120613473.flac'),
        type: 'DUBBER_FILE',
        uploadedById: 'p_kitsune',
        dubberId: 'p_kitsune',
        dubberNick: 'Kitsune',
        trackNumber: 1,
      },
      {
        id: 'u_7pies',
        path: createDummyFile('dub_1794645027539-Куродзума-1794648379068-wvjc_1795120041574.flac'),
        type: 'DUBBER_FILE',
        uploadedById: 'p_7pies',
        dubberId: 'p_7pies',
        dubberNick: '7pies',
        trackNumber: 1,
      },
      {
        id: 'u_zhen_1',
        path: createDummyFile('dub_1794645027539-Сайай Кинухата-1794648379068-xl1o_1795120035299.flac'),
        type: 'DUBBER_FILE',
        uploadedById: 'p_zhen',
        dubberId: 'p_zhen',
        dubberNick: 'Женьшень',
        trackNumber: 1,
      },
      {
        id: 'u_zhen_2',
        path: createDummyFile('dub_1794645027539-Сайай Кинухата-1794648379068-xl1o_1795120086176.flac'),
        type: 'DUBBER_FILE',
        uploadedById: 'p_zhen',
        dubberId: 'p_zhen',
        dubberNick: 'Женьшень',
        trackNumber: 2,
      },
      {
        // Even with NO uploadedById/dubberNick metadata, Сидзури Мугино MUST resolve to Vi`sk0nsiK via assignment, NEVER РИ!
        id: 'u_visk',
        path: createDummyFile('dub_1794645027539-Сидзури Мугино-1794648379068-rdet_1795251883684.flac'),
        type: 'DUBBER_FILE',
      },
    ];

    const res = await AutoTimingService.matchActorsWithAudioTracks(
      subPath,
      audioFiles,
      participants,
      {},
      assignments
    );

    expect(res.matchedTracks).toHaveLength(6);

    const nicks = res.matchedTracks.map((m: any) => m.dubberNick);
    expect(nicks).not.toContain('РИ');
    expect(nicks).toContain('Vi`sk0nsiK');
    expect(nicks).toContain('Kitsune');
    expect(nicks).toContain('Воробейка');
    expect(nicks).toContain('7pies');
    expect(nicks.filter((n: string) => n === 'Женьшень')).toHaveLength(2);

    const viskMatch = res.matchedTracks.find((m: any) => m.dubberNick === 'Vi`sk0nsiK');
    expect(viskMatch.characterName).toContain('Сидзури Мугино');
    expect(viskMatch.characterName).toContain('Ханаяма');
    expect(viskMatch.lines.length).toBe(2);

    const zhenTracks = res.matchedTracks.filter((m: any) => m.dubberNick === 'Женьшень');
    expect(zhenTracks[0].characterName.startsWith('Сайай Кинухата')).toBe(true);
    expect(zhenTracks[0].lines.length).toBe(3);
  });

  it('renders canonical Sound Engineer filenames (baseVideoName_[Nick].wav / _дорожкаN.wav) and Mixing 00_timed_ filenames', async () => {
    const srcA = createDummyFile('src_a.wav', 1024);
    const srcB1 = createDummyFile('src_b1.wav', 1024);
    const srcB2 = createDummyFile('src_b2.wav', 1024);

    const mergedResult = {
      stats: { totalPhrases: 0, totalCollisionsResolved: 0, totalIntentionalOverlapsPreserved: 0 },
      collisionLogs: [],
      fixStats: {},
      fixLogs: [],
      finalTrackPhraseResults: [
        { track: { dubberNick: 'Vi`sk0nsiK', characterName: 'Сидзури Мугино', trackPath: srcA }, phrases: [] },
        { track: { dubberNick: 'Женьшень', characterName: 'Сайай Кинухата', trackPath: srcB1, subTrackIndex: 1 }, phrases: [] },
        { track: { dubberNick: 'Женьшень', characterName: 'Сайай Кинухата', trackPath: srcB2, subTrackIndex: 2 }, phrases: [] },
      ],
    };

    const seDir = path.join(tmpDir, 'se_export');
    await AutoTimingService.renderAutoTimedTracks(
      mergedResult,
      seDir,
      'Некий ITEM тёмной стороны_6',
      { targetDir: seDir }
    );

    const seFiles = fs.readdirSync(seDir);
    expect(seFiles).toContain('Некий ITEM тёмной стороны_6_[Visk0nsiK].wav');
    expect(seFiles).toContain('Некий ITEM тёмной стороны_6_[Женьшень]_дорожка1.wav');
    expect(seFiles).toContain('Некий ITEM тёмной стороны_6_[Женьшень]_дорожка2.wav');
    expect(seFiles).not.toContain('00_исходные');

    const mixDir = path.join(tmpDir, 'mix_export');
    await AutoTimingService.renderAutoTimedTracks(
      mergedResult,
      mixDir,
      'Некий ITEM тёмной стороны_6',
      { targetDir: mixDir, forMixing: true }
    );

    const mixFiles = fs.readdirSync(mixDir);
    expect(mixFiles).toContain('00_timed_Visk0nsiK.wav');
    expect(mixFiles).toContain('00_timed_Женьшень_дорожка1.wav');
    expect(mixFiles).toContain('00_timed_Женьшень_дорожка2.wav');
    expect(fs.existsSync(path.join(mixDir, '00_исходные', '00_timed_Visk0nsiK.wav'))).toBe(true);
  });

  it('prepareQATracksForTiming preserves all 6 tracks (Kitsune, Visk0nsiK, 7pies, Воробейка, Женьшень x2) without short-nick contamination', () => {
    const episode: any = {
      id: 'ep_6',
      projectId: 'proj_1',
      number: 6,
      assignments: [
        { id: 'a1', characterName: 'Тёби Ханано', dubberId: 'p_vorob', dubber: { id: 'p_vorob', nickname: 'Воробейка' } },
        { id: 'a2', characterName: 'Сидзури Мугино', dubberId: 'p_old', substituteId: 'p_visk', substitute: { id: 'p_visk', nickname: 'Vi`sk0nsiK' } },
        { id: 'a3', characterName: 'Френда Сейвелун', dubberId: 'p_kitsune', dubber: { id: 'p_kitsune', nickname: 'Kitsune' } },
        { id: 'a4', characterName: 'Сайай Кинухата', dubberId: 'p_zhen', dubber: { id: 'p_zhen', nickname: 'Женьшень' } },
        { id: 'a5', characterName: 'Куродзума', dubberId: 'p_7pies', dubber: { id: 'p_7pies', nickname: '7pies' } },
      ],
      uploads: [
        { id: 'u1', type: 'FIXES', path: createDummyFile('fix_vorob.flac'), uploadedById: 'p_vorob', dubberNick: 'Воробейка', createdAt: '2026-11-22T17:53:19Z' },
        { id: 'u2', type: 'DUBBER_FILE', path: createDummyFile('dub_visk.flac'), uploadedById: 'p_visk', dubberNick: 'Vi`sk0nsiK', createdAt: '2026-11-22T12:04:43Z' },
        { id: 'u3', type: 'DUBBER_FILE', path: createDummyFile('dub_kitsune.flac'), uploadedById: 'p_kitsune', dubberNick: 'Kitsune', createdAt: '2026-11-21T23:36:53Z' },
        { id: 'u4', type: 'DUBBER_FILE', path: createDummyFile('dub_zhen1.flac'), uploadedById: 'p_zhen', dubberNick: 'Женьшень', createdAt: '2026-11-21T23:27:15Z' },
        { id: 'u5', type: 'DUBBER_FILE', path: createDummyFile('dub_zhen2.flac'), uploadedById: 'p_zhen', dubberNick: 'Женьшень', createdAt: '2026-11-21T23:28:06Z' },
        { id: 'u6', type: 'DUBBER_FILE', path: createDummyFile('dub_7pies.flac'), uploadedById: 'p_7pies', dubberNick: '7pies', createdAt: '2026-11-21T23:27:21Z' },
      ],
    };

    // Pass a poisoned manifest track named 00_timed_РИ.wav to ensure it cannot contaminate Visk0nsiK or any other actor
    const manifestTracks = [
      { id: 'm_ri', name: '00_timed_РИ.wav', dubberNick: 'РИ', path: createDummyFile('00_timed_РИ.wav') },
    ];

    const tracks = prepareQATracksForTiming(episode, manifestTracks, true);
    expect(tracks).toHaveLength(6);
    expect(tracks.every(t => Boolean(t.filePath))).toBe(true);

    const names = tracks.map(t => t.participant);
    expect(names).toContain('Воробейка');
    expect(names).toContain('Visk0nsiK');
    expect(names).toContain('Kitsune');
    expect(names).toContain('7pies');
    expect(names).toContain('Женьшень (Дорожка 1)');
    expect(names).toContain('Женьшень (Дорожка 2)');
  });
});
