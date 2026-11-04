import { OriginalStemsState } from './timing.types';

export const TIMING_STORAGE_KEYS = {
  SETTINGS: 'dubflow_timing_settings',
  VIDEO_OPEN: 'dubflow_timing_video_open',
  VIDEO_SIZE: 'dubflow_timing_video_size',
  VIDEO_POS: 'dubflow_timing_video_pos',
  ORIG_WAVE_SCALE: 'dubflow_timing_orig_wave_scale',
  ORIG_WAVE_NORM: 'dubflow_timing_orig_wave_norm',
} as const;

export const DEFAULT_ORIGINAL_STEMS_STATE: OriginalStemsState = {
  hasStems: false,
  isSeparating: false,
  separationProgress: 0,
  separationStatus: '',
  modelId: 'uvr_mdx_voc_ft',
  vocalsUrl: null,
  vocalsPath: null,
  vocalsPeaks: null,
  vocalsMuted: false,
  vocalsVolume: 1.0,
  instrumentalUrl: null,
  instrumentalPath: null,
  instrumentalPeaks: null,
  instrumentalMuted: false,
  instrumentalVolume: 0.85
};

export interface StemSeparationModelOption {
  id: string;
  title: string;
  desc: string;
  badge: string;
}

export const STEM_SEPARATION_MODELS: readonly StemSeparationModelOption[] = [
  {
    id: 'uvr_mdx_voc_ft',
    title: 'UVR MDX-Net Vocals FT (Рекомендуется)',
    desc: 'Наивысшее качество разделения вокала/речи и саундтрека. Идеально для аниме.',
    badge: 'ТОП'
  },
  {
    id: 'kim_vocal_2',
    title: 'Kim Vocal 2 (MDX-Net)',
    desc: 'Отличная детализация средних частот и разборчивость тихих диалогов.',
    badge: 'Речь'
  },
  {
    id: 'htdemucs_ft',
    title: 'HTDemucs Fine-Tuned (Hybrid Transformer)',
    desc: 'Многополосный трансформер — максимально чистый M&E инструментал.',
    badge: 'M&E'
  },
  {
    id: 'mdx23c_8step',
    title: 'MDX23C 8-Step (Fast Diffusion)',
    desc: 'Быстрая диффузионная архитектура с высокой естественностью.',
    badge: 'Скорость'
  },
  {
    id: 'ffmpeg_vocal_remover',
    title: 'Быстрый фильтр FFmpeg (Center Channel Splitter)',
    desc: 'Без применения нейросетей, мгновенный расчёт за 1–2 секунды.',
    badge: 'Без GPU'
  }
] as const;

export const AI_TRACK_CLEANUP_OPTIONS = [
  { mode: 'full', label: '✨ Полная очистка (Пресет)', desc: 'Гейт + щелчки + де-эссер + дыхание' },
  { mode: 'noise_gate', label: '🔇 Spectral Noise Gate', desc: 'Подавление шума пауз между словами' },
  { mode: 'de_click', label: '⚡ Удаление щелчков (De-Click)', desc: 'Убирает слюну и микрофонные клики' },
  { mode: 'de_esser', label: '🐍 Мягкий De-Esser (5-9 кГц)', desc: 'Смягчает резкие сибилянты С/З/Щ/Ц' },
  { mode: 'breath_control', label: '🌬️ Смягчение вдохов (Breath)', desc: 'Приглушает резкие вдохи перед фразами' }
] as const;
