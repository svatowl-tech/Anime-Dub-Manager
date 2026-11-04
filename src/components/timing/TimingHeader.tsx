import React from 'react';
import {
  Clock,
  Check,
  RotateCcw,
  Settings,
  Video,
  EyeOff,
  Sliders,
  Loader2,
  Download,
  Scissors,
  Sparkles,
  Search,
  Zap,
  AlertTriangle,
  Activity,
  FolderOpen,
  RefreshCw,
  ArrowRight
} from 'lucide-react';
import { Episode, OriginalStemsState, QAPassportLoadedState, SavedTimingStateInfo } from './timing.types';

export interface TimingHeaderProps {
  currentEpisode: Episode | null;
  savedTimingStateInfo: SavedTimingStateInfo | null;
  isLoading: boolean;
  statusMessage: string;
  isImporting: boolean;
  importProgress: number;
  tracksCount: number;
  isSilenceRemoved: boolean;
  isFixesStitched: boolean;
  isTimingAnalyzed: boolean;
  timingIssuesCount: number;
  qaPassportLoaded: QAPassportLoadedState | null;
  isIssuesDrawerOpen: boolean;
  isLogDrawerOpen: boolean;
  operationLogsCount: number;
  originalStems: OriginalStemsState;
  exportingToMixing: boolean;
  isVideoOpen: boolean;
  videoUrl: string | null;
  isOriginalMuted: boolean;
  isAutoNormalize: boolean;
  onOpenResetConfirm: () => void;
  onOpenSettingsModal: () => void;
  onToggleVideoOpen: () => void;
  onToggleAutoNormalize: () => void;
  onImportFromQA: () => void;
  onCutSilence: () => void;
  onStitchFixes: () => void;
  onAnalyzeTiming: () => void;
  onApplyTargetedAutoTiming: (filter: 'all' | 'overlap' | 'desync' | 'orphan') => void;
  onSyncFromQA: () => void;
  onToggleIssuesDrawer: () => void;
  onToggleLogDrawer: () => void;
  onOpenStemsModal: () => void;
  onOpenExportModal: () => void;
  onExportToMixing: () => void;
}

export const TimingHeader: React.FC<TimingHeaderProps> = ({
  currentEpisode,
  savedTimingStateInfo,
  isLoading,
  statusMessage,
  isImporting,
  importProgress,
  tracksCount,
  isSilenceRemoved,
  isFixesStitched,
  isTimingAnalyzed,
  timingIssuesCount,
  qaPassportLoaded,
  isIssuesDrawerOpen,
  isLogDrawerOpen,
  operationLogsCount,
  originalStems,
  exportingToMixing,
  isVideoOpen,
  videoUrl,
  isOriginalMuted,
  isAutoNormalize,
  onOpenResetConfirm,
  onOpenSettingsModal,
  onToggleVideoOpen,
  onToggleAutoNormalize,
  onImportFromQA,
  onCutSilence,
  onStitchFixes,
  onAnalyzeTiming,
  onApplyTargetedAutoTiming,
  onSyncFromQA,
  onToggleIssuesDrawer,
  onToggleLogDrawer,
  onOpenStemsModal,
  onOpenExportModal,
  onExportToMixing
}) => {
  return (
    <header className="bg-neutral-900 border-b border-neutral-800 px-3 py-2 shrink-0 flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2.5 shrink-0">
        <div className="w-8 h-8 bg-amber-600/20 border border-amber-500/30 text-amber-400 rounded-lg flex items-center justify-center shadow-sm shrink-0">
          <Clock className="w-4 h-4" />
        </div>
        <div className="leading-tight">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold text-white tracking-tight">
              Тайминг — {currentEpisode?.project?.title || 'Проект'}
            </h1>
            <span className="bg-amber-950/80 text-amber-300 font-mono tabular-nums text-[11px] px-1.5 py-0.5 rounded border border-amber-800/50 font-medium">
              Серия #{currentEpisode?.number || 1}
            </span>
            {savedTimingStateInfo && (
              <span
                className="bg-emerald-950/80 text-emerald-300 font-mono text-[10px] px-1.5 py-0.5 rounded border border-emerald-800/50 font-medium inline-flex items-center gap-1 shadow-sm"
                title={`Сохранено в папку ${savedTimingStateInfo.filePath || 'Тайминг/timing_state.json'}\nВремя: ${new Date(savedTimingStateInfo.savedAt).toLocaleTimeString('ru-RU')}`}
              >
                <Check className="w-2.5 h-2.5 text-emerald-400" />
                <span>Сохранено в /Тайминг</span>
              </span>
            )}
          </div>
          <p className="text-[11px] text-neutral-400 hidden xl:block">
            Реалтайм-прослушивание клипов, звук и окно видео, нормализация -18 dBFS
          </p>
        </div>
      </div>

      {/* Uniform Compact Action Buttons Bar */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={onOpenResetConfirm}
          disabled={isLoading}
          className="h-8 px-2.5 bg-neutral-800 hover:bg-neutral-700 text-rose-300 hover:text-rose-200 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border border-rose-800/50 hover:border-rose-600 transition disabled:opacity-50 shrink-0"
          title="Сбросить состояние тайминга и начать сначала с исходных дорожек серии"
        >
          <RotateCcw className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          <span>Начать сначала</span>
        </button>

        <button
          onClick={onOpenSettingsModal}
          className="h-8 px-2.5 bg-neutral-800 hover:bg-neutral-700 text-amber-300 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border border-amber-600/40 transition shrink-0"
          title="Настройки параметров удаления тишины, авто-калибровки, вшития фиксов и автотайминга"
        >
          <Settings className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>Параметры</span>
        </button>

        <button
          onClick={onToggleVideoOpen}
          className={`h-8 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border transition shrink-0 ${
            isVideoOpen
              ? 'bg-sky-950/80 text-sky-300 border-sky-600/70 shadow-sm'
              : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border-neutral-700'
          }`}
          title={isVideoOpen ? 'Скрыть плавающее окно видео (звук оригинала продолжит работать)' : 'Показать плавающее окно видео (S/M/L)'}
        >
          {isVideoOpen ? (
            <Video className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          ) : (
            <EyeOff className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
          )}
          <span>Видео</span>
          {videoUrl && (
            <span className={`w-1.5 h-1.5 rounded-full ${isOriginalMuted ? 'bg-red-400' : 'bg-emerald-400'}`} />
          )}
        </button>

        <button
          onClick={onToggleAutoNormalize}
          className={`h-8 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border transition shrink-0 ${
            isAutoNormalize
              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600/70 shadow-sm'
              : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border-neutral-700'
          }`}
          title="Авто-нормализация громкости при воспроизведении (-18 dBFS RMS с защитой пиков -0.7 dBFS, как во вкладке QA)"
        >
          <Sliders className={`w-3.5 h-3.5 shrink-0 ${isAutoNormalize ? 'text-emerald-400' : 'text-neutral-400'}`} />
          <span>Норм. -18dB</span>
        </button>

        <button
          onClick={onImportFromQA}
          disabled={isLoading}
          className="h-8 px-2.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border border-neutral-700 transition disabled:opacity-50 shrink-0"
          title="1. Импорт дорожек: импорт и сборка дорожек дабберов из QA в тайминг"
        >
          {isImporting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />
              <span className="font-mono tabular-nums">Импорт {importProgress > 0 ? `${importProgress}%` : '...'}</span>
            </>
          ) : (
            <>
              <Download className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span>1. Импорт</span>
            </>
          )}
        </button>

        <button
          onClick={onCutSilence}
          disabled={isLoading || tracksCount === 0}
          className={`h-8 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border transition disabled:opacity-50 shrink-0 ${
            isSilenceRemoved
              ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700/60'
              : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border-neutral-700'
          }`}
          title="2. Удалить тишину: нарезать вейвформу дорожек на отдельные речевые фразы по тишине"
        >
          <Scissors className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>2. Тишина</span>
        </button>

        <button
          onClick={onStitchFixes}
          disabled={isLoading || tracksCount === 0}
          className={`h-8 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border transition disabled:opacity-50 shrink-0 ${
            isFixesStitched
              ? 'bg-amber-950/60 text-amber-300 border-amber-700/60'
              : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border-neutral-700'
          }`}
          title="3. Применить фиксы: вшить фрагменты фиксов или заменить полную дорожку"
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>3. Фиксы</span>
        </button>

        <button
          onClick={onAnalyzeTiming}
          disabled={isLoading || tracksCount === 0}
          className={`h-8 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border transition disabled:opacity-50 shrink-0 ${
            isTimingAnalyzed
              ? 'bg-indigo-950/80 text-indigo-200 border-indigo-700/70'
              : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border-neutral-700'
          }`}
          title="4. Анализ проблем (Whisper): находит наезды, рассинхроны и пропуски"
        >
          {isLoading && statusMessage.includes('Этап 1') ? (
            <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin shrink-0" />
          ) : (
            <Search className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          )}
          <span>4. Анализ</span>
          {timingIssuesCount > 0 && (
            <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-mono tabular-nums font-bold">
              {timingIssuesCount}
            </span>
          )}
        </button>

        <button
          onClick={() => onApplyTargetedAutoTiming('all')}
          disabled={isLoading || tracksCount === 0}
          className={`h-8 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border transition shrink-0 ${
            tracksCount > 0
              ? 'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-500 shadow-sm'
              : 'bg-neutral-800/60 text-neutral-500 border-neutral-800 cursor-not-allowed'
          }`}
          title="5. Точечный автотайминг: раздвигает наезды, выравнивает рассинхроны и проверяет все сабы"
        >
          {isLoading && statusMessage.includes('Этап 2') ? (
            <Loader2 className="w-3.5 h-3.5 text-amber-300 animate-spin shrink-0" />
          ) : (
            <Zap className="w-3.5 h-3.5 text-amber-300 shrink-0" />
          )}
          <span>5. Автотайминг</span>
        </button>

        <button
          onClick={onSyncFromQA}
          disabled={isLoading || tracksCount === 0}
          className={`h-8 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border transition disabled:opacity-50 shrink-0 ${
            qaPassportLoaded
              ? 'bg-amber-950/70 text-amber-300 border-amber-600/60'
              : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border-neutral-700'
          }`}
          title="Синхронизировать данные тайминга с результатами QA проверки косяков серии"
        >
          <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>Паспорт QA</span>
          {qaPassportLoaded && (
            <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-mono tabular-nums font-bold">
              {qaPassportLoaded.summary.totalGaps}
            </span>
          )}
        </button>

        {timingIssuesCount > 0 && (
          <button
            onClick={onToggleIssuesDrawer}
            className={`h-8 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border transition shrink-0 ${
              isIssuesDrawerOpen
                ? 'bg-amber-950/90 text-amber-300 border-amber-600'
                : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border-neutral-700'
            }`}
            title="Панель найденных проблем тайминга"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Проблемы ({timingIssuesCount})</span>
          </button>
        )}

        <button
          onClick={onToggleLogDrawer}
          className={`h-8 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border transition shrink-0 ${
            isLogDrawerOpen
              ? 'bg-amber-950/80 text-amber-300 border-amber-800'
              : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border-neutral-700'
          }`}
          title="Журнал операций тайминга"
        >
          <Activity className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>Журнал ({operationLogsCount})</span>
        </button>

        <button
          onClick={onOpenStemsModal}
          className={`h-8 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border transition shrink-0 ${
            originalStems.hasStems
              ? 'bg-sky-950/80 text-sky-300 border-sky-600/70 shadow-[0_0_10px_rgba(56,189,248,0.2)]'
              : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border-neutral-700'
          }`}
          title="Нейросетевое разделение оригинала на Голоса и Фон M&E"
        >
          <Scissors className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <span>{originalStems.hasStems ? 'Стемы (AI: Вкл)' : 'Разделить оригинал (AI)'}</span>
          {originalStems.hasStems && (
            <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse shrink-0" />
          )}
        </button>

        <button
          onClick={onOpenExportModal}
          disabled={isLoading || tracksCount === 0}
          className="h-8 px-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border border-emerald-500 transition disabled:opacity-50 shrink-0"
          title="Экспорт оттаймленного пакета звукорежиссёру"
        >
          <FolderOpen className="w-3.5 h-3.5 text-emerald-100 shrink-0" />
          <span>Экспорт ЗР</span>
        </button>

        <button
          onClick={onExportToMixing}
          disabled={exportingToMixing || tracksCount === 0}
          className="h-8 px-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 border border-indigo-500 transition disabled:opacity-50 shrink-0"
          title="Передать оттаймленные фразы во вкладку Сведения"
        >
          {exportingToMixing ? <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" /> : <ArrowRight className="w-3.5 h-3.5 shrink-0" />}
          <span>В Сведение</span>
        </button>
      </div>
    </header>
  );
};
