/**
 * Whisper Text QA Checker
 * 
 * Verifies dubbed speech against expected subtitle lines using Whisper ASR (model: small/base)
 * with prompt hints to accurately transcribe Japanese names and anime terminology.
 * Detects:
 *  - Missing words / truncated lines (пропуск слов)
 *  - Word substitutions / ad-libbing (отсебятина / замена слов)
 *  - Extra words / stumbles / retakes (лишние слова, запинки, повторные дубли)
 */

import { SubtitleLine, Track } from '../../types';
import { ipcSafe, isWeb } from '../ipcSafe';

export interface WordDiff {
  word: string;
  status: 'equal' | 'missing' | 'added';
}

export type TextDiscrepancyType = 'missing_words' | 'changed_words' | 'extra_words_or_retake';

export interface WhisperTextComparisonResult {
  lineIndex: number;
  expectedText: string;
  recognizedText: string;
  similarityPercent: number;
  discrepancyType?: TextDiscrepancyType;
  wordDiffs: WordDiff[];
  isDiscrepancy: boolean;
  summaryDescription: string;
}

/**
 * Normalizes text for comparison (lowercase, removes punctuation, replaces ё with е)
 */
export function normalizeSpeechText(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'«»—–…\n\r]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Computes word-level diff using Longest Common Subsequence (LCS)
 */
export function computeWordDiff(expectedText: string, recognizedText: string): {
  diffs: WordDiff[];
  similarity: number;
  missingWords: string[];
  addedWords: string[];
} {
  const normExpected = normalizeSpeechText(expectedText);
  const normRecognized = normalizeSpeechText(recognizedText);

  const wordsExp = normExpected ? normExpected.split(' ') : [];
  const wordsRec = normRecognized ? normRecognized.split(' ') : [];

  if (wordsExp.length === 0 && wordsRec.length === 0) {
    return { diffs: [], similarity: 100, missingWords: [], addedWords: [] };
  }

  if (wordsExp.length === 0) {
    const diffs: WordDiff[] = wordsRec.map(w => ({ word: w, status: 'added' }));
    return { diffs, similarity: 0, missingWords: [], addedWords: wordsRec };
  }

  if (wordsRec.length === 0) {
    const diffs: WordDiff[] = wordsExp.map(w => ({ word: w, status: 'missing' }));
    return { diffs, similarity: 0, missingWords: wordsExp, addedWords: [] };
  }

  // LCS dynamic programming table
  const n = wordsExp.length;
  const m = wordsRec.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (wordsExp[i - 1] === wordsRec[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build diffs
  let i = n;
  let j = m;
  const resultDiffs: WordDiff[] = [];
  const missingWords: string[] = [];
  const addedWords: string[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && wordsExp[i - 1] === wordsRec[j - 1]) {
      resultDiffs.unshift({ word: wordsExp[i - 1], status: 'equal' });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      resultDiffs.unshift({ word: wordsRec[j - 1], status: 'added' });
      addedWords.unshift(wordsRec[j - 1]);
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      resultDiffs.unshift({ word: wordsExp[i - 1], status: 'missing' });
      missingWords.unshift(wordsExp[i - 1]);
      i--;
    }
  }

  const matchCount = dp[n][m];
  const similarity = Math.round((2 * matchCount) / (wordsExp.length + wordsRec.length) * 100);

  return {
    diffs: resultDiffs,
    similarity,
    missingWords,
    addedWords
  };
}

/**
 * Classifies discrepancy between expected subtitle text and recognized speech
 */
export function classifyDiscrepancy(
  expectedText: string,
  recognizedText: string,
  lineIndex: number
): WhisperTextComparisonResult {
  const { diffs, similarity, missingWords, addedWords } = computeWordDiff(expectedText, recognizedText);

  // If match is high (>= 90%) and no missing words, it's considered valid
  if (similarity >= 90 && missingWords.length === 0 && addedWords.length === 0) {
    return {
      lineIndex,
      expectedText,
      recognizedText,
      similarityPercent: similarity,
      wordDiffs: diffs,
      isDiscrepancy: false,
      summaryDescription: 'Текст совпадает с репликой сценария'
    };
  }

  let discrepancyType: TextDiscrepancyType = 'changed_words';
  let summary = '';

  if (missingWords.length > 0 && addedWords.length === 0) {
    discrepancyType = 'missing_words';
    summary = `Пропущены слова (${missingWords.slice(0, 3).join(', ')}${missingWords.length > 3 ? '...' : ''})`;
  } else if (addedWords.length >= 2 && missingWords.length === 0) {
    discrepancyType = 'extra_words_or_retake';
    summary = `Лишние слова / дубль (${addedWords.slice(0, 3).join(', ')}${addedWords.length > 3 ? '...' : ''})`;
  } else {
    discrepancyType = 'changed_words';
    summary = `Изменение текста / отсебятина (сходство ${similarity}%)`;
  }

  // Threshold: if similarity < 85% or there are missing/extra words, flag it!
  const isDiscrepancy = similarity < 88 || missingWords.length > 0 || addedWords.length > 0;

  return {
    lineIndex,
    expectedText,
    recognizedText,
    similarityPercent: similarity,
    discrepancyType,
    wordDiffs: diffs,
    isDiscrepancy,
    summaryDescription: summary
  };
}

export interface LineToCheck {
  lineIndex: number;
  subId?: string;
  startSec: number;
  endSec: number;
  startFormatted: string;
  endFormatted: string;
  characterName: string;
  text: string;
}

export interface WhisperReadinessResult {
  isReady: boolean;
  canLoadModel: boolean;
  isModelDownloaded?: boolean;
  availableModels: string[];
  activeModel: string;
  statusText: string;
  details?: string;
  backendType?: string;
  errorMessage?: string;
}

export interface TrackWhisperExecutionResult {
  success: boolean;
  errorMessage?: string;
  results: WhisperTextComparisonResult[];
  logs: string[];
}

/**
 * Checks if the Whisper system is ready to start loading the chosen model
 */
export async function checkWhisperSystemReadiness(modelName: string = 'small'): Promise<WhisperReadinessResult> {
  try {
    const res = await ipcSafe.invoke('get-whisper-system-status', { model: modelName });
    if (res && typeof res === 'object') {
      const isDownloaded = res.isModelDownloaded ?? (Array.isArray(res.availableModels) && res.availableModels.includes(modelName));
      return {
        isReady: res.isReady !== false,
        canLoadModel: res.canLoadModel !== false,
        isModelDownloaded: isDownloaded,
        availableModels: res.availableModels || ['small', 'base', 'tiny'],
        activeModel: modelName,
        statusText: res.statusText || (isDownloaded 
          ? `Система Whisper готова к загрузке модели «${modelName}» (модель уже скачана на диск)`
          : `Система Whisper готова к загрузке модели «${modelName}» (модель будет скачана при старте)`),
        details: res.details || 'Движок Whisper ASR готов к работе и загрузке весов модели в память.',
        backendType: res.backendType || 'desktop'
      };
    }
  } catch (err: any) {
    console.warn('[WhisperReadiness] Check failed:', err?.message || err);
    return {
      isReady: false,
      canLoadModel: false,
      isModelDownloaded: false,
      availableModels: [],
      activeModel: modelName,
      statusText: `Система Whisper не готова: ${err?.message || 'Сервис недоступен'}`,
      errorMessage: err?.message || 'Служба Whisper недоступна или не отвечает',
      details: 'Не удалось получить ответ от бэкенда Whisper. Проверьте запуск службы распознавания.',
      backendType: 'error'
    };
  }

  return {
    isReady: true,
    canLoadModel: true,
    isModelDownloaded: true,
    availableModels: ['small', 'base', 'tiny'],
    activeModel: modelName,
    statusText: `Система Whisper готова к загрузке модели «${modelName}»`,
    details: 'Движок Whisper ASR готов к загрузке модели в память.',
    backendType: 'auto'
  };
}

/**
 * Executes Whisper ASR text comparison for a track's voiced lines with full logging
 */
export async function checkTrackTextWithWhisper(
  audioFilePath: string,
  lines: LineToCheck[],
  modelName: string = 'small',
  onProgress?: (current: number, total: number, msg: string) => void,
  onLog?: (msg: string, level: 'info' | 'warn' | 'error' | 'success') => void
): Promise<TrackWhisperExecutionResult> {
  const logs: string[] = [];
  const logHelper = (msg: string, level: 'info' | 'warn' | 'error' | 'success' = 'info') => {
    logs.push(msg);
    onLog?.(msg, level);
  };

  if (lines.length === 0) {
    logHelper('[Whisper ASR] Список реплик для сверки пуст, пропуск дорожки.', 'info');
    return { success: true, results: [], logs };
  }

  logHelper(`[Whisper ASR] Инициализация сверки дорожки (${lines.length} реплик). Модель: «${modelName}», язык: ru`, 'info');

  if (!audioFilePath) {
    const errorMsg = 'Проверка по Whisper неудачна: аудиофайл дорожки не задан или недоступен';
    logHelper(`[Whisper ASR] ❌ ${errorMsg}`, 'error');
    return { success: false, errorMessage: errorMsg, results: [], logs };
  }

  // Check system readiness before loading model
  logHelper(`[Whisper ASR] Проверка готовности системы Whisper к загрузке модели «${modelName}»...`, 'info');
  const readiness = await checkWhisperSystemReadiness(modelName);

  if (!readiness.isReady || !readiness.canLoadModel) {
    const errorMsg = `Проверка по Whisper не произошла: система Whisper не готова к загрузке модели «${modelName}» (${readiness.errorMessage || readiness.statusText})`;
    logHelper(`[Whisper ASR] ❌ ${errorMsg}`, 'error');
    return {
      success: false,
      errorMessage: errorMsg,
      results: [],
      logs
    };
  }

  logHelper(`[Whisper ASR] Система Whisper готова к загрузке модели. Отправка запроса на распознавание ${lines.length} реплик...`, 'info');

  try {
    // Attempt IPC call
    const ipcResponse = await ipcSafe.invoke('qa-whisper-check-lines', {
      audioFilePath,
      lines: lines.map(l => ({
        lineIndex: l.lineIndex,
        startSec: l.startSec,
        endSec: l.endSec,
        characterName: l.characterName,
        text: l.text
      })),
      model: modelName,
      language: 'ru'
    });

    if (ipcResponse && Array.isArray(ipcResponse.results)) {
      logHelper(`[Whisper ASR] Ответ получен от Whisper бэкенда: успешно обработано ${ipcResponse.results.length} реплик.`, 'success');

      let discrepanciesCount = 0;
      const results = ipcResponse.results.map((r: any) => {
        const comp = classifyDiscrepancy(r.expectedText, r.recognizedText, r.lineIndex);
        if (comp.isDiscrepancy) {
          discrepanciesCount++;
          logHelper(`[Whisper ASR] ⚠️ Расхождение в реплике #${r.lineIndex}: "${r.expectedText.slice(0, 30)}..." → сказано: "${r.recognizedText.slice(0, 30)}..." (${comp.summaryDescription})`, 'warn');
        }
        return comp;
      });

      logHelper(`[Whisper ASR] Сверка дорожки завершена: проверено ${results.length} реплик, выявлено расхождений: ${discrepanciesCount}`, discrepanciesCount > 0 ? 'warn' : 'success');
      return {
        success: true,
        results,
        logs
      };
    } else {
      const errorMsg = 'Проверка по Whisper неудачна: бэкенд Whisper вернул пустой или некорректный ответ';
      logHelper(`[Whisper ASR] ❌ ${errorMsg}`, 'error');
      return {
        success: false,
        errorMessage: errorMsg,
        results: [],
        logs
      };
    }
  } catch (err: any) {
    const errorMsg = `Проверка по Whisper неудачна / не произошла: ${err?.message || 'Сбой выполнения'}`;
    logHelper(`[Whisper ASR] ❌ ${errorMsg}`, 'error');
    return {
      success: false,
      errorMessage: errorMsg,
      results: [],
      logs
    };
  }
}
