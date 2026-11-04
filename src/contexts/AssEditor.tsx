import { useState } from "react";
import {
  Scissors,
  Save,
  RotateCcw,
  Check,
  User,
  FileText,
  Edit3,
  Languages,
  Loader2,
  FileAudio,
  Mic,
  Terminal,
} from "lucide-react";
import { Episode } from "../types";
import TranslatePanel from "../components/TranslatePanel";
import AssOcrPanel from "../components/AssOcrPanel";
import AssWhisperPanel from "../components/AssWhisperPanel";
import AssDiarizationPanel from "../components/AssDiarizationPanel";
import RawSubtitleEditor from "../components/RawSubtitleEditor";
import { useAssEditorState } from "../components/AssEditor/useAssEditorState";
import { useAssSplitter } from "../components/AssEditor/useAssSplitter";
import { AssRolesView } from "../components/AssEditor/AssRolesView";
import { AssEditorModalsContainer } from "../components/AssEditor/AssEditorModalsContainer";

export interface AssEditorProps {
  currentEpisode: Episode | null;
  onRefresh: () => void;
  onRegisterUnsavedHandler?: (handler: {
    hasChanges: () => boolean;
    save: () => Promise<void>;
    discard: () => void;
  } | null) => void;
}

export default function AssEditor({
  currentEpisode,
  onRefresh,
  onRegisterUnsavedHandler,
}: AssEditorProps) {
  const [checkAll, setCheckAll] = useState(true);

  // Core ASS editor state & synchronization
  const {
    lines: _lines,
    actors,
    assignments,
    setAssignments,
    status,
    setStatus,
    participants,
    isSaving,
    activeTab,
    setActiveTab,
    linkingCharacter,
    setLinkingCharacter,
    hasUnsavedChanges,
    updateHasUnsavedChanges,
    pendingInternalTab,
    setPendingInternalTab,
    showInternalUnsavedModal,
    setShowInternalUnsavedModal,
    unassignedLinesCount,
    inspectingCharacter,
    setInspectingCharacter,
    isLogsOpen,
    setIsLogsOpen,
    assLogs,
    clearAssLogs,
    assErrorCount,
    confirmState,
    setConfirmState,
    globalMapping,
    characterAliases,
    getCharacterPortrait,
    handleManualSave,
    handleDiscardChanges,
    requestInternalTab,
    handleAnalyzeExisting,
    handleTransliterateNames,
    handlePolivanovToHepburn,
    handleAssignById,
    handleAddDubberToCharacter,
    handleRemoveAssignment,
    handleSetSubstitute,
    handleLinkAsAlias,
    handleClearAssignments,
    handleStartRecording,
  } = useAssEditorState(currentEpisode, onRefresh, onRegisterUnsavedHandler);

  // Subtitle splitting, exports, and messaging actions
  const {
    distributeGroups,
    setDistributeGroups,
    distributeMultipleRoles,
    setDistributeMultipleRoles,
    saveSignsInAss,
    setSaveSignsInAss,
    showSigns,
    setShowSigns,
    outputFormat,
    setOutputFormat,
    isSplitting,
    isMessageModalOpen,
    setIsMessageModalOpen,
    generatedMessage,
    isExportModalOpen,
    setIsExportModalOpen,
    isExporting,
    exportProgress,
    exportRole,
    setExportRole,
    showConsecutiveWarnings,
    setShowConsecutiveWarnings,
    consecutiveWarnings,
    handleExportMapping,
    handleImportMapping,
    handleExport,
    handleSplitAss,
    handleGenerateStartMessage,
    handleCheckConsecutiveLines,
    handleExportFullAss,
    handleExportCharacterSubtitles,
  } = useAssSplitter({
    currentEpisode,
    assignments,
    setAssignments,
    participants,
    setStatus,
    onRefresh,
    updateHasUnsavedChanges,
    handleAnalyzeExisting,
  });

  return (
    <div className="w-full h-full flex flex-col space-y-4 overflow-hidden pt-4 px-4 md:px-8 pb-8">
      {/* Top Header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
            <Scissors className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight">
              Работа с субтитрами
            </h1>
            {currentEpisode && (
              <p className="text-neutral-400 text-sm mt-1">
                Проект:{" "}
                <span className="text-indigo-400">
                  {currentEpisode.project?.title}
                </span>{" "}
                • Серия {currentEpisode.number}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
          {/* Manual Save / Discard Bar */}
          <div className="flex items-center gap-2 shrink-0">
            {hasUnsavedChanges ? (
              <>
                <button
                  onClick={handleManualSave}
                  disabled={isSaving}
                  title="Сохранить изменения ролей и проекта (Ctrl+S)"
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-lg shadow-emerald-600/30 transition-all cursor-pointer"
                >
                  {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  <span>{isSaving ? "Сохранение..." : "Сохранить проект"}</span>
                  <kbd className="hidden md:inline bg-emerald-700/60 text-[10px] px-1.5 py-0.5 rounded text-emerald-100 font-mono">
                    Ctrl+S
                  </kbd>
                </button>
                <button
                  onClick={handleDiscardChanges}
                  disabled={isSaving}
                  title="Сбросить несохраненные изменения"
                  className="flex items-center gap-1 px-2.5 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-medium border border-neutral-700 transition-all cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-neutral-400" />
                  <span className="hidden sm:inline">Сбросить</span>
                </button>
              </>
            ) : (
              <div className="flex items-center gap-1.5 px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-lg text-xs text-neutral-400">
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden sm:inline">Все изменения сохранены</span>
                <span className="sm:hidden">Сохранено</span>
              </div>
            )}
          </div>

          {/* Tab Navigation */}
          <div className="flex bg-neutral-900 rounded-lg p-1 border border-neutral-800 shrink-0">
            <button
              onClick={() => requestInternalTab("raw")}
              title="Переключиться на редактор разметки реплик"
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors relative cursor-pointer ${
                activeTab === "raw"
                  ? "bg-neutral-800 text-white shadow-sm"
                  : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
              }`}
            >
              <Edit3 className="w-4 h-4" />
              Разметка реплик
              {unassignedLinesCount > 0 && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-neutral-900 animate-pulse" />
              )}
            </button>
            <button
              onClick={() => requestInternalTab("roles")}
              title="Переключиться на распределение ролей"
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                activeTab === "roles"
                  ? "bg-neutral-800 text-white shadow-sm"
                  : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
              }`}
            >
              <User className="w-4 h-4" />
              Распределение ролей
            </button>
            <button
              onClick={() => requestInternalTab("translate")}
              title="Переключиться на панель перевода"
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                activeTab === "translate"
                  ? "bg-neutral-800 text-white shadow-sm"
                  : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
              }`}
            >
              <Languages className="w-4 h-4" />
              Перевод
            </button>
            <button
              onClick={() => requestInternalTab("ocr")}
              title="Переключиться на распознавание хардсаба"
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                activeTab === "ocr"
                  ? "bg-neutral-800 text-white shadow-sm"
                  : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
              }`}
            >
              <FileText className="w-4 h-4" />
              Распознавание хардсаба
            </button>
            <button
              onClick={() => requestInternalTab("whisper")}
              title="Переключиться на распознавание речи"
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                activeTab === "whisper"
                  ? "bg-neutral-800 text-white shadow-sm"
                  : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
              }`}
            >
              <FileAudio className="w-4 h-4" />
              Распознавание аудио
            </button>
            <button
              onClick={() => requestInternalTab("diarization")}
              title="Разделение голосов (Диаризация)"
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                activeTab === "diarization"
                  ? "bg-neutral-800 text-white shadow-sm"
                  : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
              }`}
            >
              <Mic className="w-4 h-4" />
              Диаризация голосов
            </button>

            <div className="w-px h-6 bg-neutral-800 my-auto mx-1" />

            <button
              onClick={() => setIsLogsOpen(!isLogsOpen)}
              title="Открыть журнал операций ASS субтитров"
              className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                isLogsOpen
                  ? "bg-indigo-600/30 text-indigo-300 border border-indigo-500/50"
                  : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
              }`}
            >
              <Terminal className="w-4 h-4 text-indigo-400" />
              <span>Логи</span>
              {assErrorCount > 0 && (
                <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Main Tab Area */}
      {activeTab === "raw" ? (
        <div className="flex-1 overflow-hidden">
          <RawSubtitleEditor
            currentEpisode={currentEpisode}
            onRefresh={onRefresh}
          />
        </div>
      ) : activeTab === "translate" ? (
        <TranslatePanel currentEpisode={currentEpisode} />
      ) : activeTab === "ocr" ? (
        <AssOcrPanel currentEpisode={currentEpisode} onRefresh={onRefresh} />
      ) : activeTab === "whisper" ? (
        <AssWhisperPanel currentEpisode={currentEpisode} onRefresh={onRefresh} />
      ) : activeTab === "diarization" ? (
        <AssDiarizationPanel currentEpisode={currentEpisode} onRefresh={onRefresh} />
      ) : (
        <AssRolesView
          currentEpisode={currentEpisode}
          assignments={assignments}
          setAssignments={setAssignments}
          participants={participants}
          actors={actors}
          status={status}
          isSaving={isSaving}
          unassignedLinesCount={unassignedLinesCount}
          checkAll={checkAll}
          setCheckAll={setCheckAll}
          distributeGroups={distributeGroups}
          setDistributeGroups={setDistributeGroups}
          distributeMultipleRoles={distributeMultipleRoles}
          setDistributeMultipleRoles={setDistributeMultipleRoles}
          saveSignsInAss={saveSignsInAss}
          setSaveSignsInAss={setSaveSignsInAss}
          showSigns={showSigns}
          setShowSigns={setShowSigns}
          outputFormat={outputFormat}
          setOutputFormat={setOutputFormat}
          isSplitting={isSplitting}
          linkingCharacter={linkingCharacter}
          setLinkingCharacter={setLinkingCharacter}
          globalMapping={globalMapping}
          getCharacterPortrait={getCharacterPortrait}
          setInspectingCharacter={setInspectingCharacter}
          setExportRole={setExportRole}
          setIsExportModalOpen={setIsExportModalOpen}
          updateHasUnsavedChanges={updateHasUnsavedChanges}
          handleAnalyzeExisting={handleAnalyzeExisting}
          handleStartRecording={handleStartRecording}
          handleSplitAss={handleSplitAss}
          handleGenerateStartMessage={handleGenerateStartMessage}
          handleExportMapping={handleExportMapping}
          handleImportMapping={handleImportMapping}
          handleCheckConsecutiveLines={handleCheckConsecutiveLines}
          handleExportFullAss={handleExportFullAss}
          handleClearAssignments={handleClearAssignments}
          handleTransliterateNames={handleTransliterateNames}
          handlePolivanovToHepburn={handlePolivanovToHepburn}
          handleExportCharacterSubtitles={handleExportCharacterSubtitles}
          handleLinkAsAlias={handleLinkAsAlias}
          handleAddDubberToCharacter={handleAddDubberToCharacter}
          handleAssignById={handleAssignById}
          handleSetSubstitute={handleSetSubstitute}
          handleRemoveAssignment={handleRemoveAssignment}
        />
      )}

      {/* Modals & Dialogs Container */}
      <AssEditorModalsContainer
        currentEpisode={currentEpisode}
        onRefresh={onRefresh}
        assignments={assignments}
        setAssignments={setAssignments}
        actors={actors}
        participants={participants}
        globalMapping={globalMapping}
        characterAliases={characterAliases}
        updateHasUnsavedChanges={updateHasUnsavedChanges}
        handleAnalyzeExisting={handleAnalyzeExisting}
        handleManualSave={handleManualSave}
        handleDiscardChanges={handleDiscardChanges}
        showConsecutiveWarnings={showConsecutiveWarnings}
        setShowConsecutiveWarnings={setShowConsecutiveWarnings}
        consecutiveWarnings={consecutiveWarnings}
        isExportModalOpen={isExportModalOpen}
        setIsExportModalOpen={setIsExportModalOpen}
        exportRole={exportRole}
        isExporting={isExporting}
        exportProgress={exportProgress}
        handleExport={handleExport}
        isMessageModalOpen={isMessageModalOpen}
        setIsMessageModalOpen={setIsMessageModalOpen}
        generatedMessage={generatedMessage}
        setStatus={setStatus}
        confirmState={confirmState}
        setConfirmState={setConfirmState}
        inspectingCharacter={inspectingCharacter}
        setInspectingCharacter={setInspectingCharacter}
        isLogsOpen={isLogsOpen}
        setIsLogsOpen={setIsLogsOpen}
        assLogs={assLogs}
        clearAssLogs={clearAssLogs}
        showInternalUnsavedModal={showInternalUnsavedModal}
        setShowInternalUnsavedModal={setShowInternalUnsavedModal}
        pendingInternalTab={pendingInternalTab}
        setPendingInternalTab={setPendingInternalTab}
        setActiveTab={setActiveTab}
        isSaving={isSaving}
      />
    </div>
  );
}
