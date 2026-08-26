import React from 'react';
import { 
  Play, 
  Sparkles, 
  Cpu, 
  Database, 
  Bot, 
  ShieldCheck, 
  Sliders, 
  Key, 
  Users, 
  FileAudio,
  Radio,
  CheckCircle2,
  AlertCircle,
  HelpCircle
} from 'lucide-react';
import { Episode, SubtitleLine } from '../../types';
import { DiarizationMethod } from '../../types/diarization';

interface DiarizationPipelineTabProps {
  currentEpisode: Episode | null;
  subLines: SubtitleLine[];
  diarizationMethod: DiarizationMethod;
  setDiarizationMethod: (method: DiarizationMethod) => void;
  expectedSpeakers: number;
  setExpectedSpeakers: (count: number) => void;
  hfToken: string;
  setHfToken: (token: string) => void;
  useOllamaContext: boolean;
  setUseOllamaContext: (val: boolean) => void;
  ollamaModels: string[];
  selectedOllamaModel: string;
  setSelectedOllamaModel: (model: string) => void;
  useVoiceBase: boolean;
  setUseVoiceBase: (val: boolean) => void;
  correctionMode: boolean;
  setCorrectionMode: (val: boolean) => void;
  isProcessing: boolean;
  onStartPipeline: () => void;
  onStartTranscribeAndDiarize: () => void;
  isEnvReady: boolean;
}

export const DiarizationPipelineTab: React.FC<DiarizationPipelineTabProps> = ({
  currentEpisode,
  subLines,
  diarizationMethod,
  setDiarizationMethod,
  expectedSpeakers,
  setExpectedSpeakers,
  hfToken,
  setHfToken,
  useOllamaContext,
  setUseOllamaContext,
  ollamaModels,
  selectedOllamaModel,
  setSelectedOllamaModel,
  useVoiceBase,
  setUseVoiceBase,
  correctionMode,
  setCorrectionMode,
  isProcessing,
  onStartPipeline,
  onStartTranscribeAndDiarize,
  isEnvReady,
}) => {
  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full py-2">
      {/* Overview Card */}
      <div className="bg-gradient-to-r from-indigo-900/40 via-purple-900/20 to-neutral-900 border border-indigo-500/20 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-400 shrink-0">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                Интеллектуальный конвейер диаризации (Auto-Diarize 2.0)
              </h3>
              <p className="text-xs text-neutral-300 mt-1 leading-relaxed max-w-2xl">
                Полный цикл разделения голосов: акустическая сегментация по таймкодам, анализ диалогов через LLM (Ollama) и верификация по базе спектральных слепков персонажей.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-3 py-1 bg-neutral-900 border border-neutral-800 text-neutral-300 text-xs rounded-lg font-mono">
              Реплик в серии: <strong className="text-white">{subLines.length}</strong>
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Core Engine & Parameters (7 cols) */}
        <div className="lg:col-span-7 bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl space-y-5">
          <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-2">
            <Sliders className="w-4 h-4" />
            1. Движок разделения голосов
          </h4>

          {/* Engine Selector */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <button
              type="button"
              onClick={() => setDiarizationMethod('whisperx')}
              className={`p-3 rounded-xl border text-left flex flex-col justify-between gap-1 transition-all ${
                diarizationMethod === 'whisperx'
                  ? 'bg-indigo-600/15 border-indigo-500 text-white shadow-sm'
                  : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:border-neutral-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">WhisperX</span>
                <span className="text-[9px] px-1.5 py-0.5 bg-indigo-500/20 text-indigo-300 rounded font-semibold">PyAnnote</span>
              </div>
              <span className="text-[10px] text-neutral-400 leading-tight">Высочайшая точность, интеграция PyTorch</span>
            </button>

            <button
              type="button"
              onClick={() => setDiarizationMethod('wlk_sortformer')}
              className={`p-3 rounded-xl border text-left flex flex-col justify-between gap-1 transition-all ${
                diarizationMethod === 'wlk_sortformer'
                  ? 'bg-indigo-600/15 border-indigo-500 text-white shadow-sm'
                  : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:border-neutral-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">Sortformer</span>
                <span className="text-[9px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-300 rounded font-semibold">WLK SOTA</span>
              </div>
              <span className="text-[10px] text-neutral-400 leading-tight">Сверхбыстрый, поддержка потокового Sidecar</span>
            </button>

            <button
              type="button"
              onClick={() => setDiarizationMethod('onnx_transformers')}
              className={`p-3 rounded-xl border text-left flex flex-col justify-between gap-1 transition-all ${
                diarizationMethod === 'onnx_transformers'
                  ? 'bg-indigo-600/15 border-indigo-500 text-white shadow-sm'
                  : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:border-neutral-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">ONNX Встроенный</span>
                <span className="text-[9px] px-1.5 py-0.5 bg-neutral-800 text-neutral-300 rounded font-semibold">Без Python</span>
              </div>
              <span className="text-[10px] text-neutral-400 leading-tight">Работает без установки среды Python</span>
            </button>
          </div>

          {/* Speakers Count & HF Token */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-neutral-800/80">
            <div>
              <label className="block text-[11px] font-medium text-neutral-400 mb-1 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-indigo-400" />
                Ожидаемое число спикеров
              </label>
              <select
                value={expectedSpeakers}
                onChange={(e) => setExpectedSpeakers(parseInt(e.target.value, 10))}
                className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-xl text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value={0}>Автоопределение (Авто)</option>
                <option value={2}>2 спикера (Дуэт)</option>
                <option value={3}>3 спикера</option>
                <option value={4}>4 спикера</option>
                <option value={5}>5 спикеров</option>
                <option value={6}>6+ спикеров</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-neutral-400 mb-1 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-indigo-400" />
                Hugging Face Token (Pyannote)
              </label>
              <input
                type="password"
                placeholder="hf_..."
                value={hfToken}
                onChange={(e) => setHfToken(e.target.value)}
                className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-xl text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>
          </div>

          <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-2 pt-2 border-t border-neutral-800/80">
            <Cpu className="w-4 h-4" />
            2. Интеллектуальный анализ и верификация
          </h4>

          {/* AI Features Checklist */}
          <div className="space-y-3">
            {/* Ollama Context Analysis */}
            <div className="p-3.5 bg-neutral-950 border border-neutral-850 rounded-xl space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Bot className="w-4 h-4 text-indigo-400" />
                  <div>
                    <span className="text-xs font-bold text-white block">Анализ контекста через LLM (Ollama)</span>
                    <span className="text-[10px] text-neutral-500">Автоматически сопоставляет Speaker 1 с персонажами сюжета</span>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={useOllamaContext}
                  onChange={(e) => setUseOllamaContext(e.target.checked)}
                  className="rounded border-neutral-700 text-indigo-600 focus:ring-0 w-4 h-4 cursor-pointer"
                />
              </div>

              {useOllamaContext && ollamaModels.length > 0 && (
                <div className="pt-2 border-t border-neutral-850 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-neutral-400">Модель Ollama:</span>
                  <select
                    value={selectedOllamaModel}
                    onChange={(e) => setSelectedOllamaModel(e.target.value)}
                    className="px-2.5 py-1 bg-neutral-900 border border-neutral-800 rounded-lg text-xs text-white font-mono"
                  >
                    {ollamaModels.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Voice Base Matching */}
            <label className="flex items-center justify-between p-3.5 bg-neutral-950 border border-neutral-850 rounded-xl cursor-pointer hover:bg-neutral-925 transition-colors">
              <div className="flex items-center gap-2.5">
                <Database className="w-4 h-4 text-purple-400" />
                <div>
                  <span className="text-xs font-bold text-white block">Сверка с Базой Голосов проекта</span>
                  <span className="text-[10px] text-neutral-500">Сравнивает акустический тембр с сохраненными слепками персонажей</span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={useVoiceBase}
                onChange={(e) => setUseVoiceBase(e.target.checked)}
                className="rounded border-neutral-700 text-indigo-600 focus:ring-0 w-4 h-4 cursor-pointer"
              />
            </label>

            {/* Review mode checkbox */}
            <label className="flex items-center justify-between p-3.5 bg-neutral-950 border border-neutral-850 rounded-xl cursor-pointer hover:bg-neutral-925 transition-colors">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <div>
                  <span className="text-xs font-bold text-white block">Предпросмотр перед записью (Режим проверки)</span>
                  <span className="text-[10px] text-neutral-500">Показывает таблицу утверждения реплик перед сохранением в файл</span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={correctionMode}
                onChange={(e) => setCorrectionMode(e.target.checked)}
                className="rounded border-neutral-700 text-indigo-600 focus:ring-0 w-4 h-4 cursor-pointer"
              />
            </label>
          </div>
        </div>

        {/* Right Column: Execution Triggers & Instructions (5 cols) */}
        <div className="lg:col-span-5 flex flex-col justify-between gap-6">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl space-y-4">
            <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-2">
              <Play className="w-4 h-4" />
              Запуск процессов
            </h4>

            {/* Primary Action: Align Existing Subtitles with Voices */}
            <div className="p-4 bg-neutral-950 border border-neutral-800 rounded-xl space-y-3">
              <div>
                <div className="text-xs font-bold text-white">Разметить текущие субтитры по голосам</div>
                <div className="text-[11px] text-neutral-400 mt-0.5">
                  Берет ваши русские субтитры ({subLines.length} строк) и на основе аудио распределяет персонажей.
                </div>
              </div>

              <button
                type="button"
                onClick={onStartPipeline}
                disabled={isProcessing || !currentEpisode?.rawPath || subLines.length === 0}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold rounded-xl shadow-lg shadow-indigo-600/20 transition-all cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                Запустить ИИ-разметку субтитров
              </button>
            </div>

            {/* Secondary Action: Full Video Separation & Transcription with Diarization */}
            <div className="p-4 bg-neutral-950 border border-neutral-800 rounded-xl space-y-3">
              <div>
                <div className="text-xs font-bold text-white">Транскрибация + Диаризация с нуля</div>
                <div className="text-[11px] text-neutral-400 mt-0.5">
                  Если у вас нет субтитров: распознает речь и сразу создает .ASS файл с разделением по ролям.
                </div>
              </div>

              <button
                type="button"
                onClick={onStartTranscribeAndDiarize}
                disabled={isProcessing || !currentEpisode?.rawPath}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-white text-xs font-semibold rounded-xl border border-neutral-700 transition-all cursor-pointer"
              >
                <FileAudio className="w-4 h-4 text-indigo-400" />
                Распознать и разделить видео на голоса
              </button>
            </div>
          </div>

          {/* Quick Help Card */}
          <div className="bg-neutral-950/60 border border-neutral-800/80 rounded-2xl p-4 text-[11px] text-neutral-400 space-y-1.5">
            <div className="text-neutral-300 font-semibold flex items-center gap-1.5">
              <HelpCircle className="w-3.5 h-3.5 text-indigo-400" />
              Как работает авто-расстановка?
            </div>
            <p>
              1. Нейросеть находит интервалы активности каждого голоса в аудиодорожке видео.
            </p>
            <p>
              2. Текст сопоставляется с таймингами и сверяется с Базой Голосов персонажей.
            </p>
            <p>
              3. Результат подставляется в столбец "Имя" (Actor/Name) в субтитрах без искажения текста.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
