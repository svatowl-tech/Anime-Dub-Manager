import React from 'react';
import {
  X,
  User,
  ChevronLeft,
  ChevronRight,
  Upload,
  AlertCircle,
  Keyboard
} from 'lucide-react';
import { CharacterInspectionProps } from '../../lib/characterPreview/characterPreviewTypes';
import CharacterLineList from './CharacterLineList';
import CharacterSnapshotViewer from './CharacterSnapshotViewer';
import CharacterVoicePlayer from './CharacterVoicePlayer';
import LineReassignControl from './LineReassignControl';
import CharacterAvatarCropModal from './CharacterAvatarCropModal';
import { toast } from 'sonner';
import { useCharacterVoiceInspectorController } from './useCharacterVoiceInspectorController';

export { useCharacterVoiceInspectorController };

export default function CharacterVoiceInspectorModal(props: CharacterInspectionProps) {
  const {
    isOpen,
    onClose,
    characterName,
    participants,
    assignments,
    globalMapping,
    characterAliases = {},
    onAssignDubber,
    onToggleMainRole,
    onNavigateCharacter,
    characterList = [],
    currentIndex = 0,
    totalCharacters = 0
  } = props;

  const {
    lines,
    selectedLineIndex,
    videoSrc,
    snapshotUrl,
    isLoadingFrame,
    currentTimeSec,
    playbackProgressSec,
    isPlaying,
    activeLinePlayingIndex,
    isReassigning,
    isCropModalOpen,
    setIsCropModalOpen,
    showHotkeysHelp,
    setShowHotkeysHelp,
    settings,
    setSettings,
    videoRef,
    mainCharacterName,
    currentDubberId,
    isMain,
    portraitUrl,
    currentLine,
    stopPlayback,
    playSnippet,
    handleTogglePlay,
    handleReplay,
    handleSelectLine,
    handleScrubTime,
    handlePrevLine,
    handleNextLine,
    handleSetPortrait,
    handleManualVideoSelect,
    handleReassignLine,
    handleReassignLineFromList
  } = useCharacterVoiceInspectorController(props);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      {/* Hidden Video Engine for Frame Grabbing & Audio Snippets */}
      {videoSrc && (
        <video
          ref={videoRef}
          src={videoSrc}
          className="hidden"
          preload="auto"
          crossOrigin="anonymous"
          playsInline
        />
      )}

      {/* Main Modal Card */}
      <div 
        className="w-full max-w-5xl max-h-[94vh] flex flex-col bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden text-neutral-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="p-4 border-b border-neutral-800 bg-neutral-950/80 flex flex-wrap items-center justify-between gap-3 shrink-0">
          {/* Character Info & Navigation */}
          <div className="flex items-center gap-3">
            {/* Avatar */}
            <div className="relative w-11 h-11 rounded-full overflow-hidden bg-neutral-800 border border-neutral-700 shrink-0 flex items-center justify-center">
              {portraitUrl || snapshotUrl ? (
                <img
                  src={portraitUrl || snapshotUrl || undefined}
                  alt={characterName}
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="w-5 h-5 text-neutral-400" />
              )}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">
                  {characterName}
                </h2>
                {characterAliases[characterName] && (
                  <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/30">
                    Алиас для {characterAliases[characterName]}
                  </span>
                )}
                {onToggleMainRole && (
                  <button
                    type="button"
                    onClick={() => onToggleMainRole(characterName, !isMain)}
                    className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors border ${
                      isMain
                        ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                        : 'bg-neutral-800 text-neutral-400 border-neutral-700 hover:text-neutral-200'
                    }`}
                  >
                    {isMain ? '★ Главная роль' : 'Второстепенная'}
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 text-xs text-neutral-400 mt-0.5">
                <span>Реплик в серии: <strong className="text-indigo-400 font-mono">{lines.length}</strong></span>
                {totalCharacters > 0 && (
                  <>
                    <span>•</span>
                    <span>Персонаж {currentIndex + 1} из {totalCharacters}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Quick Dubber Assignment & Actions */}
          <div className="flex items-center gap-2">
            {/* Dubber selector */}
            <div className="flex items-center gap-1.5 bg-neutral-900 border border-neutral-800 rounded-lg px-2.5 py-1 text-xs">
              <span className="text-[11px] text-neutral-400 font-medium">Даббер:</span>
              <select
                value={currentDubberId}
                onChange={(e) => {
                  if (onAssignDubber) {
                    onAssignDubber(characterName, e.target.value);
                    toast.success('Даббер назначен');
                  }
                }}
                className="bg-transparent text-neutral-100 font-semibold focus:outline-none text-xs cursor-pointer"
              >
                <option value="" className="bg-neutral-900 text-neutral-400">
                  -- Не назначен --
                </option>
                {participants.map((p) => (
                  <option key={p.id} value={p.id} className="bg-neutral-900 text-neutral-200">
                    {p.nickname}
                  </option>
                ))}
              </select>
            </div>

            {/* Character navigation buttons */}
            {onNavigateCharacter && totalCharacters > 1 && (
              <div className="flex items-center gap-1 bg-neutral-900 border border-neutral-800 rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => onNavigateCharacter('prev')}
                  title="Предыдущий персонаж"
                  className="p-1.5 hover:bg-neutral-800 text-neutral-300 rounded transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onNavigateCharacter('next')}
                  title="Следующий персонаж"
                  className="p-1.5 hover:bg-neutral-800 text-neutral-300 rounded transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Keyboard Shortcuts button */}
            <button
              type="button"
              onClick={() => setShowHotkeysHelp(prev => !prev)}
              title="Быстрая разметка: Горячие клавиши (?)"
              className={`p-2 rounded-lg transition-colors flex items-center gap-1 text-xs font-medium border ${
                showHotkeysHelp
                  ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                  : 'bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border-neutral-800 hover:border-neutral-700'
              }`}
            >
              <Keyboard className="w-4 h-4 text-amber-400" />
              <span className="hidden sm:inline">Горячие клавиши</span>
            </button>

            {/* Close button */}
            <button
              type="button"
              onClick={() => {
                stopPlayback();
                onClose();
              }}
              title="Закрыть (Esc)"
              className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Hotkeys Quick Helper Overlay Banner */}
        {showHotkeysHelp && (
          <div className="bg-indigo-950/90 border-b border-indigo-800/80 px-4 py-3 text-xs text-indigo-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-inner">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex items-center gap-1.5 font-semibold text-white">
                <Keyboard className="w-4 h-4 text-amber-300" />
                <span>Быстрая разметка реплик:</span>
              </div>
              <div className="flex items-center gap-1.5 text-neutral-300">
                <kbd className="px-1.5 py-0.5 bg-neutral-900 rounded border border-neutral-700 font-mono text-[10px] text-amber-300">Пробел</kbd>
                <span>Слушать/Пауза</span>
              </div>
              <div className="flex items-center gap-1.5 text-neutral-300">
                <kbd className="px-1.5 py-0.5 bg-neutral-900 rounded border border-neutral-700 font-mono text-[10px] text-amber-300">← / →</kbd>
                <span>Пред / След фраза</span>
              </div>
              <div className="flex items-center gap-1.5 text-neutral-300">
                <kbd className="px-1.5 py-0.5 bg-neutral-900 rounded border border-neutral-700 font-mono text-[10px] text-amber-300">R</kbd>
                <span>Повтор фразы</span>
              </div>
              <div className="flex items-center gap-1.5 text-neutral-300">
                <kbd className="px-1.5 py-0.5 bg-neutral-900 rounded border border-neutral-700 font-mono text-[10px] text-amber-300">S</kbd>
                <span>Кадр в аватарку</span>
              </div>
              <div className="flex items-center gap-1.5 text-neutral-300">
                <kbd className="px-1.5 py-0.5 bg-neutral-900 rounded border border-neutral-700 font-mono text-[10px] text-amber-300">1 - 9</kbd>
                <span>Передать реплику персонажу 1..9</span>
              </div>
              <div className="flex items-center gap-1.5 text-neutral-300">
                <kbd className="px-1.5 py-0.5 bg-neutral-900 rounded border border-neutral-700 font-mono text-[10px] text-amber-300">M / Ж</kbd>
                <span>Пол персонажа (М) / (Ж)</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowHotkeysHelp(false)}
              className="text-indigo-300 hover:text-white text-xs underline shrink-0"
            >
              Скрыть
            </button>
          </div>
        )}

        {/* Video warning / Fallback notice if video not attached */}
        {!videoSrc && (
          <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center justify-between text-xs text-amber-300">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Видеофайл серии (rawPath) не подключен. Вы можете вручную выбрать видео для предпросмотра:</span>
            </div>
            <label className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded cursor-pointer transition-colors font-medium flex items-center gap-1.5 shrink-0">
              <Upload className="w-3.5 h-3.5" />
              <span>Выбрать видео</span>
              <input
                type="file"
                accept="video/*"
                onChange={handleManualVideoSelect}
                className="hidden"
              />
            </label>
          </div>
        )}

        {/* Content Body: Left Column (Snapshot & Voice Player) | Right Column (Lines List) */}
        <div className="flex-1 overflow-hidden p-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left Column: Visual & Auditory Preview */}
          <div className="lg:col-span-7 flex flex-col gap-3 overflow-y-auto">
            <CharacterSnapshotViewer
              currentLine={currentLine}
              snapshotUrl={snapshotUrl}
              isLoadingFrame={isLoadingFrame}
              onScrubTime={handleScrubTime}
              currentTimeSec={currentTimeSec}
              onPrevLine={handlePrevLine}
              onNextLine={handleNextLine}
              hasPrevLine={selectedLineIndex > 0}
              hasNextLine={selectedLineIndex < lines.length - 1}
              onSetAsPortrait={handleSetPortrait}
            />

            <CharacterVoicePlayer
              isPlaying={isPlaying}
              onTogglePlay={handleTogglePlay}
              onReplay={handleReplay}
              currentLine={currentLine}
              playbackProgressSec={playbackProgressSec}
              settings={settings}
              onUpdateSettings={(newVals) => setSettings((prev) => ({ ...prev, ...newVals }))}
            />

            <LineReassignControl
              currentLine={currentLine}
              currentCharacterName={characterName}
              knownCharacters={characterList}
              assignments={assignments}
              participants={participants}
              globalMapping={globalMapping}
              onReassign={handleReassignLine}
              isReassigning={isReassigning}
            />
          </div>

          {/* Right Column: Dialogue Lines List */}
          <div className="lg:col-span-5 flex flex-col h-full overflow-hidden">
            <CharacterLineList
              lines={lines}
              selectedLineIndex={selectedLineIndex}
              onSelectLine={handleSelectLine}
              isPlaying={isPlaying}
              activeLinePlayingIndex={activeLinePlayingIndex}
              onPlayLine={(idx) => {
                const l = lines[idx];
                if (l) playSnippet(l, idx);
              }}
              knownCharacters={characterList}
              currentCharacterName={characterName}
              isReassigning={isReassigning}
              onReassignLine={handleReassignLineFromList}
            />
          </div>
        </div>

        {/* Footer Hint Bar */}
        <div className="px-4 py-2 border-t border-neutral-800 bg-neutral-950 text-[11px] text-neutral-500 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span>Клавиши: <kbd className="bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-300 font-mono">Пробел</kbd> — Слушать речь</span>
            <span><kbd className="bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-300 font-mono">← / →</kbd> — Реплики</span>
            <span><kbd className="bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-300 font-mono">S</kbd> — Выбрать область в аватарку</span>
            <span><kbd className="bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-300 font-mono">Esc</kbd> — Закрыть</span>
          </div>
          <div className="text-neutral-400">
            Кадры и звук синхронизированы по таймингам субтитров
          </div>
        </div>
      </div>

      {/* Avatar Region Crop Modal */}
      {isCropModalOpen && snapshotUrl && (
        <CharacterAvatarCropModal
          isOpen={isCropModalOpen}
          onClose={() => setIsCropModalOpen(false)}
          imageUrl={snapshotUrl}
          characterName={mainCharacterName}
          onConfirm={(croppedUrl) => {
            handleSetPortrait(croppedUrl);
          }}
        />
      )}
    </div>
  );
}
