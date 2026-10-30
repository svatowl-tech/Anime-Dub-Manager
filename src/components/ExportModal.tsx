import React, { useState, useEffect } from 'react';
import { X, FolderOpen, FileAudio, Clock, HardDrive, CheckSquare, Square, Loader2 } from 'lucide-react';
import { Episode } from '../types';
import { ipcSafe, isWeb } from '../lib/ipcSafe';
import { DesktopRequiredMessage } from './DesktopRequiredMessage';
import { sanitizeFolderName } from '../lib/pathUtils';

export interface SoundEngineerCatalogTrack {
  id: string;
  uploadId?: string;
  dubberId: string;
  dubberNick: string;
  roleLabel: string;
  trackKind: 'original' | 'fix';
  trackNumber: number;
  totalOriginalForDubber: number;
  totalFixesForDubber: number;
  fileName: string;
  exportFileName: string;
  path: string;
  sizeBytes: number;
  durationSec: number;
  exists: boolean;
  recommendedSelected?: boolean;
}

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  episode: Episode;
  role: 'DABBER' | 'SOUND_ENGINEER';
  onExport: (
    targetDir: string, 
    skipConversion: boolean, 
    smartExport?: boolean, 
    uploadToYandex?: boolean, 
    additionalProcessing?: boolean, 
    autoApplyFixes?: boolean,
    includeSubtitles?: boolean,
    autoTiming?: boolean,
    selectedTrackIds?: string[]
  ) => void;
  isExporting?: boolean;
  progress?: number;
}

const formatDurationLabel = (sec?: number) => {
  if (!sec || !Number.isFinite(sec) || sec <= 0) return '—:—';
  const totalSec = Math.round(sec);
  const mins = Math.floor(totalSec / 60);
  const remSec = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(remSec).padStart(2, '0')}`;
};

const formatSizeMbLabel = (bytes?: number) => {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '0.0 МБ';
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${mb.toFixed(1)} МБ`;
};

export const ExportModal: React.FC<ExportModalProps> = ({ 
  isOpen, 
  onClose, 
  episode, 
  role, 
  onExport,
  isExporting = false,
  progress = 0
}) => {
  const [targetDir, setTargetDir] = useState('');
  const [skipConversion, setSkipConversion] = useState(false);
  const [smartExport, setSmartExport] = useState(false);
  const [additionalProcessing, setAdditionalProcessing] = useState(false);
  const [autoApplyFixes, setAutoApplyFixes] = useState(false);
  const [includeSubtitles, setIncludeSubtitles] = useState(true);
  const [autoTiming, setAutoTiming] = useState(false);
  const [snippetFixInfo, setSnippetFixInfo] = useState<{ hasSnippetFixes: boolean; count: number; loading: boolean }>({
    hasSnippetFixes: false,
    count: 0,
    loading: false
  });
  const [catalogTracks, setCatalogTracks] = useState<SoundEngineerCatalogTrack[]>([]);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  const [isLoadingTracks, setIsLoadingTracks] = useState(false);

  useEffect(() => {
    if (isOpen && episode) {
      setIncludeSubtitles(Boolean(episode.subPath));
    }
  }, [isOpen, episode]);

  // Compute recommended track IDs when smartExport is toggled or catalog loads
  const computeRecommendedSelection = (tracks: SoundEngineerCatalogTrack[], useSmartFilter: boolean): Set<string> => {
    const valid = tracks.filter(t => t.exists !== false);
    if (!useSmartFilter) {
      return new Set(valid.map(t => String(t.id)));
    }
    // Smart filter: only if a dubber has EXACTLY 1 original track AND 1+ fix track where the fix is >= 98% of original size
    // Never drop Track 1 or Track 2 when a dubber has multiple original tracks!
    const nextSelected = new Set<string>();
    const byDubber = new Map<string, SoundEngineerCatalogTrack[]>();
    for (const tr of valid) {
      const k = tr.dubberId || tr.dubberNick;
      if (!byDubber.has(k)) byDubber.set(k, []);
      byDubber.get(k)!.push(tr);
    }
    for (const group of byDubber.values()) {
      const originals = group.filter(t => t.trackKind === 'original');
      const fixes = group.filter(t => t.trackKind === 'fix');
      if (originals.length === 1 && fixes.length > 0) {
        const orig = originals[0];
        const newestFix = fixes[fixes.length - 1];
        if (orig.sizeBytes > 0 && newestFix.sizeBytes >= orig.sizeBytes * 0.98) {
          // Only select fixes
          fixes.forEach(f => nextSelected.add(String(f.id)));
          continue;
        }
      }
      group.forEach(t => nextSelected.add(String(t.id)));
    }
    return nextSelected;
  };

  useEffect(() => {
    if (isOpen && episode && role === 'SOUND_ENGINEER' && !isWeb) {
      setIsLoadingTracks(true);
      ipcSafe.invoke('inspect-sound-engineer-tracks', { episode })
        .then((res: any) => {
          const list: SoundEngineerCatalogTrack[] = Array.isArray(res?.tracks) ? res.tracks : [];
          setCatalogTracks(list);
          setSelectedTrackIds(computeRecommendedSelection(list, false));
          setSmartExport(false);
          setIsLoadingTracks(false);
        })
        .catch(err => {
          console.warn('Failed to inspect sound engineer tracks:', err);
          setCatalogTracks([]);
          setSelectedTrackIds(new Set());
          setIsLoadingTracks(false);
        });

      setSnippetFixInfo(prev => ({ ...prev, loading: true }));
      ipcSafe.invoke('check-snippet-fixes', { episode })
        .then((res: any) => {
          if (res) {
            const hasSnippets = Boolean(res.hasSnippetFixes);
            setSnippetFixInfo({
              hasSnippetFixes: hasSnippets,
              count: res.count || 0,
              loading: false
            });
            setAutoApplyFixes(hasSnippets);
          }
        })
        .catch(err => {
          console.warn('Failed to check snippet fixes:', err);
          setSnippetFixInfo({ hasSnippetFixes: false, count: 0, loading: false });
          setAutoApplyFixes(false);
        });
    } else if (!isOpen) {
      setAutoApplyFixes(false);
      setSnippetFixInfo({ hasSnippetFixes: false, count: 0, loading: false });
      setCatalogTracks([]);
      setSelectedTrackIds(new Set());
    }
  }, [isOpen, episode, role]);

  useEffect(() => {
    if (isOpen && episode) {
      const baseFile = episode.rawPath || episode.subPath;
      if (baseFile) {
        const isWin = baseFile.includes('\\');
        const sep = isWin ? '\\' : '/';
        const lastSlashIndex = Math.max(baseFile.lastIndexOf('/'), baseFile.lastIndexOf('\\'));
        if (lastSlashIndex >= 0) {
          const dir = baseFile.substring(0, lastSlashIndex);
          const dirBasename = dir.split(/[/\\]/).pop() || '';
          const isEpDir = /^(episode|ep|серия|выпуск)[\s_.-]*\d+/i.test(dirBasename) ||
                          /^\d+$/.test(dirBasename) ||
                          dirBasename.includes(String(episode.number || ''));

          const epDir = isEpDir ? dir : `${dir}${sep}Episode_${episode.number || 1}`;
          const epFolderName = isEpDir ? dirBasename : `Episode_${episode.number || 1}`;
          const parentDir = isEpDir ? dir.substring(0, Math.max(dir.lastIndexOf('/'), dir.lastIndexOf('\\'))) : dir;

          const projectTitle = sanitizeFolderName(episode.project?.title || '');
          const epNum = episode.number !== undefined ? `_Ep${episode.number}` : '';
          const prefix = projectTitle ? `${projectTitle}${epNum}_` : (epNum ? `Ep${episode.number}_` : '');

          if (role === 'DABBER') {
            const subDirName = `${prefix}Для_даберов`;
            setTargetDir(`${epDir}${sep}${subDirName}`);
          } else {
            // SOUND_ENGINEER: Default to "<Episode Name> для звукорежиссёра" in the project directory
            const soundEngineerDirName = `${epFolderName} для звукорежиссёра`;
            setTargetDir(`${parentDir}${sep}${soundEngineerDirName}`);
          }
        }
      }

      // Also query backend canonical default directory if needed
      ipcSafe.invoke('export-get-default-dir', { episode, role })
        .then((res: any) => {
          if (res && res.defaultDir) {
            setTargetDir(prev => prev || res.defaultDir);
          }
        })
        .catch(() => {});
    } else if (!isOpen) {
      setTargetDir('');
    }
  }, [isOpen, episode, role]);

  if (!isOpen) return null;

  const handleSelectFolder = async () => {
    try {
      const res = await ipcSafe.invoke('select-folder', { defaultPath: targetDir });
      if (res && res.path) {
        setTargetDir(res.path);
      }
    } catch (e: any) {
      if (e && e.message !== 'Selection canceled') console.error(e);
    }
  };

  const handleToggleTrack = (trackId: string) => {
    setSelectedTrackIds(prev => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  };

  const handleSelectAllTracks = () => {
    setSelectedTrackIds(new Set(catalogTracks.filter(t => t.exists !== false).map(t => String(t.id))));
  };

  const handleDeselectAllTracks = () => {
    setSelectedTrackIds(new Set());
  };

  const handleToggleSmartExport = (checked: boolean) => {
    setSmartExport(checked);
    setSelectedTrackIds(computeRecommendedSelection(catalogTracks, checked));
  };

  const totalSelectedSizeBytes = catalogTracks
    .filter(t => selectedTrackIds.has(String(t.id)))
    .reduce((sum, t) => sum + (t.sizeBytes || 0), 0);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className={`bg-neutral-900 border border-neutral-800 p-6 rounded-2xl w-full ${role === 'SOUND_ENGINEER' ? 'max-w-2xl' : 'max-w-md'} max-h-[92vh] flex flex-col shadow-2xl animate-in fade-in zoom-in duration-200`}>
        <div className="flex justify-between items-center mb-4 shrink-0">
          <h2 className="text-xl font-bold text-white">
            Экспорт {role === 'DABBER' ? 'Даберам' : 'Звукорежиссеру'}
          </h2>
          <button 
            onClick={onClose}
            disabled={isExporting}
            title="Закрыть окно экспорта"
            className="p-2 hover:bg-neutral-800 rounded-lg text-neutral-400 hover:text-white transition-colors disabled:opacity-30"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="overflow-y-auto pr-1 space-y-5 flex-1">
          {isWeb ? (
            <div className="mb-4">
              <DesktopRequiredMessage title="Экспорт видео недоступен" />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-neutral-400 mb-2">Папка экспорта</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={targetDir}
                    readOnly
                    className="flex-grow bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                    placeholder="Выберите папку..."
                  />
                  <button 
                    onClick={handleSelectFolder} 
                    disabled={isExporting}
                    className="p-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg border border-neutral-700 transition-colors disabled:opacity-30"
                    title="Выбрать папку"
                  >
                    <FolderOpen className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {role === 'SOUND_ENGINEER' && (
                <div className="bg-neutral-950/90 border border-neutral-800 rounded-xl p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                    <div className="flex items-center gap-2">
                      <FileAudio className="w-4 h-4 text-indigo-400" />
                      <span className="text-xs font-bold text-white">
                        Дорожки дабберов для экспорта
                      </span>
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                        Выбрано: {selectedTrackIds.size} из {catalogTracks.length}
                      </span>
                      {totalSelectedSizeBytes > 0 && (
                        <span className="text-[11px] font-mono text-neutral-400">
                          ({formatSizeMbLabel(totalSelectedSizeBytes)})
                        </span>
                      )}
                    </div>

                    {catalogTracks.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={handleSelectAllTracks}
                          disabled={isExporting}
                          className="px-2 py-1 text-[11px] font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-md border border-neutral-700 transition disabled:opacity-40"
                        >
                          Выбрать все
                        </button>
                        <button
                          type="button"
                          onClick={handleDeselectAllTracks}
                          disabled={isExporting}
                          className="px-2 py-1 text-[11px] font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-neutral-200 rounded-md border border-neutral-700 transition disabled:opacity-40"
                        >
                          Снять выбор
                        </button>
                      </div>
                    )}
                  </div>

                  {isLoadingTracks ? (
                    <div className="py-6 flex items-center justify-center gap-2 text-xs text-neutral-400">
                      <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                      <span>Анализ загруженных дорожек дабберов (длительность и размер)...</span>
                    </div>
                  ) : catalogTracks.length === 0 ? (
                    <div className="py-4 text-center text-xs text-amber-400/90 bg-amber-950/20 border border-amber-800/30 rounded-lg px-3">
                      У этой серии пока нет загруженных аудиодорожек дабберов. Будут экспортированы видео и субтитры.
                    </div>
                  ) : (
                    <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                      {catalogTracks.map((tr) => {
                        const isChecked = selectedTrackIds.has(String(tr.id));
                        const isFix = tr.trackKind === 'fix';
                        return (
                          <label
                            key={tr.id}
                            className={`flex items-center justify-between gap-2.5 p-2 rounded-lg border transition cursor-pointer select-none ${
                              !tr.exists
                                ? 'bg-red-950/20 border-red-900/40 opacity-60 cursor-not-allowed'
                                : isChecked
                                  ? 'bg-indigo-950/30 border-indigo-500/40 hover:border-indigo-400/60'
                                  : 'bg-neutral-900/60 border-neutral-800/80 opacity-65 hover:opacity-100'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => tr.exists && handleToggleTrack(String(tr.id))}
                                disabled={isExporting || !tr.exists}
                                className="sr-only"
                              />
                              {isChecked ? (
                                <CheckSquare className="w-4 h-4 text-indigo-400 shrink-0" />
                              ) : (
                                <Square className="w-4 h-4 text-neutral-600 shrink-0" />
                              )}

                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-xs font-bold text-white">
                                    {tr.dubberNick}
                                  </span>
                                  <span
                                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                                      isFix
                                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                        : tr.totalOriginalForDubber > 1
                                          ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                                          : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                    }`}
                                  >
                                    {tr.roleLabel}
                                  </span>
                                  {!tr.exists && (
                                    <span className="text-[10px] bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded">
                                      Файл не найден
                                    </span>
                                  )}
                                </div>
                                <div
                                  className="text-[11px] font-mono text-indigo-200/90 truncate mt-0.5"
                                  title={`Итоговое имя при экспорте: ${tr.exportFileName}\nИсходный файл: ${tr.fileName}`}
                                >
                                  → {tr.exportFileName}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0 text-[11px] font-mono">
                              <span
                                className="px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-neutral-300 flex items-center gap-1"
                                title="Длительность аудиодорожки"
                              >
                                <Clock className="w-3 h-3 text-amber-400" />
                                {formatDurationLabel(tr.durationSec)}
                              </span>
                              <span
                                className="px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-neutral-300 flex items-center gap-1"
                                title="Размер файла на диске"
                              >
                                <HardDrive className="w-3 h-3 text-sky-400" />
                                {formatSizeMbLabel(tr.sizeBytes)}
                              </span>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-[10px] text-neutral-500 mt-2">
                    Отмеченные галочкой дорожки гарантированно войдут в экспорт со своими уникальными именами (Дорожка 1, Дорожка 2, Фикс не перезаписывают друг друга).
                  </p>
                </div>
              )}

              <div>
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className="relative flex items-center">
                    <input
                      type="checkbox"
                      checked={skipConversion}
                      onChange={(e) => setSkipConversion(e.target.checked)}
                      disabled={isExporting}
                      className="peer sr-only"
                    />
                    <div className="w-5 h-5 border-2 border-neutral-700 rounded bg-neutral-950 peer-checked:bg-indigo-600 peer-checked:border-indigo-600 transition-all duration-200 group-hover:border-neutral-500" />
                    <svg
                      className="absolute w-3.5 h-3.5 text-white opacity-0 peer-checked:opacity-100 transition-opacity duration-200 left-0.5 pointer-events-none"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="3"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <span className="text-sm text-neutral-300 group-hover:text-white transition-colors">
                    Не конвертировать видео (только копирование)
                  </span>
                </label>
                <p className="text-[10px] text-neutral-500 mt-1 ml-8">
                  Видео будет скопировано как есть, без сжатия и наложения субтитров
                </p>
              </div>

              {role === 'SOUND_ENGINEER' && (
                <>
                  <div>
                    <label className="flex items-center gap-3 cursor-pointer group">
                      <div className="relative flex items-center">
                        <input
                          type="checkbox"
                          checked={smartExport}
                          onChange={(e) => handleToggleSmartExport(e.target.checked)}
                          disabled={isExporting}
                          className="peer sr-only"
                        />
                        <div className="w-5 h-5 border-2 border-neutral-700 rounded bg-neutral-950 peer-checked:bg-purple-600 peer-checked:border-purple-600 transition-all duration-200 group-hover:border-neutral-500" />
                        <svg
                          className="absolute w-3.5 h-3.5 text-white opacity-0 peer-checked:opacity-100 transition-opacity duration-200 left-0.5 pointer-events-none"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth="3"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <span className="text-sm text-neutral-300 group-hover:text-white transition-colors">
                        Умная фильтрация полных фиксов (только для одиночных дорожек)
                      </span>
                    </label>
                    <p className="text-[10px] text-neutral-500 mt-1 ml-8">
                      Автоматически обновляет галочки в списке выше: если у даббера ровно 1 дорожка и полный фикс того же размера, снимает галочку со старого оригинала. Все мульти-дорожки (Дорожка 1, Дорожка 2) всегда остаются включены.
                    </p>
                  </div>

                  <div>
                    <label className={`flex items-center gap-3 ${snippetFixInfo.hasSnippetFixes && !isExporting ? 'cursor-pointer group' : 'cursor-not-allowed opacity-60'}`}>
                      <div className="relative flex items-center">
                        <input
                          type="checkbox"
                          checked={autoApplyFixes}
                          onChange={(e) => setAutoApplyFixes(e.target.checked)}
                          disabled={isExporting || !snippetFixInfo.hasSnippetFixes}
                          className="peer sr-only"
                        />
                        <div className={`w-5 h-5 border-2 rounded bg-neutral-950 transition-all duration-200 ${snippetFixInfo.hasSnippetFixes ? 'border-neutral-700 peer-checked:bg-emerald-600 peer-checked:border-emerald-600 group-hover:border-neutral-500' : 'border-neutral-800'}`} />
                        <svg
                          className="absolute w-3.5 h-3.5 text-white opacity-0 peer-checked:opacity-100 transition-opacity duration-200 left-0.5 pointer-events-none"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth="3"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm transition-colors ${snippetFixInfo.hasSnippetFixes ? 'text-neutral-300 group-hover:text-white' : 'text-neutral-500'}`}>
                          Автоматически применить фиксы
                        </span>
                        {snippetFixInfo.hasSnippetFixes ? (
                          <span className="text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded">
                            Доступно ({snippetFixInfo.count})
                          </span>
                        ) : (
                          <span className="text-[10px] font-medium bg-neutral-800 text-neutral-500 px-1.5 py-0.5 rounded">
                            Недоступно
                          </span>
                        )}
                      </div>
                    </label>
                    <p className="text-[10px] text-neutral-500 mt-1 ml-8">
                      {snippetFixInfo.hasSnippetFixes
                        ? 'Определяет границы фраз в фиксах, обнуляет громкость оригинала на этих интервалах и сводит с фиксом. Оригинальные дорожки и фиксы сохраняются в папку «бэкап».'
                        : 'Опция активна, только если размер файла фикса меньше оригинала (фрагментарный фикс).'}
                    </p>
                  </div>

                  <div>
                    <label className={`flex items-center gap-3 ${episode.subPath && !isExporting ? 'cursor-pointer group' : 'cursor-not-allowed opacity-60'}`}>
                      <div className="relative flex items-center">
                        <input
                          type="checkbox"
                          checked={includeSubtitles}
                          onChange={(e) => setIncludeSubtitles(e.target.checked)}
                          disabled={isExporting || !episode.subPath}
                          className="peer sr-only"
                        />
                        <div className={`w-5 h-5 border-2 rounded bg-neutral-950 transition-all duration-200 ${episode.subPath ? 'border-neutral-700 peer-checked:bg-blue-600 peer-checked:border-blue-600 group-hover:border-neutral-500' : 'border-neutral-800'}`} />
                        <svg
                          className="absolute w-3.5 h-3.5 text-white opacity-0 peer-checked:opacity-100 transition-opacity duration-200 left-0.5 pointer-events-none"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth="3"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm transition-colors ${episode.subPath ? 'text-neutral-300 group-hover:text-white' : 'text-neutral-500'}`}>
                          Общие сабы с размеченными дабберами
                        </span>
                        {episode.subPath ? (
                          <span className="text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1.5 py-0.5 rounded">
                            Включено
                          </span>
                        ) : (
                          <span className="text-[10px] font-medium bg-neutral-800 text-neutral-500 px-1.5 py-0.5 rounded">
                            Нет файла сабов
                          </span>
                        )}
                      </div>
                    </label>
                    <p className="text-[10px] text-neutral-500 mt-1 ml-8">
                      {episode.subPath 
                        ? 'Экспортирует файл «[субтитры_общие].ass», в котором в колонке ролей/имен подставлены никнеймы назначенных дабберов'
                        : 'К серии не прикреплены субтитры'}
                    </p>
                  </div>

                  <div className="p-3 bg-violet-950/20 border border-violet-900/30 rounded-xl">
                    <label className={`flex items-start gap-3 ${episode.subPath && !isExporting ? 'cursor-pointer group' : 'cursor-not-allowed opacity-60'}`}>
                      <div className="relative flex items-center mt-0.5">
                        <input
                          type="checkbox"
                          checked={autoTiming}
                          onChange={(e) => setAutoTiming(e.target.checked)}
                          disabled={isExporting || !episode.subPath}
                          className="peer sr-only"
                        />
                        <div className={`w-5 h-5 border-2 rounded bg-neutral-950 transition-all duration-200 ${episode.subPath ? 'border-violet-700/60 peer-checked:bg-violet-600 peer-checked:border-violet-500 group-hover:border-violet-500' : 'border-neutral-800'}`} />
                        <svg
                          className="absolute w-3.5 h-3.5 text-white opacity-0 peer-checked:opacity-100 transition-opacity duration-200 left-0.5 pointer-events-none"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth="3"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-semibold transition-colors ${episode.subPath ? 'text-violet-200 group-hover:text-white' : 'text-neutral-500'}`}>
                            Автоматический тайминг и разведение фраз
                          </span>
                          {episode.subPath ? (
                            <span className="text-[10px] font-bold bg-violet-500/20 text-violet-300 border border-violet-500/30 px-1.5 py-0.5 rounded">
                              Закадр
                            </span>
                          ) : (
                            <span className="text-[10px] font-medium bg-neutral-800 text-neutral-500 px-1.5 py-0.5 rounded">
                              Нет сабов
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-neutral-400 mt-1 leading-relaxed">
                          Сопоставляет дорожки дабберов с ролями в субтитрах по никнеймам, подгоняет начала фраз к субтитрам и разводит перекрытия (коллизии), сохраняя только оригинальные наложения из сабов. Исходники сохраняются в «бэкап».
                        </p>
                      </div>
                    </label>
                  </div>
                </>
              )}
              
              <div>
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className="relative flex items-center">
                    <input
                      type="checkbox"
                      checked={additionalProcessing}
                      onChange={(e) => setAdditionalProcessing(e.target.checked)}
                      disabled={isExporting}
                      className="peer sr-only"
                    />
                    <div className="w-5 h-5 border-2 border-neutral-700 rounded bg-neutral-950 peer-checked:bg-orange-600 peer-checked:border-orange-600 transition-all duration-200 group-hover:border-neutral-500" />
                    <svg
                      className="absolute w-3.5 h-3.5 text-white opacity-0 peer-checked:opacity-100 transition-opacity duration-200 left-0.5 pointer-events-none"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="3"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <span className="text-sm text-neutral-300 group-hover:text-white transition-colors">
                    Дополнительная обработка видео
                  </span>
                </label>
                <p className="text-[10px] text-neutral-500 mt-1 ml-8">
                  Применяет отражение по горизонтали, масштабирование (1.02) и обрезку 1920:1080 до вшивания субтитров
                </p>
              </div>

              {isExporting && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-neutral-400">
                    <span>Прогресс экспорта...</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="w-full bg-neutral-800 rounded-full h-2 overflow-hidden">
                    <div 
                      className="bg-indigo-500 h-full transition-all duration-300 ease-out"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t border-neutral-800 shrink-0">
          <button 
            onClick={onClose} 
            disabled={isExporting}
            title="Отменить экспорт и закрыть окно"
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-sm font-medium transition-colors border border-neutral-700 disabled:opacity-30"
          >
            {isWeb ? 'Закрыть' : 'Отмена'}
          </button>
          {!isWeb && (
            <button 
              onClick={() => onExport(
                targetDir,
                skipConversion,
                smartExport,
                false,
                additionalProcessing,
                autoApplyFixes,
                includeSubtitles,
                autoTiming,
                role === 'SOUND_ENGINEER' ? Array.from(selectedTrackIds) : undefined
              )} 
              title="Начать экспорт"
              disabled={!targetDir || isExporting || (role === 'SOUND_ENGINEER' && catalogTracks.length > 0 && selectedTrackIds.size === 0)}
              className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-indigo-500/20"
            >
              {isExporting
                ? 'Экспортируем...'
                : role === 'SOUND_ENGINEER' && catalogTracks.length > 0
                  ? `Экспорт (${selectedTrackIds.size} дор.)`
                  : 'Экспорт'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

