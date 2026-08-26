import React from "react";
import { Edit3 } from "lucide-react";
import { Episode } from "../types";
import SubtitleTimeline from "./AssEditor/SubtitleTimeline";
import MultiSubtitleMergeModal from "./MultiSubtitleMergeModal";
import { useSubtitleEditorState } from "./subtitleEditor/useSubtitleEditorState";
import { SubtitleEditorHeader } from "./subtitleEditor/SubtitleEditorHeader";
import { SubtitleLineList } from "./subtitleEditor/SubtitleLineList";
import { SubtitleSidebar } from "./subtitleEditor/SubtitleSidebar";
import { SubtitleShiftModal } from "./subtitleEditor/SubtitleShiftModal";
import { parseAssTimeToSeconds, secondsToAssTime } from "./subtitleEditor/utils";

interface RawSubtitleEditorProps {
  currentEpisode: Episode | null;
  onRefresh: () => void;
}

export default function RawSubtitleEditor({
  currentEpisode,
  onRefresh,
}: RawSubtitleEditorProps) {
  const {
    lines,
    loading,
    saving,
    status,
    updates,
    autoSave,
    setAutoSave,
    undoStack,
    redoStack,
    currentTime,
    setCurrentTime,
    isPlaying,
    activeLineIndex,
    setActiveLineIndex,
    bookmarks,
    showShiftModal,
    setShowShiftModal,
    shiftAmountMs,
    setShiftAmountMs,
    showSigns,
    setShowSigns,
    stableNames,
    selectedLines,
    massName,
    setMassName,
    videoRef,
    unassignedCount,
    totalDuration,
    isMultiSubMergeModalOpen,
    setIsMultiSubMergeModalOpen,
    autoApplyAliases,
    autoApplyStresses,
    handleToggleAutoApplyAliases,
    handleToggleAutoApplyStresses,
    handleUndo,
    handleRedo,
    handleToggleBookmark,
    handleJumpToBookmark,
    commitNewName,
    loadRawSubtitles,
    handleLineUpdate,
    toggleLineSelection,
    handleSelectAll,
    handleMassAssign,
    handleMassTransliterate,
    handleDeleteLine,
    handleDuplicateLine,
    handleAddLine,
    handleDrawLine,
    handleMassPolivanovToHepburn,
    handleSave,
    handleAutoFix,
    handleShiftTime,
    confirmShiftTime,
    handleQuickAssign,
    handleApplyAliases,
    handleApplyStresses,
    handlePlayFromTime,
    isSignLine,
  } = useSubtitleEditorState(currentEpisode, onRefresh);

  if (!currentEpisode?.subPath) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-neutral-500">
        <Edit3 className="w-12 h-12 opacity-20 mb-4" />
        <p>Загрузите файл субтитров (.ass), чтобы начать разметку реплик.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-row h-full overflow-hidden border border-neutral-800 rounded-2xl bg-neutral-950">
      {/* Left Column - Subtitles */}
      <div className="flex-1 flex flex-col bg-neutral-950 border-r border-neutral-800 overflow-hidden relative">
        <SubtitleEditorHeader
          loading={loading}
          saving={saving}
          status={status}
          unassignedCount={unassignedCount}
          undoDisabled={undoStack.length === 0}
          redoDisabled={redoStack.length === 0}
          autoSave={autoSave}
          showSigns={showSigns}
          onRefresh={loadRawSubtitles}
          onAutoFix={handleAutoFix}
          onShiftTime={handleShiftTime}
          onOpenMergeModal={() => setIsMultiSubMergeModalOpen(true)}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onToggleAutoSave={() => setAutoSave(!autoSave)}
          onToggleShowSigns={() => setShowSigns(!showSigns)}
        />

        <SubtitleLineList
          lines={lines}
          selectedLines={selectedLines}
          activeLineIndex={activeLineIndex}
          updates={updates}
          stableNames={stableNames}
          showSigns={showSigns}
          loading={loading}
          bookmarks={bookmarks}
          isSignLine={isSignLine}
          onSelectAll={handleSelectAll}
          onLineUpdate={handleLineUpdate}
          onToggleSelect={toggleLineSelection}
          onPlayFromTime={handlePlayFromTime}
          onDuplicateLine={handleDuplicateLine}
          onAddLine={handleAddLine}
          onDeleteLine={handleDeleteLine}
          onCommitName={commitNewName}
          onToggleBookmark={handleToggleBookmark}
        />

        <SubtitleTimeline
          rawPath={currentEpisode?.rawPath}
          lines={lines}
          updates={updates}
          activeLineIndex={activeLineIndex}
          currentTime={currentTime}
          totalDuration={totalDuration}
          onUpdateLine={handleLineUpdate}
          onSeek={(time) => {
            if (videoRef.current) {
              videoRef.current.currentTime = time;
            }
            setCurrentTime(time);
          }}
          onPlayPause={() => {
            if (videoRef.current) {
              if (videoRef.current.paused) {
                videoRef.current.play().catch(e => console.error('Play error', e));
              } else {
                videoRef.current.pause();
              }
            }
          }}
          isPlaying={isPlaying}
          onSelectLine={(rawLineIndex) => {
            setActiveLineIndex(rawLineIndex);
            const element = document.getElementById(`line-${rawLineIndex}`);
            if (element) {
              element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }}
          onDrawLine={handleDrawLine}
          secondsToAssTime={secondsToAssTime}
          parseAssTimeToSeconds={parseAssTimeToSeconds}
        />
      </div>

      {/* Right Column - Video & Controls */}
      <SubtitleSidebar
        currentEpisode={currentEpisode}
        videoRef={videoRef}
        lines={lines}
        updates={updates}
        selectedLines={selectedLines}
        activeLineIndex={activeLineIndex}
        stableNames={stableNames}
        bookmarks={bookmarks}
        massName={massName}
        loading={loading}
        saving={saving}
        autoApplyAliases={autoApplyAliases}
        autoApplyStresses={autoApplyStresses}
        onChangeMassName={setMassName}
        onMassAssign={handleMassAssign}
        onMassTransliterate={handleMassTransliterate}
        onMassPolivanovToHepburn={handleMassPolivanovToHepburn}
        onApplyAliases={handleApplyAliases}
        onApplyStresses={handleApplyStresses}
        onToggleAutoApplyAliases={handleToggleAutoApplyAliases}
        onToggleAutoApplyStresses={handleToggleAutoApplyStresses}
        onSave={handleSave}
        onQuickAssign={handleQuickAssign}
        onToggleBookmark={handleToggleBookmark}
        onJumpToBookmark={handleJumpToBookmark}
      />

      <SubtitleShiftModal
        isOpen={showShiftModal}
        shiftAmountMs={shiftAmountMs}
        onChangeShiftAmount={setShiftAmountMs}
        onConfirm={confirmShiftTime}
        onClose={() => setShowShiftModal(false)}
      />

      <MultiSubtitleMergeModal
        isOpen={isMultiSubMergeModalOpen}
        onClose={() => setIsMultiSubMergeModalOpen(false)}
        currentEpisode={currentEpisode}
        onRefresh={() => {
          loadRawSubtitles();
          onRefresh();
        }}
      />
    </div>
  );
}
