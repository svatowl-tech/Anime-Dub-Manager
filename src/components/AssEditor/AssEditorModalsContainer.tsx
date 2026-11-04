import React from "react";
import { Edit3, CheckSquare, MessageSquare, X, Copy } from "lucide-react";
import { Episode, Participant, RoleAssignment } from "../../types";
import { ExportModal } from "../ExportModal";
import { ConfirmModal } from "../ui/ConfirmModal";
import { UnsavedChangesModal } from "../ui/UnsavedChangesModal";
import CharacterVoiceInspectorModal from "../characterPreview/CharacterVoiceInspectorModal";
import { LogViewerDrawer } from "../common/LogViewerDrawer";
import { safeCopyToClipboard } from "../../lib/clipboard";
import { ipcSafe } from "../../lib/ipcSafe";
import { toast } from 'sonner';

export interface AssEditorModalsContainerProps {
  currentEpisode: Episode | null;
  onRefresh: () => void;
  assignments: RoleAssignment[];
  setAssignments: React.Dispatch<React.SetStateAction<RoleAssignment[]>>;
  actors: string[];
  participants: Participant[];
  globalMapping: { characterName: string; dubberId: string; photoUrl?: string; isMain?: boolean }[];
  characterAliases: Record<string, string>;
  updateHasUnsavedChanges: (val: boolean) => void;
  handleAnalyzeExisting: () => Promise<RoleAssignment[]>;
  handleManualSave: () => Promise<void>;
  handleDiscardChanges: () => void;
  // Modals state
  showConsecutiveWarnings: boolean;
  setShowConsecutiveWarnings: (val: boolean) => void;
  consecutiveWarnings: any[];
  isExportModalOpen: boolean;
  setIsExportModalOpen: (val: boolean) => void;
  exportRole: 'DABBER' | 'SOUND_ENGINEER';
  isExporting: boolean;
  exportProgress: number;
  handleExport: (
    targetDir: string,
    skipConversion: boolean,
    smartExport?: boolean,
    uploadToYandex?: boolean,
    additionalProcessing?: boolean,
    autoApplyFixesOrAssignments?: boolean | RoleAssignment[],
    includeSubtitlesOrAssignments?: boolean | RoleAssignment[],
    autoTiming?: boolean,
    currentAssignmentsOrTrackIds?: RoleAssignment[] | string[],
    selectedTrackIdsArg?: string[]
  ) => Promise<void>;
  isMessageModalOpen: boolean;
  setIsMessageModalOpen: (val: boolean) => void;
  generatedMessage: string;
  setStatus: (msg: string) => void;
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
  inspectingCharacter: string | null;
  setInspectingCharacter: (char: string | null) => void;
  isLogsOpen: boolean;
  setIsLogsOpen: (open: boolean) => void;
  assLogs: any[];
  clearAssLogs: () => void;
  showInternalUnsavedModal: boolean;
  setShowInternalUnsavedModal: (show: boolean) => void;
  pendingInternalTab: any;
  setPendingInternalTab: (tab: any) => void;
  setActiveTab: (tab: any) => void;
  isSaving: boolean;
}

export function AssEditorModalsContainer({
  currentEpisode,
  onRefresh,
  assignments,
  setAssignments,
  actors,
  participants,
  globalMapping,
  characterAliases,
  updateHasUnsavedChanges,
  handleAnalyzeExisting,
  handleManualSave,
  handleDiscardChanges,
  showConsecutiveWarnings,
  setShowConsecutiveWarnings,
  consecutiveWarnings,
  isExportModalOpen,
  setIsExportModalOpen,
  exportRole,
  isExporting,
  exportProgress,
  handleExport,
  isMessageModalOpen,
  setIsMessageModalOpen,
  generatedMessage,
  setStatus,
  confirmState,
  setConfirmState,
  inspectingCharacter,
  setInspectingCharacter,
  isLogsOpen,
  setIsLogsOpen,
  assLogs,
  clearAssLogs,
  showInternalUnsavedModal,
  setShowInternalUnsavedModal,
  pendingInternalTab,
  setPendingInternalTab,
  setActiveTab,
  isSaving,
}: AssEditorModalsContainerProps) {
  return (
    <>
      {/* Consecutive Warnings Modal */}
      {showConsecutiveWarnings && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 max-w-4xl w-full max-h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between mb-6 shrink-0">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Edit3 className="w-6 h-6 text-amber-500" />
                Проверка на склейки
              </h2>
              <button
                onClick={() => setShowConsecutiveWarnings(false)}
                className="text-neutral-500 hover:text-white transition-colors cursor-pointer"
              >
                Закрыть
              </button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 space-y-4 pr-2">
              {consecutiveWarnings.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-green-500">
                  <CheckSquare className="w-12 h-12 mb-4 opacity-50" />
                  <p className="text-lg font-medium">Склеек не найдено!</p>
                  <p className="text-sm text-neutral-400 mt-2">Все даберы имеют достаточно времени между репликами разных персонажей.</p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-amber-400 mb-4">
                    Найдено {consecutiveWarnings.length} потенциальных склеек (разрыв менее 2 секунд между репликами разных персонажей у одного дабера).
                  </p>
                  {consecutiveWarnings.map((w, i) => (
                    <div key={w.dubberName + i} className="bg-neutral-950 border border-neutral-800 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="px-2 py-1 bg-indigo-500/20 text-indigo-400 rounded text-xs font-bold">
                          {w.dubberName}
                        </span>
                        <span className="text-neutral-500 text-xs">
                          зазор: <span className={w.gap < 0 ? "text-red-400 font-bold" : "text-amber-400 font-bold"}>{w.gap.toFixed(2)}с</span>
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-neutral-900 border border-neutral-800 p-3 rounded">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-xs font-bold text-blue-400">{w.char1}</span>
                            <span className="text-[10px] text-neutral-500 font-mono">{w.time1} - {w.end1}</span>
                          </div>
                          <p className="text-sm text-neutral-300">{w.text1}</p>
                        </div>
                        <div className="bg-neutral-900 border border-neutral-800 p-3 rounded">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-xs font-bold text-purple-400">{w.char2}</span>
                            <span className="text-[10px] text-neutral-500 font-mono">{w.time2} - {w.end2}</span>
                          </div>
                          <p className="text-sm text-neutral-300">{w.text2}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Export Modal */}
      {isExportModalOpen && currentEpisode && (
        <ExportModal
          isOpen={isExportModalOpen}
          onClose={() => setIsExportModalOpen(false)}
          episode={currentEpisode}
          role={exportRole}
          onExport={(targetDir, skipConversion, smartExport, uploadToYandex, additionalProcessing, autoApplyFixes, includeSubtitles, autoTiming, selectedTrackIds) => {
            handleExport(targetDir, skipConversion, smartExport, uploadToYandex, additionalProcessing, autoApplyFixes, includeSubtitles, autoTiming, assignments, selectedTrackIds);
          }}
          isExporting={isExporting}
          progress={exportProgress}
        />
      )}

      {/* Message Modal */}
      {isMessageModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="p-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/50">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-blue-400" />
                Сгенерированное сообщение
              </h3>
              <button
                onClick={() => setIsMessageModalOpen(false)}
                className="text-neutral-500 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto">
              <textarea
                readOnly
                value={generatedMessage}
                className="w-full h-64 bg-neutral-950 border border-neutral-800 rounded-xl p-4 text-neutral-300 font-mono text-sm focus:outline-none focus:border-blue-500 resize-none"
              />
            </div>
            <div className="p-4 border-t border-neutral-800 bg-neutral-950/50 flex gap-3">
              <button
                onClick={async () => {
                  try {
                    const ok = await safeCopyToClipboard(generatedMessage);
                    if (ok) {
                      setStatus("Сообщение скопировано в буфер обмена!");
                      toast.success("Сообщение скопировано в буфер обмена!");
                    } else {
                      setStatus("Не удалось скопировать сообщение");
                    }
                  } catch (e) {
                    setStatus("Ошибка при копировании");
                  }
                }}
                className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <Copy className="w-4 h-4" />
                Копировать
              </button>
              <button
                onClick={() => setIsMessageModalOpen(false)}
                className="flex-1 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg font-medium transition-colors cursor-pointer"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        variant={confirmState.variant}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState(prev => ({ ...prev, isOpen: false }))}
      />

      {/* Character Voice Inspector Modal */}
      {inspectingCharacter && (
        <CharacterVoiceInspectorModal
          isOpen={!!inspectingCharacter}
          onClose={() => setInspectingCharacter(null)}
          characterName={inspectingCharacter}
          currentEpisode={currentEpisode}
          project={currentEpisode?.project}
          participants={participants}
          assignments={assignments}
          globalMapping={globalMapping}
          characterAliases={characterAliases}
          onAssignDubber={(charName, dubberId) => {
            const dubber = participants.find(p => p.id === dubberId);
            const updated = assignments.map(a =>
              a.characterName === charName ? { ...a, dubberId, dubber } : a
            );
            setAssignments(updated);
            updateHasUnsavedChanges(true);
          }}
          onToggleMainRole={(charName, isMain) => {
            const updated = assignments.map(a =>
              a.characterName === charName ? { ...a, isMain } : a
            );
            setAssignments(updated);
            updateHasUnsavedChanges(true);
          }}
          onUpdatePortrait={async (charName, photoUrl) => {
            if (!currentEpisode?.project) return;
            try {
              let existingMapping: { characterName: string; dubberId: string; photoUrl?: string; isMain?: boolean }[] = [];
              try {
                const raw = currentEpisode.project.globalMapping || '[]';
                const parsed = JSON.parse(raw);
                existingMapping = Array.isArray(parsed) ? parsed : [];
              } catch (e) {}

              const idx = existingMapping.findIndex(
                m => m.characterName.toLowerCase() === charName.toLowerCase()
              );
              if (idx !== -1) {
                existingMapping[idx] = { ...existingMapping[idx], photoUrl };
              } else {
                existingMapping.push({ characterName: charName, dubberId: '', photoUrl });
              }

              const updatedProject = {
                ...currentEpisode.project,
                globalMapping: JSON.stringify(existingMapping)
              };
              await ipcSafe.invoke('save-project', updatedProject);
              if (currentEpisode.project) {
                currentEpisode.project.globalMapping = updatedProject.globalMapping;
              }
              onRefresh();
            } catch (err) {
              console.error('Failed to save character portrait:', err);
            }
          }}
          onNavigateCharacter={(direction) => {
            const names = Array.from(new Set(assignments.map(a => a.characterName)));
            if (names.length === 0) return;
            const curIdx = names.indexOf(inspectingCharacter || '');
            let nextIdx = direction === 'next' ? curIdx + 1 : curIdx - 1;
            if (nextIdx < 0) nextIdx = names.length - 1;
            if (nextIdx >= names.length) nextIdx = 0;
            setInspectingCharacter(names[nextIdx]);
          }}
          onReassignLine={async () => {
            await handleAnalyzeExisting();
            onRefresh();
          }}
          onRefreshData={() => {
            handleAnalyzeExisting();
            onRefresh();
          }}
          characterList={Array.from(new Set([...actors, ...assignments.map(a => a.characterName)]))}
          currentIndex={Array.from(new Set(assignments.map(a => a.characterName))).indexOf(inspectingCharacter || '')}
          totalCharacters={Array.from(new Set(assignments.map(a => a.characterName))).length}
        />
      )}

      {/* Logs Drawer */}
      {isLogsOpen && (
        <div className="w-full shrink-0">
          <LogViewerDrawer
            title="Журнал работы с субтитрами (ASS)"
            scope="ass"
            logs={assLogs}
            onClear={clearAssLogs}
            isOpen={isLogsOpen}
            onToggle={() => setIsLogsOpen(!isLogsOpen)}
            maxHeightClass="max-h-48"
          />
        </div>
      )}

      {/* Unsaved Changes Guard Modal */}
      <UnsavedChangesModal
        isOpen={showInternalUnsavedModal}
        title="Несохраненные изменения"
        message="В распределении ролей есть несохраненные изменения. Сохранить их перед переходом во вкладку?"
        onSaveAndProceed={async () => {
          await handleManualSave();
          if (pendingInternalTab) setActiveTab(pendingInternalTab);
          setShowInternalUnsavedModal(false);
          setPendingInternalTab(null);
        }}
        onDiscardAndProceed={() => {
          handleDiscardChanges();
          if (pendingInternalTab) setActiveTab(pendingInternalTab);
          setShowInternalUnsavedModal(false);
          setPendingInternalTab(null);
        }}
        onCancel={() => {
          setShowInternalUnsavedModal(false);
          setPendingInternalTab(null);
        }}
        isSaving={isSaving}
      />
    </>
  );
}
