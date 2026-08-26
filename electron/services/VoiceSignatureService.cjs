const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const log = require('electron-log');
const { app } = require('electron');
const { getFfmpegPath } = require('./ffmpegService.cjs');
const { trackProcess } = require('../lib/ProcessTracker.cjs');
const os = require('os');

class VoiceSignatureService {
  constructor() {
    this.voiceBaseDir = null;
  }

  async getVoiceBaseDir(projectName) {
    if (!this.voiceBaseDir) {
      this.voiceBaseDir = path.join(app.getPath('userData'), 'voice_base');
    }
    const projectDir = path.join(this.voiceBaseDir, this.sanitizeFolderName(projectName));
    await fs.mkdir(projectDir, { recursive: true });
    return projectDir;
  }

  sanitizeFolderName(name) {
    return name.replace(/[^a-zA-Z0-9А-Яа-я_-]/g, '_');
  }

  async getPythonPath() {
    const isWin = process.platform === 'win32';
    const winPython = path.join(app.getPath('userData'), 'ai_env', 'python_env', 'python.exe');
    const unixPython = path.join(app.getPath('userData'), 'ai_env', 'python_env', 'bin', 'python');
    const unixPythonAlt = path.join(app.getPath('userData'), 'ai_env', 'python_env', 'python');
    
    let pythonPath = winPython;
    if (!isWin) {
      try {
        await fs.access(unixPython);
        pythonPath = unixPython;
      } catch {
        pythonPath = unixPythonAlt;
      }
    }
    
    try {
      await fs.access(pythonPath);
      return pythonPath;
    } catch {
      throw new Error('Среда ИИ (Python) не найдена. Пожалуйста, установите её в настройках.');
    }
  }

  /**
   * Helper to execute the voice matcher python script.
   */
  async runPythonMatcher(args) {
    const pythonPath = await this.getPythonPath();
    const scriptPath = path.join(__dirname, 'voice_matcher.py');
    
    return new Promise((resolve, reject) => {
      const fullArgs = [scriptPath, ...args];
      log.info(`[VoiceSignatureService] Running: python ${fullArgs.join(' ')}`);
      
      const child = spawn(pythonPath, fullArgs);
      trackProcess(child);
      
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      child.on('close', (code) => {
        if (code !== 0) {
          log.error(`[VoiceSignatureService] Python process failed with code ${code}. Stderr: ${stderr}`);
          reject(new Error(`Python process error: ${stderr}`));
          return;
        }
        try {
          const parsed = JSON.parse(stdout.trim());
          resolve(parsed);
        } catch (err) {
          log.error(`[VoiceSignatureService] Failed to parse JSON from Python: ${stdout}`);
          reject(new Error(`Failed to parse Python response: ${err.message}`));
        }
      });
    });
  }

  /**
   * Slice a segment of audio from a video/audio track into a temporary wav file.
   */
  async sliceAudioSegment(videoPath, startSec, endSec, outputWavPath) {
    const ffmpegPath = getFfmpegPath() || 'ffmpeg';
    log.info(`[VoiceSignatureService] Slicing audio segment [${startSec}s to ${endSec}s] from ${videoPath}`);
    
    return new Promise((resolve, reject) => {
      const child = spawn(ffmpegPath, [
        '-y',
        '-ss', String(startSec),
        '-to', String(endSec),
        '-i', videoPath,
        '-vn',
        '-acodec', 'pcm_s16le',
        '-ar', '16000',
        '-ac', '1',
        outputWavPath
      ]);
      trackProcess(child);
      
      child.on('close', (code) => {
        if (code === 0) {
          resolve(outputWavPath);
        } else {
          reject(new Error(`FFmpeg slicing failed with code ${code}`));
        }
      });
      
      child.on('error', reject);
    });
  }

  /**
   * Adds/learns a voice profile manually for a character from an interval.
   */
  async addVoicePrintFromInterval(projectName, characterName, videoPath, startSec, endSec) {
    const projectDbDir = await this.getVoiceBaseDir(projectName);
    const cleanCharName = this.sanitizeFolderName(characterName);
    const voiceProfilePath = path.join(projectDbDir, `${cleanCharName}.voice.json`);
    
    const tempWav = path.join(os.tmpdir(), `temp_voice_${Date.now()}.wav`);
    
    try {
      log.info(`[VoiceSignatureService] Adding manual voice print for ${characterName}`);
      await this.sliceAudioSegment(videoPath, startSec, endSec, tempWav);
      
      const res = await this.runPythonMatcher(['extract', tempWav, voiceProfilePath]);
      if (!res.success) {
        throw new Error(res.error || 'Failed to extract voiceprint');
      }
      
      log.info(`[VoiceSignatureService] Successfully saved voice profile for ${characterName} to ${voiceProfilePath}`);
      return { success: true, character: characterName };
    } finally {
      try {
        await fs.unlink(tempWav);
      } catch (e) {}
    }
  }

  /**
   * Automatically extracts and aggregates voice profiles for all already-labeled characters in an episode.
   */
  async autoTrainFromEpisode(projectName, videoPath, subtitleLines, onProgress) {
    log.info(`[VoiceSignatureService] Starting auto-training from episode for project ${projectName}`);
    
    // 1. Group labeled lines by character
    const charLines = {};
    for (const line of subtitleLines) {
      if (line.name && line.name.trim() && line.name !== 'Default' && !line.name.startsWith('Speaker ')) {
        const cleanName = line.name.trim();
        if (!charLines[cleanName]) {
          charLines[cleanName] = [];
        }
        charLines[cleanName].push(line);
      }
    }

    const characters = Object.keys(charLines);
    log.info(`[VoiceSignatureService] Found ${characters.length} labeled characters for training.`);

    let successCount = 0;
    
    for (let i = 0; i < characters.length; i++) {
      const charName = characters[i];
      const lines = charLines[charName];
      
      if (onProgress) {
        onProgress({
          current: i + 1,
          total: characters.length,
          message: `Обучение базы голосов: Персонаж ${charName} (${i + 1} из ${characters.length})...`
        });
      }

      // Find the longest lines (at least 2-3 seconds long, up to 5 lines) to build a robust profile
      const suitableLines = lines
        .filter(l => (Number(l.endSec || 0) - Number(l.startSec || 0)) >= 1.5)
        .sort((a, b) => (Number(b.endSec || 0) - Number(b.startSec || 0)) - (Number(a.endSec || 0) - Number(a.startSec || 0)))
        .slice(0, 4);

      if (suitableLines.length === 0) {
        log.warn(`[VoiceSignatureService] Not enough suitable utterances (>=1.5s) for ${charName}, skipping.`);
        continue;
      }

      // Extract and combine signatures
      const signatures = [];
      for (const line of suitableLines) {
        const tempWav = path.join(os.tmpdir(), `temp_auto_train_${Date.now()}.wav`);
        const tempJson = path.join(os.tmpdir(), `temp_sig_${Date.now()}.json`);
        try {
          await this.sliceAudioSegment(videoPath, line.startSec, line.endSec, tempWav);
          const res = await this.runPythonMatcher(['extract', tempWav, tempJson]);
          if (res.success && res.signature) {
            signatures.push(res.signature);
          }
        } catch (err) {
          log.warn(`[VoiceSignatureService] Skipping line for ${charName} due to error:`, err.message);
        } finally {
          try { await fs.unlink(tempWav); } catch (e) {}
          try { await fs.unlink(tempJson); } catch (e) {}
        }
      }

      if (signatures.length > 0) {
        // Average all signatures to construct a representative profile
        const numBins = signatures[0].length;
        const avgSignature = Array(numBins).fill(0);
        for (const sig of signatures) {
          for (let b = 0; b < numBins; b++) {
            avgSignature[b] += sig[b];
          }
        }
        for (let b = 0; b < numBins; b++) {
          avgSignature[b] /= signatures.length;
        }

        // Save averaged signature
        const projectDbDir = await this.getVoiceBaseDir(projectName);
        const cleanCharName = this.sanitizeFolderName(charName);
        const voiceProfilePath = path.join(projectDbDir, `${cleanCharName}.voice.json`);
        await fs.writeFile(voiceProfilePath, JSON.stringify(avgSignature), 'utf-8');
        successCount++;
        log.info(`[VoiceSignatureService] Saved auto-trained voice profile for ${charName}`);
      }
    }

    return { success: true, count: successCount };
  }

  /**
   * Compare an audio segment with saved project voice base, returning matched character name if confidence is high.
   */
  async matchVoiceBase(projectName, videoPath, startSec, endSec) {
    const projectDbDir = await this.getVoiceBaseDir(projectName);
    const tempWav = path.join(os.tmpdir(), `temp_match_${Date.now()}.wav`);
    
    try {
      await this.sliceAudioSegment(videoPath, startSec, endSec, tempWav);
      const res = await this.runPythonMatcher(['compare', tempWav, projectDbDir]);
      
      if (!res.success) {
        throw new Error(res.error || 'Failed to compare voice signature');
      }

      // Returns array of { character, similarity }
      return res.matches || [];
    } catch (err) {
      log.error('[VoiceSignatureService] Error matching voice:', err.message);
      return [];
    } finally {
      try {
        await fs.unlink(tempWav);
      } catch (e) {}
    }
  }

  /**
   * Match an unmapped speaker (e.g. Speaker 1) against the project voice base by sampling their lines.
   */
  async matchSpeakerAgainstVoiceBase(projectName, videoPath, speakerLines) {
    // Sample up to 3 longest lines
    const sortedLines = [...speakerLines]
      .filter(l => (Number(l.endSec || 0) - Number(l.startSec || 0)) >= 1.5)
      .sort((a, b) => (Number(b.endSec || 0) - Number(b.startSec || 0)) - (Number(a.endSec || 0) - Number(a.startSec || 0)))
      .slice(0, 3);

    if (sortedLines.length === 0) return null;

    const aggregateScores = {}; // character -> sum similarities
    let matchCount = 0;

    for (const line of sortedLines) {
      const matches = await this.matchVoiceBase(projectName, videoPath, line.startSec, line.endSec);
      if (matches && matches.length > 0) {
        matchCount++;
        for (const m of matches) {
          aggregateScores[m.character] = (aggregateScores[m.character] || 0) + m.similarity;
        }
      }
    }

    if (matchCount === 0) return null;

    // Find the best character matching with the highest average similarity
    let bestChar = null;
    let maxAvgSimilarity = 0;

    for (const [char, sumSim] of Object.entries(aggregateScores)) {
      const avgSim = sumSim / matchCount;
      if (avgSim > maxAvgSimilarity) {
        maxAvgSimilarity = avgSim;
        bestChar = char;
      }
    }

    log.info(`[VoiceSignatureService] Speaker matched against Voice Base. Best match: ${bestChar} with similarity: ${maxAvgSimilarity}`);
    
    // Confidence threshold 0.65 for spectral voice fingerprint match
    if (bestChar && maxAvgSimilarity >= 0.65) {
      return { character: bestChar, similarity: maxAvgSimilarity };
    }

    return null;
  }

  /**
   * Returns list of characters that have saved profiles in the database.
   */
  async getSavedCharacters(projectName) {
    const projectDbDir = await this.getVoiceBaseDir(projectName);
    const files = await fs.readdir(projectDbDir);
    const characters = [];
    for (const file of files) {
      if (file.endsWith('.voice.json')) {
        const charName = file.replace('.voice.json', '');
        characters.push(charName);
      }
    }
    return characters;
  }

  /**
   * Deletes a character voice profile.
   */
  async deleteCharacterProfile(projectName, characterName) {
    const projectDbDir = await this.getVoiceBaseDir(projectName);
    const cleanCharName = this.sanitizeFolderName(characterName);
    const voiceProfilePath = path.join(projectDbDir, `${cleanCharName}.voice.json`);
    try {
      await fs.unlink(voiceProfilePath);
      return { success: true };
    } catch (e) {
      log.error(`[VoiceSignatureService] Failed to delete voice print for ${characterName}:`, e.message);
      return { success: false, error: e.message };
    }
  }
}

module.exports = new VoiceSignatureService();
