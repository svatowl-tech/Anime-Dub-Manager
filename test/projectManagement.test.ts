import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, it, expect, afterEach } from 'vitest';
import ProjectScanner from '../electron/lib/ProjectScanner.cjs';
import { extractEpisodeNumber as extractFrontendEpisodeNumber } from '../src/lib/episodeNumberExtractor';

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

describe('ProjectScanner & Episode Extraction Hardening', () => {
  it('ignores technical units, dimensions, and database IDs in episode number extraction', () => {
    expect(ProjectScanner.extractEpisodeNumber('audio_465kbps.wav', 'Test Anime')).toBeNull();
    expect(ProjectScanner.extractEpisodeNumber('delay_465ms.wav', 'Test Anime')).toBeNull();
    expect(ProjectScanner.extractEpisodeNumber('cover_640x465.png', 'Test Anime')).toBeNull();
    expect(ProjectScanner.extractEpisodeNumber('Test_Anime_id465.txt', 'Test Anime')).toBeNull();
    expect(ProjectScanner.extractEpisodeNumber('anime365_export.json', 'Test Anime')).toBeNull();

    // Weak out-of-range numbers exceeding project totalEpisodes are rejected
    expect(
      ProjectScanner.extractEpisodeNumber('Test_Anime_465.mkv', 'Test Anime', { totalEpisodes: 12 })
    ).toBeNull();

    // Valid episodes still extract cleanly on both backend and frontend
    expect(ProjectScanner.extractEpisodeNumber('Episode_5', 'Test Anime', { totalEpisodes: 12 })).toBe(5);
    expect(ProjectScanner.extractEpisodeNumber('[SubsPlease] Test Anime - 05 (1080p).mkv', 'Test Anime', { totalEpisodes: 12 })).toBe(5);
    expect(extractFrontendEpisodeNumber('[SubsPlease] Test Anime - 05 (1080p) [id465].mkv', 'Test Anime')).toBe(5);
    expect(extractFrontendEpisodeNumber('S01E08_465kbps.mkv', 'Test Anime')).toBe(8);
  });

  it('does not create phantom episodes from non-media files or empty folders in projectDir', async () => {
    const baseDir = await makeTempDir('adm-scan-');
    const project = {
      id: 'proj_test',
      title: 'Phantom Test',
      totalEpisodes: 12,
    };
    const projectDir = path.join(baseDir, 'Phantom Test');
    await fs.mkdir(projectDir, { recursive: true });

    // Stray non-media files and folders containing "465"
    await fs.writeFile(path.join(projectDir, 'poster_465.png'), 'fake-png');
    await fs.writeFile(path.join(projectDir, 'notes_465.txt'), 'notes');
    await fs.writeFile(path.join(projectDir, 'project_465.json'), '{}');
    await fs.mkdir(path.join(projectDir, 'backup_465'), { recursive: true });
    await fs.mkdir(path.join(projectDir, 'sound_engineer'), { recursive: true });

    // One legitimate episode folder with media
    const ep1Dir = path.join(projectDir, 'Episode_1');
    await fs.mkdir(ep1Dir, { recursive: true });
    await fs.writeFile(path.join(ep1Dir, 'raw_video.mp4'), 'video');

    const { hasChanges, updatedEpisodes } = await ProjectScanner.scanAndRecoverProject(
      baseDir,
      project,
      [],
      []
    );

    expect(hasChanges).toBe(true);
    expect(updatedEpisodes).toHaveLength(1);
    expect(updatedEpisodes[0].number).toBe(1);
  });

  it('does not resurrect deleted/tombstoned episodes even if disk artifacts remain, and removes disk metadata on delete', async () => {
    const baseDir = await makeTempDir('adm-tombstone-');
    const project = {
      id: 'proj_ghost',
      title: 'Ghost Project',
      totalEpisodes: 12,
    };
    const episode465 = {
      id: 'ep_465',
      projectId: 'proj_ghost',
      number: 465,
      status: 'UPLOAD',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    // Persist episode.json on disk first
    await ProjectScanner.saveEpisodeJsonOnDisk(baseDir, project, episode465);
    const epJsonPath = path.join(baseDir, 'Ghost Project', 'Episode_465', 'episode.json');
    const statBefore = await fs.stat(epJsonPath);
    expect(statBefore.isFile()).toBe(true);

    // Even before disk cleanup, a tombstone prevents resurrection during scan
    const scanWithTombstone = await ProjectScanner.scanAndRecoverProject(
      baseDir,
      project,
      [],
      [{ id: 'ep_465', projectId: 'proj_ghost', number: 465, deletedAt: '2026-01-02T00:00:00.000Z' }]
    );
    expect(scanWithTombstone.hasChanges).toBe(false);
    expect(scanWithTombstone.updatedEpisodes).toHaveLength(0);

    // removeEpisodeOnDisk deletes episode.json and cleans empty folder
    await ProjectScanner.removeEpisodeOnDisk(baseDir, project, episode465);
    await expect(fs.stat(epJsonPath)).rejects.toThrow();
  });
});
