import React from 'react';
import { 
  FolderOutput, 
  Loader2, 
  Check, 
  X, 
  Folder, 
  FileAudio, 
  Film, 
  FileText 
} from 'lucide-react';
import { MixingExportSeModalProps } from './mixing.types';

export const MixingExportSeModal: React.FC<MixingExportSeModalProps> = ({
  isOpen,
  onClose,
  currentEpisode,
  manifest,
  workingDir,
  exportSeTargetDir,
  setExportSeTargetDir,
  exportSeSourceStepId,
  setExportSeSourceStepId,
  exportSeSkipConversion,
  setExportSeSkipConversion,
  exportSeIncludeSubtitles,
  setExportSeIncludeSubtitles,
  exportSeAdditionalProcessing,
  setExportSeAdditionalProcessing,
  isExportingSe,
  exportSeProgress,
  exportSeStatusMsg,
  inspectedSeTracks,
  selectedSeTrackPaths,
  setSelectedSeTrackPaths,
  isInspectingSeTracks,
  onStartExport,
  mixLog
}) => {
  if (!isOpen) return null;

  const handleSelectAll = () => {
    const all = new Set<string>();
    inspectedSeTracks.forEach((t: any) => {
      if (t.path) all.add(t.path);
    });
    setSelectedSeTrackPaths(all);
  };

  const handleDeselectAll = () => {
    setSelectedSeTrackPaths(new Set());
  };

  const handleToggleTrack = (path: string) => {
    const next = new Set(selectedSeTrackPaths);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    setSelectedSeTrackPaths(next);
  };

  const formatDuration = (sec?: number) => {
    if (!sec || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const formatSize = (bytes?: number) => {
    if (!bytes || isNaN(bytes)) return '0 МБ';
    return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  };

  const processedSteps = (manifest?.pipeline || []).filter(
    (s) => s.status === 'completed' && Array.isArray(s.outputFiles) && s.outputFiles.length > 0
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-950">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-600/20 text-indigo-400 rounded-lg">
              <FolderOutput className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Экспорт звукорежиссеру (WAV → FLAC + Видео)</h3>
              <p className="text-[11px] text-neutral-400">
                Выгрузка дорожек сжатыми без потерь FLAC (48 кГц) + видео со вшитыми субтитрами
              </p>
            </div>
          </div>
          <button
            onClick={() => !isExportingSe && onClose()}
            disabled={isExportingSe}
            className="text-neutral-500 hover:text-neutral-300 text-sm px-2 py-1 disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          <div className="bg-indigo-950/30 border border-indigo-500/30 rounded-xl p-3.5 text-xs text-indigo-200 leading-relaxed">
            Этот экспорт берет аудиодорожки из <strong>выбранного или последнего обработанного модуля</strong> конвейера сведения, автоматически конвертирует их из рабочего формата <strong>WAV в сжатый без потерь FLAC (48 кГц)</strong> и сохраняет в отдельную папку вместе со сформированным видеорядом и файлом субтитров.
          </div>

          {/* 1. Source module selector */}
          <div>
            <label className="text-xs text-neutral-300 font-semibold block mb-1.5">
              1. Источник аудиодорожек для конвертации в FLAC:
            </label>
            <select
              value={exportSeSourceStepId}
              onChange={(e) => setExportSeSourceStepId(e.target.value)}
              disabled={isExportingSe}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="latest">
                Автоматически: последний обработанный модуль конвейера ({processedSteps.length > 0 ? processedSteps[processedSteps.length - 1].moduleId : 'исходники'})
              </option>
              {processedSteps.map((step) => (
                <option key={step.stepId} value={step.stepId}>
                  Модуль [{step.prefix}]: {step.moduleId} ({step.outputFiles?.length || 0} обработанных дорожек)
                </option>
              ))}
              <option value="source">
                Исходные дорожки дабберов (00_raw_dubbers — без обработки)
              </option>
            </select>

            {/* Checklist of tracks */}
            <div className="mt-2 bg-neutral-950/80 border border-neutral-800/80 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium text-neutral-400">
                  Доступные дорожки для конвертации:
                </span>
                <div className="flex items-center gap-2">
                  {inspectedSeTracks.length > 0 && (
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <button
                        type="button"
                        onClick={handleSelectAll}
                        disabled={isExportingSe}
                        className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
                      >
                        Выбрать все
                      </button>
                      <span className="text-neutral-700">|</span>
                      <button
                        type="button"
                        onClick={handleDeselectAll}
                        disabled={isExportingSe}
                        className="text-neutral-400 hover:text-neutral-300 transition-colors"
                      >
                        Снять выбор
                      </button>
                    </div>
                  )}
                  <span className="text-[11px] text-emerald-400 font-mono">
                    Выбрано: {selectedSeTrackPaths.size} из {inspectedSeTracks.length} шт.
                  </span>
                </div>
              </div>

              {isInspectingSeTracks ? (
                <div className="py-4 text-center text-xs text-neutral-400 flex items-center justify-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                  <span>Проверка дорожек, длительности и битрейта...</span>
                </div>
              ) : inspectedSeTracks.length > 0 ? (
                <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                  {inspectedSeTracks.map((tr: any, idx: number) => {
                    const checked = selectedSeTrackPaths.has(tr.path);
                    const isFix = tr.kind === 'fix' || (tr.roleLabel && String(tr.roleLabel).toLowerCase().includes('фикс'));
                    const roleBadge = tr.roleLabel || (isFix ? 'Фикс' : `Дорожка ${idx + 1}`);
                    const dubberName = tr.dubberNick || tr.actor || 'Даббер';
                    const targetFlacName = tr.exportFlacName || tr.name;

                    return (
                      <label
                        key={`${tr.path}_${idx}`}
                        className={`flex items-center gap-2.5 p-2 rounded-lg border transition-colors ${
                          checked
                            ? 'bg-indigo-950/30 border-indigo-500/40 hover:border-indigo-500/60 cursor-pointer'
                            : 'bg-neutral-900/70 border-neutral-800/60 hover:border-neutral-700 cursor-pointer'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={isExportingSe}
                          onChange={() => handleToggleTrack(tr.path)}
                          className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-indigo-500 focus:ring-indigo-500/20 shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-bold text-white truncate">{dubberName}</span>
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide ${
                                isFix
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                  : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                              }`}
                            >
                              {roleBadge}
                            </span>
                            <span className="text-[10px] text-indigo-400 font-mono ml-auto shrink-0">WAV → FLAC</span>
                          </div>
                          <div className="text-[11px] text-neutral-300 font-mono truncate mt-0.5" title={targetFlacName}>
                            {targetFlacName}
                          </div>
                        </div>
                        <div className="flex flex-col items-end shrink-0 text-[11px] font-mono text-neutral-300">
                          <span className="text-emerald-400 font-semibold">⏱ {formatDuration(tr.durationSec)}</span>
                          <span className="text-neutral-400 text-[10px]">💾 {formatSize(tr.sizeBytes)}</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="text-[11px] text-amber-400 py-2">
                  Дорожки не обнаружены. Выполните импорт материалов или запуск хотя бы одного модуля конвейера.
                </div>
              )}
            </div>
          </div>

          {/* 2. Target folder selector */}
          <div>
            <label className="text-xs text-neutral-300 font-semibold block mb-1.5">
              2. Папка назначения для экспорта звукорежиссеру:
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={exportSeTargetDir}
                onChange={(e) => setExportSeTargetDir(e.target.value)}
                disabled={isExportingSe}
                placeholder="По умолчанию: <Название серии> для звукорежиссёра"
                className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>
            <p className="text-[10px] text-neutral-500 mt-1">
              Туда будут сохранены сконвертированные дорожки <code>.flac</code>, хардсаб видео и размеченные субтитры.
            </p>
          </div>

          {/* 3. Video & Subtitles options */}
          <div className="space-y-2 pt-1">
            <label className="flex items-center gap-3 p-2.5 bg-neutral-950/60 border border-neutral-800/80 rounded-xl cursor-pointer hover:border-neutral-700">
              <input
                type="checkbox"
                checked={exportSeIncludeSubtitles}
                onChange={(e) => setExportSeIncludeSubtitles(e.target.checked)}
                disabled={isExportingSe}
                className="rounded border-neutral-700 text-indigo-600 focus:ring-indigo-500"
              />
              <div>
                <div className="text-xs font-medium text-neutral-200">
                  Сложить туда же общие субтитры с разметкой ролей дабберов
                </div>
                <div className="text-[11px] text-neutral-500">
                  Формирует файл <code>_[субтитры_общие].ass/.srt</code> со всеми репликами и актерами
                </div>
              </div>
            </label>

            <label className="flex items-center gap-3 p-2.5 bg-neutral-950/60 border border-neutral-800/80 rounded-xl cursor-pointer hover:border-neutral-700">
              <input
                type="checkbox"
                checked={!exportSeSkipConversion}
                onChange={(e) => setExportSeSkipConversion(!e.target.checked)}
                disabled={isExportingSe}
                className="rounded border-neutral-700 text-indigo-600 focus:ring-indigo-500"
              />
              <div>
                <div className="text-xs font-medium text-neutral-200">
                  Вшить общие субтитры в видео (хардсаб MP4 для звукорежиссера)
                </div>
                <div className="text-[11px] text-neutral-500">
                  Если отключено — видео будет скопировано в папку без перекодирования как оригинал
                </div>
              </div>
            </label>

            {!exportSeSkipConversion && (
              <label className="flex items-center gap-3 p-2.5 bg-neutral-950/60 border border-neutral-800/80 rounded-xl cursor-pointer hover:border-neutral-700">
                <input
                  type="checkbox"
                  checked={exportSeAdditionalProcessing}
                  onChange={(e) => setExportSeAdditionalProcessing(e.target.checked)}
                  disabled={isExportingSe}
                  className="rounded border-neutral-700 text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <div className="text-xs font-medium text-neutral-200">
                    Ускоренный профиль кодирования видео (720p для быстрой выгрузки)
                  </div>
                  <div className="text-[11px] text-neutral-500">
                    Ускоряет рендер видео со вшитыми субтитрами для быстрой работы в DAW
                  </div>
                </div>
              </label>
            )}
          </div>

          {/* Progress indicator during export */}
          {isExportingSe && (
            <div className="bg-neutral-950 border border-indigo-500/40 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-indigo-300 flex items-center gap-2 font-medium">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                  <span>{exportSeStatusMsg || 'Экспорт файлов звукорежиссеру...'}</span>
                </span>
                <span className="text-indigo-400 font-mono font-bold">{Math.round(exportSeProgress)}%</span>
              </div>
              <div className="w-full h-2 bg-neutral-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 transition-all duration-300"
                  style={{ width: `${Math.max(3, Math.min(100, exportSeProgress))}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-neutral-800 bg-neutral-950 flex justify-end gap-2.5">
          <button
            onClick={onClose}
            disabled={isExportingSe}
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-neutral-300 rounded-xl text-xs font-medium transition"
          >
            Отмена
          </button>
          <button
            onClick={onStartExport}
            disabled={isExportingSe || inspectedSeTracks.length === 0 || selectedSeTrackPaths.size === 0}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition shadow-lg shadow-indigo-900/20"
          >
            {isExportingSe ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Выгрузка в FLAC ({Math.round(exportSeProgress)}%)...</span>
              </>
            ) : (
              <>
                <FolderOutput className="w-4 h-4" />
                <span>Выгрузить в FLAC звукорежиссеру</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
