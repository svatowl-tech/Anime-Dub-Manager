export const AI_ENV_REQUIRED_CHANNELS: Record<string, string> = {
  'neural-process-denoise': 'Нейросетевое шумоподавление (DeepFilterNet3)',
  'neural-process-dereverb': 'Удаление эха и реверберации',
  'neural-process-separation': 'Изоляция голоса и стемов (Demucs v4 / Inworld)',
  'neural-process-pedalboard': 'Аудиообработка Pedalboard',
  'neural-process-voicefixer': 'Восстановление вокала (VoiceFixer)',
  'ai-denoise-audio': 'Очистка аудио (DeepFilterNet3)',
  'ai-separate-stems': 'Разделение на вокал и инструментал',
  'ai-dereverb-audio': 'Удаление реверберации',
  'ai-voice-fixer': 'Реставрация голоса',
  'mixing-run-step': 'Нейросетевая обработка в сведении',
  'mixing-run-all-steps': 'Автоматический конвейер сведения',
  'timing-separate-original-stems': 'Разделение оригинальной дорожки (Demucs)',
  'run-diarization': 'Авто-распределение ролей (Диаризация)',
  'transcribe-and-diarize': 'Транскрибация и диаризация (WhisperX)',
  'run-advanced-diarization-pipeline': 'Пайплайн голосовой базы персонажей',
  'learn-voice-from-interval': 'Обучение голосового профиля',
  'auto-train-voice-base': 'Автообучение голосовой базы',
  'audio-run-track-analysis': 'AI-анализ аудиодорожки',
  'audio-analyze-original-snapshots': 'Анализ акустического профиля оригинала',
  'audio-apply-acoustic-match': 'Акустическое выравнивание дорожек',
  'transcribe-whisper': 'Распознавание речи (Whisper)',
  'transcribe-whisper-snippet': 'Распознавание фрагмента (Whisper)',
  'qa-whisper-check-lines': 'QA-проверка реплик (Whisper)',
  'timing-whisper-transcribe-clips': 'Автотайминг по речи (Whisper)',
  'start-whisper-livekit-server': 'Локальный сервер Whisper LiveKit',
};

export interface AiEnvPromptRequest {
  featureName: string;
  mode: 'install' | 'update';
  resolve: (installed: boolean) => void;
}

type ModalListener = (req: AiEnvPromptRequest | null) => void;

let activeListener: ModalListener | null = null;
let pendingPromise: Promise<boolean> | null = null;
let pendingRequest: AiEnvPromptRequest | null = null;

export function registerAiEnvModalListener(listener: ModalListener): () => void {
  activeListener = listener;
  if (pendingRequest) {
    listener(pendingRequest);
  }
  return () => {
    if (activeListener === listener) {
      activeListener = null;
    }
  };
}

export function isAiEnvModalMounted(): boolean {
  return Boolean(activeListener);
}

export function requestAiEnvInstallation(
  featureName: string,
  mode: 'install' | 'update' = 'install'
): Promise<boolean> {
  if (pendingPromise) {
    return pendingPromise;
  }

  pendingPromise = new Promise<boolean>((resolve) => {
    const req: AiEnvPromptRequest = {
      featureName,
      mode,
      resolve: (installed: boolean) => {
        pendingRequest = null;
        pendingPromise = null;
        if (activeListener) {
          activeListener(null);
        }
        resolve(installed);
      },
    };
    pendingRequest = req;
    if (activeListener) {
      activeListener(req);
    } else {
      pendingRequest = null;
      pendingPromise = null;
      resolve(false);
    }
  });

  return pendingPromise;
}

export function isMissingAiEnvError(error: any): boolean {
  const msg = String(error?.message || error || '').toLowerCase();
  return (
    msg.includes('интерпретатор python не найден') ||
    msg.includes('проверьте установку ai-окружения') ||
    msg.includes('ai_env не установлено') ||
    msg.includes('не найден python') ||
    msg.includes('no module named')
  );
}
