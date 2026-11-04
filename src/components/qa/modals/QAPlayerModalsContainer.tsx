import React from 'react';
import {
  MessageSquare,
  X,
  SkipBack,
  SkipForward,
  Sparkles,
  Check,
  Save,
  Clock
} from 'lucide-react';
import { toast } from 'sonner';
import { safeCopyToClipboard } from '../../../lib/clipboard';
import { Episode, Participant, Track, SubtitleLine } from '../../../types';
import { MissingLineDetection, GapDetectionOptions, QAScanReport } from '../../../lib/qa/missingLinesDetector';
import { QAScanConfigModal } from '../QAScanConfigModal';
import { MissingLinesModal } from '../MissingLinesModal';
import { ExportModal } from '../../ExportModal';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { saveQAGapsToTimingProject } from '../../../lib/qa/timingSyncService';

export interface QAPlayerModalsContainerProps {
  currentEpisode: Episode;
  tracks: Track[];
  selectedTrack?: Track;
  currentTime: number;
  handleSeekToTime: (time: number) => void;
  seekToNext: () => void;
  seekToPrev: () => void;
  subLines: SubtitleLine[];
  currentSubtitleText: string | null;
  currentDubberNickname: string | null;
  commentModal: { isOpen: boolean; region: any } | null;
  setCommentModal: React.Dispatch<React.SetStateAction<{ isOpen: boolean; region: any } | null>>;
  newComment: string;
  setNewComment: React.Dispatch<React.SetStateAction<string>>;
  handleAddComment: (textOverride?: string) => Promise<void>;
  isManualDubberOverride: boolean;
  setIsManualDubberOverride: React.Dispatch<React.SetStateAction<boolean>>;
  manualDubberId: string;
  setManualDubberId: React.Dispatch<React.SetStateAction<string>>;
  availableDubbers: Array<{ id: string; name: string; roles: string; trackId?: string }>;
  isScanConfigModalOpen: boolean;
  setIsScanConfigModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  gapScanOptions: GapDetectionOptions;
  setGapScanOptions: React.Dispatch<React.SetStateAction<GapDetectionOptions>>;
  handleExecuteGapDetection: (overrideOptions?: GapDetectionOptions) => Promise<void>;
  isGapModalOpen: boolean;
  setIsGapModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  detectedGaps: MissingLineDetection[];
  participants: Participant[];
  onNavigate?: (tab: 'dashboard' | 'subtitles' | 'qa' | 'timing' | 'mixing' | 'release' | 'telegram' | 'settings' | 'database' | 'cover' | 'stats' | 'archive') => void;
  handleApplyGapFixes: (selectedGaps: MissingLineDetection[]) => Promise<void>;
  isApplyingGapFixes: boolean;
  handleRunGapDetection: (overrideThreshold?: number) => Promise<void>;
  isAnalyzingGaps: boolean;
  gapSensitivityThreshold: number;
  qaScanReport: QAScanReport | null;
  videoUrl?: string;
  handleUpdateSubLineFromModal: (updatedLine: { rawLineIndex: number; name?: string; text?: string; start?: string; end?: string }) => Promise<void>;
  handleExportSubtitlesFromModal: () => Promise<void>;
  handleSaveDetectedGaps: (updatedGaps: MissingLineDetection[]) => void;
  isExportModalOpen: boolean;
  setIsExportModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleExportSoundEngineer: (targetDir: string, skipConversion: boolean, smartExport?: boolean, uploadToYandex?: boolean, additionalProcessing?: boolean, autoApplyFixes?: boolean, includeSubtitles?: boolean, autoTiming?: boolean, selectedTrackIds?: string[]) => Promise<void>;
  isUploading: boolean;
  isMessageModalOpen: boolean;
  setIsMessageModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  generatedMessage: string | null;
  isMessageCopied: boolean;
  setIsMessageCopied: React.Dispatch<React.SetStateAction<boolean>>;
  isBaking: boolean;
  bakeProgress: number;
  bakeStatus: string;
  confirmState: {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    variant?: 'danger' | 'warning' | 'info';
  };
  setConfirmState: React.Dispatch<React.SetStateAction<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    variant?: 'danger' | 'warning' | 'info';
  }>>;
}

export const QAPlayerModalsContainer: React.FC<QAPlayerModalsContainerProps> = ({
  currentEpisode,
  tracks,
  selectedTrack,
  currentTime,
  handleSeekToTime,
  seekToNext,
  seekToPrev,
  subLines,
  currentSubtitleText,
  currentDubberNickname,
  commentModal,
  setCommentModal,
  newComment,
  setNewComment,
  handleAddComment,
  isManualDubberOverride,
  setIsManualDubberOverride,
  manualDubberId,
  setManualDubberId,
  availableDubbers,
  isScanConfigModalOpen,
  setIsScanConfigModalOpen,
  gapScanOptions,
  setGapScanOptions,
  handleExecuteGapDetection,
  isGapModalOpen,
  setIsGapModalOpen,
  detectedGaps,
  participants,
  onNavigate,
  handleApplyGapFixes,
  isApplyingGapFixes,
  handleRunGapDetection,
  isAnalyzingGaps,
  gapSensitivityThreshold,
  qaScanReport,
  videoUrl,
  handleUpdateSubLineFromModal,
  handleExportSubtitlesFromModal,
  handleSaveDetectedGaps,
  isExportModalOpen,
  setIsExportModalOpen,
  handleExportSoundEngineer,
  isUploading,
  isMessageModalOpen,
  setIsMessageModalOpen,
  generatedMessage,
  isMessageCopied,
  setIsMessageCopied,
  isBaking,
  bakeProgress,
  bakeStatus,
  confirmState,
  setConfirmState
}) => {
  const currentSubIndex = React.useMemo(() => {
    if (!subLines || subLines.length === 0) return -1;
    let idx = -1;
    for (let i = subLines.length - 1; i >= 0; i--) {
      if (currentTime >= (subLines[i].startSec ?? 0) - 0.05) {
        idx = i;
        break;
      }
    }
    return idx;
  }, [subLines, currentTime]);

  return (
    <>
      {/* Comment Modal */}
      {commentModal?.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-neutral-900 p-6 rounded-xl border border-neutral-700 w-full max-w-md space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-bold text-base flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-blue-400" />
                <span>Добавить правку на {new Date(currentTime * 1000).toISOString().substr(14, 5)}</span>
              </h3>
              <button 
                onClick={() => setCommentModal(null)} 
                className="text-neutral-500 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Subtitle navigation row inside modal */}
            <div className="flex items-center justify-between gap-2 bg-neutral-950 p-2 rounded-lg border border-neutral-800 text-xs">
              <span className="text-neutral-400 font-medium">Субтитр {currentSubIndex >= 0 ? `${currentSubIndex + 1}` : '–'} / {subLines.length}</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={seekToPrev}
                  disabled={subLines.length === 0}
                  className="px-2 py-0.5 rounded bg-neutral-850 hover:bg-neutral-750 text-neutral-200 text-xs flex items-center gap-1 disabled:opacity-40"
                  title="К предыдущему субтитру"
                >
                  <SkipBack className="w-3 h-3 text-blue-400" />
                  <span>Пред</span>
                </button>
                <button
                  type="button"
                  onClick={seekToNext}
                  disabled={subLines.length === 0}
                  className="px-2 py-0.5 rounded bg-neutral-850 hover:bg-neutral-750 text-neutral-200 text-xs flex items-center gap-1 disabled:opacity-40"
                  title="К следующему субтитру"
                >
                  <span>След</span>
                  <SkipForward className="w-3 h-3 text-blue-400" />
                </button>
              </div>
            </div>

            {/* Manual dubber selection inside modal */}
            <div className="flex items-center gap-2 bg-neutral-950 p-2.5 rounded-lg border border-neutral-800">
              <label className="flex items-center gap-1.5 text-xs text-neutral-300 cursor-pointer select-none font-medium">
                <input
                  type="checkbox"
                  checked={isManualDubberOverride}
                  onChange={(e) => {
                    setIsManualDubberOverride(e.target.checked);
                    if (e.target.checked && !manualDubberId && availableDubbers.length > 0) {
                      setManualDubberId(availableDubbers[0].id);
                    }
                  }}
                  className="rounded border-neutral-700 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 accent-blue-600 cursor-pointer"
                />
                <span>Указать дабера:</span>
              </label>
              {isManualDubberOverride ? (
                <select
                  value={manualDubberId}
                  onChange={(e) => setManualDubberId(e.target.value)}
                  className="flex-1 bg-neutral-850 border border-blue-500/60 text-blue-200 text-xs font-semibold rounded px-2 py-1 focus:outline-none"
                >
                  {availableDubbers.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.name} {d.roles ? `(${d.roles})` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-[11px] text-neutral-500 italic">
                  (авто: {currentDubberNickname || selectedTrack?.participant || 'по фразе'})
                </span>
              )}
            </div>

            {currentSubtitleText && (
              <div className="text-xs text-amber-200/90 bg-neutral-950/60 px-2.5 py-1.5 rounded border border-neutral-800/80 italic line-clamp-2">
                "{currentSubtitleText}"
              </div>
            )}

            <input 
              type="text" 
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              className="bg-neutral-800 border border-neutral-700 text-white rounded-lg px-4 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              placeholder={
                isManualDubberOverride
                  ? `Текст замечания для ${availableDubbers.find(d => d.id === manualDubberId)?.name || 'даббера'}...`
                  : "Текст замечания / фикса..."
              }
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleAddComment();
                  setCommentModal(null);
                }
              }}
            />

            <div className="flex justify-end gap-2 pt-2 border-t border-neutral-800">
              <button 
                onClick={() => setCommentModal(null)} 
                className="px-4 py-1.5 rounded-lg text-xs text-neutral-400 hover:text-white bg-neutral-800 hover:bg-neutral-700 transition"
              >
                Отмена
              </button>
              <button 
                onClick={() => {
                  handleAddComment();
                  setCommentModal(null);
                }} 
                disabled={!newComment.trim()}
                className="px-5 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white transition flex items-center gap-1.5 shadow-md shadow-blue-600/20"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Выписать фикс</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pre-scan Configuration Modal */}
      {isScanConfigModalOpen && (
        <QAScanConfigModal
          isOpen={isScanConfigModalOpen}
          onClose={() => setIsScanConfigModalOpen(false)}
          onStartScan={(options) => {
            setGapScanOptions(options);
            setIsScanConfigModalOpen(false);
            handleExecuteGapDetection(options);
          }}
          initialOptions={gapScanOptions}
          totalDubbers={tracks.filter(t => t.id !== 'original' && t.files.length > 0).length}
          totalSubLines={subLines.length}
        />
      )}

      {/* Missing Lines / Gaps Review Modal */}
      {isGapModalOpen && (
        <MissingLinesModal
          isOpen={isGapModalOpen}
          onClose={() => setIsGapModalOpen(false)}
          gaps={detectedGaps}
          episode={currentEpisode}
          participants={participants}
          tracks={tracks}
          onOpenTimingPanel={() => {
            setIsGapModalOpen(false);
            onNavigate?.('timing');
          }}
          onApplyFixes={handleApplyGapFixes}
          onSeekMainPlayer={(timeSec) => {
            handleSeekToTime(timeSec);
          }}
          isApplying={isApplyingGapFixes}
          onReAnalyze={handleRunGapDetection}
          onOpenScanConfig={() => setIsScanConfigModalOpen(true)}
          isAnalyzing={isAnalyzingGaps}
          currentThreshold={gapSensitivityThreshold}
          scanReport={qaScanReport || (detectedGaps as any)?.scanReport}
          videoUrl={videoUrl}
          subLines={subLines}
          onUpdateSubLine={handleUpdateSubLineFromModal}
          onExportSubtitles={handleExportSubtitlesFromModal}
          onSaveGaps={handleSaveDetectedGaps}
        />
      )}

      {/* Export Modal */}
      {isExportModalOpen && currentEpisode && (
        <ExportModal 
          isOpen={isExportModalOpen}
          onClose={() => setIsExportModalOpen(false)}
          episode={currentEpisode}
          role="SOUND_ENGINEER"
          onExport={handleExportSoundEngineer}
          isExporting={isUploading}
        />
      )}

      {/* Message Modal */}
      {isMessageModalOpen && generatedMessage && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
            <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-400" />
                <h2 className="text-xl font-semibold text-white">Сформированное сообщение</h2>
              </div>
              <button onClick={() => setIsMessageModalOpen(false)} className="text-neutral-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6">
              <pre className="bg-black/50 border border-neutral-800 rounded-xl p-6 text-sm text-neutral-300 whitespace-pre-wrap font-mono leading-relaxed max-h-[50vh] overflow-y-auto custom-scrollbar">
                {generatedMessage}
              </pre>
              
              <div className="mt-6 flex gap-3">
                <button 
                  onClick={async () => {
                    if (!generatedMessage) return;
                    try {
                      const ok = await safeCopyToClipboard(generatedMessage);
                      if (ok) {
                        setIsMessageCopied(true);
                        toast.success('Скопировано в буфер обмена!');
                        setTimeout(() => setIsMessageCopied(false), 2000);
                      } else {
                        toast.error('Не удалось скопировать в буфер обмена');
                      }
                    } catch (e: any) {
                      toast.error('Ошибка копирования: ' + (e?.message || String(e)));
                    }
                  }}
                  className={`flex-1 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer ${
                    isMessageCopied ? 'bg-emerald-600 text-white shadow-emerald-500/20' : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/20'
                  }`}
                >
                  {isMessageCopied ? <Check className="w-5 h-5" /> : <Save className="w-5 h-5" />}
                  {isMessageCopied ? 'Скопировано!' : 'Скопировать текст'}
                </button>
                <button
                  onClick={async () => {
                    if (!currentEpisode) return;
                    try {
                      const res = await saveQAGapsToTimingProject(currentEpisode, detectedGaps, tracks);
                      toast.success(
                        `✓ Записано в файл тайминга! (Наездов: ${res.summary.overlapsCount}, коллизий: ${res.summary.collisionsCount}, рассинхронов: ${res.summary.desyncCount})`
                      );
                      setIsMessageModalOpen(false);
                      onNavigate?.('timing');
                    } catch (e: any) {
                      toast.error('Ошибка записи в тайминг: ' + (e?.message || String(e)));
                    }
                  }}
                  className="px-6 py-3 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-amber-600/25"
                  title="Записать найденные замечания в файл тайминга серии и сразу открыть Тайминг видео (если сводите серию сами)"
                >
                  <Clock className="w-5 h-5 text-white" />
                  <span>Записать в тайминг (свожу сам)</span>
                </button>
                <button 
                  onClick={() => setIsMessageModalOpen(false)}
                  className="px-8 py-3 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl font-bold transition-all"
                >
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Baking Progress Overlay */}
      {isBaking && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-xl">
          <div className="w-full max-w-md p-8 text-center space-y-6">
            <div className="relative w-32 h-32 mx-auto">
              <div className="absolute inset-0 border-4 border-neutral-800 rounded-full" />
              <div 
                className="absolute inset-0 border-4 border-blue-500 rounded-full transition-all duration-500"
                style={{ 
                  clipPath: `inset(${100 - bakeProgress}% 0 0 0)`,
                  filter: 'drop-shadow(0 0 8px rgba(59, 130, 246, 0.5))'
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-2xl font-bold text-white">{Math.round(bakeProgress)}%</span>
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold text-white">Рендеринг видео</h3>
              <p className="text-neutral-400 text-sm">{bakeStatus}</p>
            </div>
            <div className="w-full bg-neutral-800 h-1.5 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 transition-all duration-500"
                style={{ width: `${bakeProgress}%` }}
              />
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState(prev => ({ ...prev, isOpen: false }))}
        variant={confirmState.variant}
      />
    </>
  );
};
