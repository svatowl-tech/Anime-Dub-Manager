import { ipcSafe } from '../lib/ipcSafe';
import {
  ActingModelsStatus,
  ActingResourceProfile,
  CharacterPersonaProfile,
  DEFAULT_QA_DETECTION_SETTINGS,
  QAActingProgress,
  QADetectionSettings,
  StressDictionaryEntry,
} from '../lib/qa/detector/missingLinesTypes';

export interface QAAnalyzeEpisodeLinePayload {
  id: string;
  character: string;
  dubberId: string;
  text: string;
  startSec: number;
  endSec: number;
  trackId: string;
  trackFilePath?: string;
}

export interface QAAnalyzeEpisodePayload {
  projectId?: string;
  projectTitle?: string;
  episodeId?: string;
  episode?: any;
  videoPath?: string;
  lines: QAAnalyzeEpisodeLinePayload[];
  trackPaths: Record<string, string>;
  settings: Partial<QADetectionSettings>;
}

export interface QABackendActingIssue {
  lineId: string;
  type: 'speech_disfluency' | 'diction_clarity' | 'emotion_mismatch' | 'stress_error' | 'persona_mismatch';
  severity: 'info' | 'warning';
  title: string;
  description: string;
  disfluencySubtype?: string;
  disfluencyDetails?: string;
  eventOffsetSec?: number;
  gopScore?: number;
  speechRateSyllablesPerSec?: number;
  originalSpeechRateSyllablesPerSec?: number;
  emotionDubberArousal?: number;
  emotionOrigArousal?: number;
  emotionDubberValence?: number;
  emotionOrigValence?: number;
  f0StdHz?: number;
  stressWord?: string;
  stressExpectedIndex?: number;
  stressActualIndex?: number;
  stressExpectedMarked?: string;
  stressActualMarked?: string;
  stressRuleSource?: 'dictionary' | 'ruaccent';
  personaExpectedAgeGroup?: string;
  personaDetectedAgeYears?: number;
  personaDetectedGender?: string;
  personaVoiceSimilarity?: number;
}

export interface QAAnalyzeEpisodeResponse {
  issues: QABackendActingIssue[];
  analyzedLines: number;
  originalVocalsPath: string | null;
}

class QAActingService {
  async checkModels(profile: ActingResourceProfile = 'full_acting'): Promise<ActingModelsStatus> {
    return await ipcSafe.invoke('qa-acting-check-models', { profile });
  }

  async downloadModels(profile: ActingResourceProfile = 'full_acting'): Promise<ActingModelsStatus> {
    return await ipcSafe.invoke('qa-acting-download-models', { profile });
  }

  async analyzeEpisode(payload: QAAnalyzeEpisodePayload): Promise<QAAnalyzeEpisodeResponse> {
    return await ipcSafe.invoke('qa-acting-analyze-episode', payload);
  }

  async getDetectionSettings(): Promise<QADetectionSettings> {
    try {
      const saved = await ipcSafe.invoke('qa-get-detection-settings');
      if (saved && typeof saved === 'object') {
        return { ...DEFAULT_QA_DETECTION_SETTINGS, ...saved };
      }
    } catch {}
    return { ...DEFAULT_QA_DETECTION_SETTINGS };
  }

  async saveDetectionSettings(settings: QADetectionSettings): Promise<QADetectionSettings> {
    await ipcSafe.invoke('qa-save-detection-settings', settings);
    return settings;
  }

  async getStressDictionary(projectId?: string | null): Promise<StressDictionaryEntry[]> {
    const res = await ipcSafe.invoke('qa-get-stress-dictionary', { projectId: projectId || null });
    return Array.isArray(res) ? res : [];
  }

  async saveStressEntry(entry: Partial<StressDictionaryEntry> & { word: string; stressedForm: string }): Promise<StressDictionaryEntry> {
    return await ipcSafe.invoke('qa-save-stress-entry', entry);
  }

  async deleteStressEntry(id: string): Promise<void> {
    await ipcSafe.invoke('qa-delete-stress-entry', { id });
  }

  async getCharacterProfiles(projectId?: string | null): Promise<CharacterPersonaProfile[]> {
    const res = await ipcSafe.invoke('qa-get-character-profiles', { projectId: projectId || null });
    return Array.isArray(res) ? res : [];
  }

  async saveCharacterProfile(profile: Partial<CharacterPersonaProfile> & { characterName: string }): Promise<CharacterPersonaProfile> {
    return await ipcSafe.invoke('qa-save-character-profile', profile);
  }

  subscribeProgress(cb: (prog: QAActingProgress) => void): () => void {
    const handler = (_event: any, data: QAActingProgress) => {
      if (data) cb(data);
    };
    ipcSafe.on('qa-acting-progress', handler);
    return () => ipcSafe.removeListener('qa-acting-progress', handler);
  }
}

export const qaActingService = new QAActingService();
