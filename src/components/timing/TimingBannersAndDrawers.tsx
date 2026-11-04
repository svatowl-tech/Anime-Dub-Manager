import React from 'react';
import {
  Loader2,
  Check,
  AlertTriangle,
  Clock,
  CheckCircle2,
  RefreshCw,
  Search,
  Zap,
  MoveHorizontal,
  Crosshair,
  X,
  Download,
  Copy,
  Sliders,
  Layers,
  Activity
} from 'lucide-react';
import {
  ActiveTimingProcess,
  DecodedTrackProgressItem,
  QAPassportLoadedState,
  TimingIssue,
  IssueFilterType,
  MissingSubtitleMarker,
  FinalVerificationReport,
  NoiseCalibration,
  Track,
  AudioClip,
  NormalizationMetrics,
  TrackHeightMode,
  OperationLogEntry
} from './timing.types';
import { formatSeconds } from './timing.utils';

export interface TimingActiveProcessBarProps {
  activeProcess: ActiveTimingProcess | null;
  isLoading: boolean;
  statusMessage: string;
  importProgress: number;
  importDecodedTracks: DecodedTrackProgressItem[];
}

export const TimingActiveProcessBar: React.FC<TimingActiveProcessBarProps> = ({
  activeProcess,
  isLoading,
  statusMessage,
  importProgress,
  importDecodedTracks
}) => {
  if (!activeProcess && !isLoading) return null;

  return (
    <div className="bg-neutral-900/95 border-b border-indigo-500/40 px-4 py-1.5 flex flex-col gap-1 shadow-md z-40 shrink-0">
      <div className="flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin shrink-0" />
          <span className="font-bold text-white shrink-0">
            {activeProcess?.title || 'Выполнение операции'}
          </span>
          <span className="text-neutral-400 truncate font-mono text-[11px]">
            — {activeProcess?.detail || statusMessage || 'Обработка...'}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {importDecodedTracks.length > 0 && (
            <span className="text-[10px] font-mono tabular-nums text-neutral-400 hidden sm:inline">
              Дорожки: {importDecodedTracks.filter(t => t.status === 'done').length}/{importDecodedTracks.length}
            </span>
          )}
          <span className="text-[11px] font-mono tabular-nums text-indigo-300 font-bold bg-indigo-950/90 px-2 py-0.5 rounded border border-indigo-700/50">
            {activeProcess ? activeProcess.progress : importProgress}%
          </span>
        </div>
      </div>
      <div className="w-full bg-neutral-950 rounded-full h-1.5 overflow-hidden border border-neutral-800">
        <div
          className="bg-gradient-to-r from-sky-500 via-indigo-500 to-amber-400 h-full rounded-full transition-all duration-200"
          style={{ width: `${Math.max(3, Math.min(100, activeProcess ? activeProcess.progress : importProgress))}%` }}
        />
      </div>
      {importDecodedTracks.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 scrollbar-thin">
          {importDecodedTracks.map(t => (
            <span
              key={t.id}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums inline-flex items-center gap-1 shrink-0 border ${
                t.status === 'done'
                  ? 'bg-emerald-950/50 border-emerald-800/60 text-emerald-300'
                  : t.status === 'decoding'
                  ? 'bg-indigo-950/80 border-indigo-600/70 text-indigo-200 font-bold'
                  : t.status === 'error'
                  ? 'bg-red-950/60 border-red-800/60 text-red-300'
                  : 'bg-neutral-900 border-neutral-800 text-neutral-500'
              }`}
            >
              {t.status === 'done' ? <Check className="w-2.5 h-2.5 text-emerald-400" /> :
               t.status === 'decoding' ? <Loader2 className="w-2.5 h-2.5 text-indigo-400 animate-spin" /> :
               t.status === 'error' ? <AlertTriangle className="w-2.5 h-2.5 text-red-400" /> :
               <Clock className="w-2.5 h-2.5 text-neutral-600" />}
              <span className="truncate max-w-[110px]">{t.name}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export interface TimingQAPassportBannerProps {
  qaPassportLoaded: QAPassportLoadedState | null;
  timingIssuesCount: number;
  onOpenIssuesDrawer: () => void;
  onSyncFromQA: () => void;
}

export const TimingQAPassportBanner: React.FC<TimingQAPassportBannerProps> = ({
  qaPassportLoaded,
  timingIssuesCount,
  onOpenIssuesDrawer,
  onSyncFromQA
}) => {
  if (!qaPassportLoaded) return null;

  return (
    <div className="bg-gradient-to-r from-amber-950/80 via-indigo-950/70 to-neutral-900 border-b border-amber-500/40 px-4 py-1.5 flex items-center justify-between text-xs text-amber-200 shrink-0 shadow-lg">
      <div className="flex items-center gap-2.5">
        <div className="w-5 h-5 rounded bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 shrink-0">
          <CheckCircle2 className="w-3.5 h-3.5" />
        </div>
        <div>
          <span className="font-bold text-white">Паспорт QA подхвачен:</span>{' '}
          <span className="font-mono tabular-nums">
            Замечаний: <strong className="text-white">{qaPassportLoaded.summary.totalGaps}</strong>{' '}
            (Наездов: <strong>{qaPassportLoaded.summary.overlapsCount}</strong>, Коллизий: <strong>{qaPassportLoaded.summary.collisionsCount}</strong>, Рассинхронов: <strong>{qaPassportLoaded.summary.desyncCount}</strong>, Пропусков: <strong>{qaPassportLoaded.summary.missingCount}</strong>)
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onOpenIssuesDrawer}
          className="h-7 px-2.5 bg-amber-600/30 hover:bg-amber-600/50 text-amber-200 border border-amber-500/40 rounded-lg text-[11px] font-bold transition inline-flex items-center gap-1 shadow-sm"
        >
          <AlertTriangle className="w-3 h-3 text-amber-400" />
          <span>Замечания ({timingIssuesCount})</span>
        </button>
        <button
          onClick={onSyncFromQA}
          className="h-7 px-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-[11px] font-medium transition inline-flex items-center gap-1"
          title="Повторно синхронизировать данные с QA проверкой"
        >
          <RefreshCw className="w-3 h-3 text-neutral-400" />
          <span>Обновить</span>
        </button>
      </div>
    </div>
  );
};

export interface TimingIssuesDrawerProps {
  isOpen: boolean;
  timingIssues: TimingIssue[];
  activeIssueFilter: IssueFilterType;
  missingSubtitles: MissingSubtitleMarker[];
  onChangeFilter: (filter: IssueFilterType) => void;
  onApplyTargetedAutoTiming: (filter: 'all' | 'overlap' | 'desync' | 'orphan') => void;
  onClose: () => void;
  onJumpToTime: (timeSec: number) => void;
  onFixSingleClip: (trackId: string, clipId: string) => void;
  onResolveSingleOverlap: (trackId: string, clipId?: string, timeSec?: number, overlappingClipId?: string) => void;
  onTriggerUploadMissing: (marker: MissingSubtitleMarker) => void;
  onCopyMissingTimecode: (subText: string, subStartSec: number, subEndSec: number) => void;
}

export const TimingIssuesDrawer: React.FC<TimingIssuesDrawerProps> = ({
  isOpen,
  timingIssues,
  activeIssueFilter,
  missingSubtitles,
  onChangeFilter,
  onApplyTargetedAutoTiming,
  onClose,
  onJumpToTime,
  onFixSingleClip,
  onResolveSingleOverlap,
  onTriggerUploadMissing,
  onCopyMissingTimecode
}) => {
  if (!isOpen || timingIssues.length === 0) return null;

  return (
    <div className="bg-[#0b0e18] border-b border-indigo-900/60 px-4 py-2.5 shrink-0 shadow-2xl flex flex-col gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="font-bold text-xs text-neutral-100 flex items-center gap-1.5">
            <Search className="w-4 h-4 text-amber-400" />
            Диагностика таймингов: найдено проблем ({timingIssues.length})
          </span>

          <div className="flex items-center gap-1 bg-neutral-900/90 p-0.5 rounded-lg border border-neutral-800 text-[10px]">
            <button
              onClick={() => onChangeFilter('all')}
              className={`px-2 py-0.5 rounded ${activeIssueFilter === 'all' ? 'bg-indigo-600 text-white font-bold' : 'text-neutral-400 hover:text-neutral-200'}`}
            >
              Все ({timingIssues.length})
            </button>
            <button
              onClick={() => onChangeFilter('overlap')}
              className={`px-2 py-0.5 rounded ${activeIssueFilter === 'overlap' ? 'bg-red-600 text-white font-bold' : 'text-neutral-400 hover:text-neutral-200'}`}
            >
              💥 Наезды ({timingIssues.filter(i => i.type === 'overlap').length})
            </button>
            <button
              onClick={() => onChangeFilter('desync')}
              className={`px-2 py-0.5 rounded ${activeIssueFilter === 'desync' ? 'bg-amber-600 text-white font-bold' : 'text-neutral-400 hover:text-neutral-200'}`}
            >
              ⏳ Рассинхрон ({timingIssues.filter(i => i.type === 'desync').length})
            </button>
            <button
              onClick={() => onChangeFilter('missing')}
              className={`px-2 py-0.5 rounded ${activeIssueFilter === 'missing' ? 'bg-amber-700 text-white font-bold' : 'text-neutral-400 hover:text-neutral-200'}`}
            >
              ⚠️ Пропуски ({timingIssues.filter(i => i.type === 'missing').length})
            </button>
            <button
              onClick={() => onChangeFilter('orphan')}
              className={`px-2 py-0.5 rounded ${activeIssueFilter === 'orphan' ? 'bg-cyan-700 text-white font-bold' : 'text-neutral-400 hover:text-neutral-200'}`}
            >
              🎙️ Вне сабов ({timingIssues.filter(i => i.type === 'orphan').length})
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onApplyTargetedAutoTiming('all')}
            disabled={timingIssues.filter(i => i.type !== 'missing').length === 0}
            className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-[11px] font-bold rounded-lg flex items-center gap-1 shadow transition"
            title="Точечно раздвинуть все наезды и выровнять все рассинхроны под субтитры"
          >
            <Zap className="w-3 h-3" />
            <span>Исправить все точечно</span>
          </button>
          <button
            onClick={() => onApplyTargetedAutoTiming('overlap')}
            disabled={timingIssues.filter(i => i.type === 'overlap').length === 0}
            className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] font-semibold rounded-lg flex items-center gap-1 border border-neutral-700 transition"
          >
            <MoveHorizontal className="w-3 h-3 text-red-400" />
            <span>Только наезды</span>
          </button>
          <button
            onClick={() => onApplyTargetedAutoTiming('desync')}
            disabled={timingIssues.filter(i => i.type === 'desync').length === 0}
            className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] font-semibold rounded-lg flex items-center gap-1 border border-neutral-700 transition"
          >
            <Crosshair className="w-3 h-3 text-amber-400" />
            <span>Только рассинхрон</span>
          </button>
          <button
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-neutral-200 rounded"
            title="Скрыть панель"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto py-1 max-h-36 scrollbar-thin">
        {timingIssues
          .filter(i => activeIssueFilter === 'all' || i.type === activeIssueFilter)
          .map(issue => (
            <div
              key={issue.id}
              onClick={() => onJumpToTime(issue.timeSec)}
              className={`shrink-0 w-80 p-2 rounded-xl border text-xs flex flex-col justify-between cursor-pointer transition select-none ${
                issue.type === 'overlap'
                  ? 'bg-red-950/40 border-red-800/60 hover:border-red-500'
                  : issue.type === 'desync'
                  ? 'bg-amber-950/40 border-amber-800/60 hover:border-amber-500'
                  : issue.type === 'missing'
                  ? 'bg-neutral-900 border-amber-600/60 hover:border-amber-400'
                  : 'bg-cyan-950/40 border-cyan-800/60 hover:border-cyan-500'
              }`}
            >
              <div className="flex items-center justify-between text-[10px] mb-1">
                <span className="font-bold flex items-center gap-1 truncate">
                  {issue.type === 'overlap' && <span className="bg-red-600 text-white px-1 py-0.2 rounded font-black text-[8px]">НАЕЗД</span>}
                  {issue.type === 'desync' && <span className="bg-amber-600 text-neutral-950 px-1 py-0.2 rounded font-black text-[8px]">РАССИНХРОН</span>}
                  {issue.type === 'missing' && <span className="bg-amber-500 text-neutral-950 px-1 py-0.2 rounded font-black text-[8px]">ПРОПУСК</span>}
                  {issue.type === 'orphan' && <span className="bg-cyan-600 text-white px-1 py-0.2 rounded font-black text-[8px]">ВНЕ САБОВ</span>}
                  <span className="text-neutral-200 truncate">{issue.dubberName} ({issue.characterName})</span>
                </span>
                <span className="font-mono tabular-nums text-neutral-400 shrink-0">
                  ⏱ {formatSeconds(issue.timeSec)}
                </span>
              </div>

              <p className="text-[11px] text-neutral-300 line-clamp-2 leading-tight mb-1.5" title={issue.description}>
                {issue.description}
              </p>

              <div className="flex items-center justify-between pt-1 border-t border-neutral-800/60">
                <button
                  onClick={(e) => { e.stopPropagation(); onJumpToTime(issue.timeSec); }}
                  className="text-[10px] text-indigo-400 hover:text-indigo-200 flex items-center gap-0.5"
                >
                  <Crosshair className="w-2.5 h-2.5" />
                  <span>Показать</span>
                </button>

                {issue.type === 'desync' && issue.clipId && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onFixSingleClip(issue.trackId, issue.clipId!); }}
                    className="px-2 py-0.5 bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold rounded flex items-center gap-1 shadow"
                    title="Поставить фразу точно под субтитр"
                  >
                    <Crosshair className="w-2.5 h-2.5" />
                    <span>К субтитру</span>
                  </button>
                )}

                {issue.type === 'orphan' && issue.clipId && issue.subStartSec !== undefined && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onFixSingleClip(issue.trackId, issue.clipId!); }}
                    className="px-2 py-0.5 bg-cyan-600 hover:bg-cyan-500 text-white text-[10px] font-bold rounded flex items-center gap-1 shadow"
                    title="Поставить фразу к найденному Whisper субтитру"
                  >
                    <Crosshair className="w-2.5 h-2.5" />
                    <span>К субтитру</span>
                  </button>
                )}

                {issue.type === 'overlap' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onResolveSingleOverlap(issue.trackId, issue.clipId, issue.timeSec, issue.overlappingClipId);
                    }}
                    className="px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white text-[10px] font-bold rounded flex items-center gap-1 shadow"
                    title="Точечно раздвинуть пересекающиеся фразы"
                  >
                    <MoveHorizontal className="w-2.5 h-2.5" />
                    <span>Раздвинуть</span>
                  </button>
                )}

                {issue.type === 'missing' && (
                  <div className="flex items-center gap-1">
                    {missingSubtitles.find(m => m.trackId === issue.trackId && Math.abs(m.startSec - issue.timeSec) < 0.2) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const marker = missingSubtitles.find(m => m.trackId === issue.trackId && Math.abs(m.startSec - issue.timeSec) < 0.2);
                          if (marker) onTriggerUploadMissing(marker);
                        }}
                        className="px-2 py-0.5 bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold rounded flex items-center gap-1 shadow transition"
                        title="Загрузить аудиофайл реплики"
                      >
                        <Download className="w-2.5 h-2.5" />
                        <span>Загрузить</span>
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); onCopyMissingTimecode(issue.subText || '', issue.subStartSec || 0, issue.subEndSec || 0); }}
                      className="px-2 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-amber-300 text-[10px] font-semibold rounded flex items-center gap-1 border border-neutral-700"
                      title="Скопировать таймкод фразы"
                    >
                      <Copy className="w-2.5 h-2.5" />
                      <span>Таймкод</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
};

export interface TimingFinalReportBannerProps {
  report: FinalVerificationReport | null;
  onJumpToTime: (timeSec: number) => void;
  onDismiss: () => void;
}

export const TimingFinalReportBanner: React.FC<TimingFinalReportBannerProps> = ({
  report,
  onJumpToTime,
  onDismiss
}) => {
  if (!report) return null;

  return (
    <div
      className={`border-b px-4 py-1.5 flex items-center justify-between gap-3 text-xs shrink-0 ${
        report.passed
          ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200'
          : 'bg-amber-950/40 border-amber-800/60 text-amber-200'
      }`}
    >
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className="font-bold flex items-center gap-1.5">
          {report.passed ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          )}
          <span>
            {report.passed
              ? `Финальная проверка пройдена (${report.iterationsRun} итер.): все ${report.voicedSubs}/${report.totalSubs} сабов озвучены и на местах!`
              : `Финальный аудит (${report.iterationsRun} итер.): озвучено ${report.voicedSubs}/${report.totalSubs} сабов`}
          </span>
        </span>

        {(report.recoveredFromFixCount > 0 || report.recoveredFromOrigCount > 0) && (
          <span className="px-2 py-0.5 rounded bg-emerald-900/60 border border-emerald-700/60 text-[10px] font-mono text-emerald-200">
            🚑 Восстановлено: {report.recoveredFromFixCount} из фикса / {report.recoveredFromOrigCount} из оригинала
          </span>
        )}

        {Boolean(report.voicedByOtherDubberCount && report.voicedByOtherDubberCount > 0) && (
          <span className="px-2 py-0.5 rounded bg-sky-900/60 border border-sky-700/60 text-[10px] font-mono text-sky-200">
            🤝 Озвучено другими дабберами: {report.voicedByOtherDubberCount}
          </span>
        )}

        {report.realignedCount > 0 && (
          <span className="px-2 py-0.5 rounded bg-indigo-900/60 border border-indigo-700/60 text-[10px] font-mono text-indigo-200">
            🎯 Довыровнено: {report.realignedCount}
          </span>
        )}

        {report.physicsProtectedCount > 0 && (
          <span className="px-2 py-0.5 rounded bg-fuchsia-950/70 border border-fuchsia-700/60 text-[10px] font-mono text-fuchsia-200">
            ⚡ Защищено физики (охи/вздохи): {report.physicsProtectedCount}
          </span>
        )}

        {!report.passed && report.unvoicedSubs.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto max-w-[460px] py-0.5">
            <span className="text-[10px] text-amber-300 font-semibold shrink-0">Не найдены в исходниках:</span>
            {report.unvoicedSubs.slice(0, 5).map(u => (
              <button
                key={u.id}
                onClick={() => onJumpToTime(u.startSec)}
                className="px-1.5 py-0.5 rounded bg-amber-900/70 hover:bg-amber-800 text-amber-100 border border-amber-700/60 text-[10px] font-mono shrink-0 transition"
                title={`${u.dubberName} (${u.characterName}): «${u.text}»`}
              >
                {u.dubberName} [{formatSeconds(u.startSec)}]
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={onDismiss}
        className="text-neutral-400 hover:text-white p-0.5 rounded transition shrink-0"
        title="Скрыть отчёт финальной проверки"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export interface TimingCalibrationBannerProps {
  calibrationsByTrack: Record<string, NoiseCalibration>;
  tracks: Track[];
}

export const TimingCalibrationBanner: React.FC<TimingCalibrationBannerProps> = ({
  calibrationsByTrack,
  tracks
}) => {
  if (Object.keys(calibrationsByTrack).length === 0) return null;

  return (
    <div className="bg-amber-950/30 border-b border-amber-900/40 px-4 py-1 flex items-center justify-between text-[11px] text-amber-200 shrink-0">
      <div className="flex items-center gap-2 overflow-x-auto py-0.5">
        <span className="font-bold text-amber-400 flex items-center gap-1 shrink-0">
          <Sliders className="w-3.5 h-3.5" /> Авто-калибровка шума:
        </span>
        {Object.entries(calibrationsByTrack).map(([trId, calib]) => {
          const trk = tracks.find(t => t.id === trId);
          const name = trk?.participant || 'Трек';
          return (
            <span key={trId} className="bg-neutral-900/90 border border-amber-800/40 rounded px-2 py-0.5 font-mono tabular-nums text-[10px] text-neutral-300 shrink-0">
              <strong className="text-amber-300">{name}</strong>: шум {calib.noiseFloorDb} dB | речь {calib.speechFloorDb} dB | порог {calib.calculatedThresholdDb} dB
            </span>
          );
        })}
      </div>
      <span className="text-[10px] text-neutral-400 shrink-0 ml-3 hidden md:inline">
        Границы клипов можно вытягивать из тишины мышкой за края — изменения слышны сразу
      </span>
    </div>
  );
};

export interface TimingTrackNavigationBarProps {
  tracks: Track[];
  audioClips: Record<string, AudioClip[]>;
  mutedTracks: Set<string>;
  normalizationMetrics: Record<string, NormalizationMetrics>;
  isAutoNormalize: boolean;
  originalWaveScale: number;
  isOriginalWaveNormalized: boolean;
  trackHeightMode: TrackHeightMode;
  onChangeOriginalWaveScale: (scale: number) => void;
  onToggleOriginalWaveNorm: () => void;
  onChangeTrackHeightMode: (mode: TrackHeightMode) => void;
}

export const TimingTrackNavigationBar: React.FC<TimingTrackNavigationBarProps> = ({
  tracks,
  audioClips,
  mutedTracks,
  normalizationMetrics,
  isAutoNormalize,
  originalWaveScale,
  isOriginalWaveNormalized,
  trackHeightMode,
  onChangeOriginalWaveScale,
  onToggleOriginalWaveNorm,
  onChangeTrackHeightMode
}) => {
  return (
    <div className="bg-[#0b0d14] border-b border-neutral-800 px-4 py-1.5 flex items-center justify-between gap-3 text-xs shrink-0 select-none">
      <div className="flex items-center gap-2 overflow-x-auto py-0.5 scrollbar-thin max-w-[70%]">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-neutral-900 border border-neutral-800 text-neutral-300 font-semibold shrink-0">
          <Layers className="w-3.5 h-3.5 text-indigo-400" />
          <span>Дорожки: <strong className="text-white font-mono tabular-nums">{tracks.length}</strong></span>
        </div>

        {tracks.map((t) => {
          const clipsCount = (audioClips[t.id] || []).length;
          const isMuted = mutedTracks.has(t.id);
          const norm = normalizationMetrics[t.id];
          return (
            <button
              key={t.id}
              onClick={() => {
                const el = document.getElementById(`track-row-${t.id}`);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
              className={`px-2.5 py-1 rounded-lg border text-[11px] flex items-center gap-1.5 shrink-0 transition ${
                isMuted
                  ? 'bg-red-950/40 border-red-900/60 text-red-300 hover:bg-red-900/50'
                  : 'bg-neutral-900/90 hover:bg-neutral-800 border-neutral-800 hover:border-neutral-700 text-neutral-200'
              }`}
              title={`Перейти к дорожке: ${t.participant} (${clipsCount} фраз). Нажмите для прокрутки.`}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${isMuted ? 'bg-red-500' : 'bg-emerald-500'}`} />
              <span className="font-bold truncate max-w-[130px]">{t.participant}</span>
              <span className="text-[10px] text-neutral-400 font-mono tabular-nums">({clipsCount})</span>
              {isAutoNormalize && norm && norm.gainDb !== 0 && (
                <span className="text-[9px] font-mono tabular-nums text-emerald-400 bg-emerald-950/70 px-1 rounded">
                  {norm.gainDb > 0 ? `+${norm.gainDb.toFixed(1)}` : norm.gainDb.toFixed(1)}dB
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div className="flex items-center gap-1 bg-neutral-900 border border-sky-900/50 rounded-lg px-2 py-0.5">
          <span className="text-[10px] text-sky-400 font-semibold mr-0.5" title="Масштабирование высоты волны оригинальной дорожки">
            Волна ориг.:
          </span>
          <button
            onClick={() => onChangeOriginalWaveScale(originalWaveScale - 0.3)}
            className="w-5 h-5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white flex items-center justify-center text-xs font-bold transition"
            title="Уменьшить высоту вейвформы оригинала"
          >
            −
          </button>
          <input
            type="range"
            min="0.5"
            max="8"
            step="0.25"
            value={originalWaveScale}
            onChange={(e) => onChangeOriginalWaveScale(Number(e.target.value))}
            className="w-16 accent-amber-400 h-1 bg-neutral-800 rounded cursor-pointer"
            title={`Масштаб амплитуды оригинала: ${originalWaveScale}x`}
          />
          <button
            onClick={() => onChangeOriginalWaveScale(originalWaveScale + 0.3)}
            className="w-5 h-5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white flex items-center justify-center text-xs font-bold transition"
            title="Увеличить высоту вейвформы оригинала"
          >
            +
          </button>
          <button
            onClick={() => onChangeOriginalWaveScale(1.8)}
            className="px-1.5 py-0.5 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 font-mono tabular-nums text-[10px] font-bold transition"
            title="Нажмите для сброса масштаба волны к 1.8x"
          >
            {originalWaveScale.toFixed(1)}x
          </button>
          <button
            onClick={onToggleOriginalWaveNorm}
            className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition border ${
              isOriginalWaveNormalized
                ? 'bg-sky-600 text-white border-sky-500 shadow-sm'
                : 'bg-neutral-800 text-neutral-400 border-neutral-700 hover:text-neutral-200'
            }`}
            title="Авто-нормализация и выделение фраз на вейвформе оригинала (делает тихие реплики оригинала чётко видимыми)"
          >
            АВТО
          </button>
        </div>

        <div className="flex items-center gap-1 bg-neutral-900 border border-neutral-800 rounded-lg p-0.5">
          <button
            onClick={() => onChangeTrackHeightMode('standard')}
            className={`px-2 py-1 rounded text-[11px] font-medium transition ${
              trackHeightMode === 'standard' ? 'bg-indigo-600 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
            }`}
            title="Стандартная высота: 112px для детального редактирования вейвформы"
          >
            Стандартный (112px)
          </button>
          <button
            onClick={() => onChangeTrackHeightMode('compact')}
            className={`px-2 py-1 rounded text-[11px] font-medium transition ${
              trackHeightMode === 'compact' ? 'bg-indigo-600 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
            }`}
            title="Компактный вид: 64px — все дорожки помещаются на экране"
          >
            Компактный (64px)
          </button>
          <button
            onClick={() => onChangeTrackHeightMode('fit')}
            className={`px-2 py-1 rounded text-[11px] font-medium transition ${
              trackHeightMode === 'fit' ? 'bg-indigo-600 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
            }`}
            title="Уместить все дорожки на одном экране без скролла"
          >
            Уместить все ({tracks.length})
          </button>
        </div>
      </div>
    </div>
  );
};

export interface TimingOperationLogsDrawerProps {
  isOpen: boolean;
  logs: OperationLogEntry[];
  onClear: () => void;
}

export const TimingOperationLogsDrawer: React.FC<TimingOperationLogsDrawerProps> = ({
  isOpen,
  logs,
  onClear
}) => {
  if (!isOpen) return null;

  return (
    <div className="bg-neutral-900 border-t border-neutral-800 h-44 flex flex-col shrink-0">
      <div className="p-2 px-4 bg-neutral-950 border-b border-neutral-800 flex items-center justify-between text-xs font-bold text-neutral-300">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-amber-400" />
          <span>Журнал операций тайминга ({logs.length})</span>
        </div>
        <button
          onClick={onClear}
          className="text-[10px] text-neutral-400 hover:text-white"
        >
          Очистить
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 px-4 space-y-1 font-mono text-[11px]">
        {logs.map((log, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <span className="text-neutral-500">[{log.time}]</span>
            <span className={
              log.level === 'error' ? 'text-red-400' :
              log.level === 'warn' ? 'text-amber-400' :
              log.level === 'success' ? 'text-emerald-400' :
              'text-neutral-300'
            }>
              {log.msg}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
