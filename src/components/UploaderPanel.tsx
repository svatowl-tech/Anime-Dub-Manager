import React, { useState } from 'react';
import { UploaderPanelProps, UploaderLayoutMode } from './uploader/types';
import { useUploaderState } from './uploader/useUploaderState';
import { UploaderHeader } from './uploader/UploaderHeader';
import { ReleaseFilesSection } from './uploader/ReleaseFilesSection';
import { PostGeneratorSection } from './uploader/PostGeneratorSection';
import { ReleaseLinksSection } from './uploader/ReleaseLinksSection';
import { QuickCopyFieldsSection } from './uploader/QuickCopyFieldsSection';
import { PublishChecklistSection } from './uploader/PublishChecklistSection';
import { PlatformNotesSection } from './uploader/PlatformNotesSection';
import { EmbeddedBrowser } from './uploader/EmbeddedBrowser';

// Modals
import { TemplateEditorModal } from './uploader/modals/TemplateEditorModal';
import { BookmarksManagerModal } from './uploader/modals/BookmarksManagerModal';
import { ChecklistManagerModal } from './uploader/modals/ChecklistManagerModal';
import { CustomFieldsModal } from './uploader/modals/CustomFieldsModal';
import { TelegramClientPanel } from './TelegramClientPanel';

export default function UploaderPanel({ currentEpisode, onRefresh, onNavigate }: UploaderPanelProps) {
  const [layoutMode, setLayoutMode] = useState<UploaderLayoutMode>('split');

  // Modal States
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [isBookmarksModalOpen, setIsBookmarksModalOpen] = useState(false);
  const [isChecklistModalOpen, setIsChecklistModalOpen] = useState(false);
  const [isFieldsModalOpen, setIsFieldsModalOpen] = useState(false);
  const [isTelegramModalOpen, setIsTelegramModalOpen] = useState(false);

  // Custom Uploader State Hook
  const {
    allProjects,
    loadProjects,
    activeUrl,
    setActiveUrl,
    copiedField,
    copyToClipboard,
    handleShowInFolder,

    // Bookmarks
    bookmarks,
    bmFormName,
    setBmFormName,
    bmFormUrl,
    setBmFormUrl,
    handleSelectBookmark,
    handleAddBookmark,
    handleDeleteBookmark,
    handleResetBookmarks,

    // Checklist
    checklistDefs,
    checklist,
    newChecklistLabel,
    setNewChecklistLabel,
    newChecklistUrl,
    setNewChecklistUrl,
    toggleChecklistItem,
    handleAddChecklistItem,
    handleDeleteChecklistItem,
    handleSyncChecklistWithQuickLinks,
    handleResetChecklistDefs,

    // Post Generator
    templateType,
    generatedPost,
    setGeneratedPost,
    buildPostText,

    // Platform Links
    projectLinks,
    setProjectLinks,
    quickLinks,
    setQuickLinks,
    isEditingQuickLinks,
    setIsEditingQuickLinks,
    tgPostLink,
    setTgPostLink,
    vkPostLink,
    setVkPostLink,
    isSavingLinks,
    handleSavePlatformLinks,
    handleSelectQuickLink,

    // Custom Fields
    customFields,
    newFieldLabel,
    setNewFieldLabel,
    newFieldValue,
    setNewFieldValue,
    handleAddCustomField,
    handleDeleteCustomField,

    // Notes
    platformNotes,
    setPlatformNotes
  } = useUploaderState(currentEpisode, onRefresh);

  return (
    <div className="flex flex-col h-full bg-neutral-950 text-neutral-100 overflow-hidden relative">
      {/* Header Bar */}
      <UploaderHeader
        currentEpisode={currentEpisode}
        layoutMode={layoutMode}
        setLayoutMode={setLayoutMode}
        onNavigate={onNavigate}
      />

      {/* Main Body Area */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left Side: Release Details & Post Generator Panel */}
        {(layoutMode === 'split' || layoutMode === 'generator') && (
          <aside 
            className={`
              ${layoutMode === 'generator' ? 'w-full' : 'w-full md:w-[420px] lg:w-[480px] shrink-0'} 
              border-r border-neutral-800 bg-neutral-900/60 flex flex-col overflow-y-auto space-y-4 p-4 min-h-0
            `}
          >
            {/* Section 1: Quick Release Files */}
            <ReleaseFilesSection
              currentEpisode={currentEpisode}
              copyToClipboard={copyToClipboard}
              handleShowInFolder={handleShowInFolder}
            />

            {/* Section 2: Post Generator & Templates */}
            <PostGeneratorSection
              currentEpisode={currentEpisode}
              templateType={templateType}
              generatedPost={generatedPost}
              setGeneratedPost={setGeneratedPost}
              copiedField={copiedField}
              buildPostText={buildPostText}
              copyToClipboard={copyToClipboard}
              openTemplateModal={() => setIsTemplateModalOpen(true)}
            />

            {/* Section 3: Links & Post Links DB */}
            <ReleaseLinksSection
              currentEpisode={currentEpisode}
              projectLinks={projectLinks}
              setProjectLinks={setProjectLinks}
              quickLinks={quickLinks}
              setQuickLinks={setQuickLinks}
              isEditingQuickLinks={isEditingQuickLinks}
              setIsEditingQuickLinks={setIsEditingQuickLinks}
              tgPostLink={tgPostLink}
              setTgPostLink={setTgPostLink}
              vkPostLink={vkPostLink}
              setVkPostLink={setVkPostLink}
              isSavingLinks={isSavingLinks}
              handleSavePlatformLinks={handleSavePlatformLinks}
              handleSelectQuickLink={handleSelectQuickLink}
            />

            {/* Section 4: Quick Copy Fields */}
            <QuickCopyFieldsSection
              currentEpisode={currentEpisode}
              customFields={customFields}
              copyToClipboard={copyToClipboard}
              onOpenFieldsModal={() => setIsFieldsModalOpen(true)}
            />

            {/* Section 5: Publishing Checklist */}
            <PublishChecklistSection
              checklistDefs={checklistDefs}
              checklist={checklist}
              toggleChecklistItem={toggleChecklistItem}
              handleSyncChecklistWithQuickLinks={handleSyncChecklistWithQuickLinks}
              onOpenChecklistModal={() => setIsChecklistModalOpen(true)}
              onSelectUrl={(url, label) => handleSelectBookmark({ id: `cl_${label}`, name: label, url })}
            />

            {/* Section 6: Platform Notes */}
            <PlatformNotesSection
              platformNotes={platformNotes}
              setPlatformNotes={setPlatformNotes}
            />
          </aside>
        )}

        {/* Right Side: Embedded Browser */}
        {(layoutMode === 'split' || layoutMode === 'browser') && (
          <div className="flex-1 h-full min-w-0 min-h-0 flex flex-col overflow-hidden">
            <EmbeddedBrowser
              activeUrl={activeUrl}
              onNavigateUrl={setActiveUrl}
              bookmarks={bookmarks}
              onSelectBookmark={handleSelectBookmark}
              onOpenBookmarksModal={() => setIsBookmarksModalOpen(true)}
              onOpenTelegramModal={() => setIsTelegramModalOpen(true)}
              currentEpisode={currentEpisode}
              generatedPost={generatedPost}
              templateType={templateType}
              onBuildPostText={buildPostText}
              customFields={customFields}
              projectLinks={projectLinks}
            />
          </div>
        )}
      </div>

      {/* Modals */}
      {isTemplateModalOpen && (
        <TemplateEditorModal
          currentEpisode={currentEpisode}
          onClose={() => setIsTemplateModalOpen(false)}
          onSaved={(type) => {
            buildPostText(type);
            onRefresh?.();
          }}
        />
      )}

      {isBookmarksModalOpen && (
        <BookmarksManagerModal
          bookmarks={bookmarks}
          bmFormName={bmFormName}
          setBmFormName={setBmFormName}
          bmFormUrl={bmFormUrl}
          setBmFormUrl={setBmFormUrl}
          onAddBookmark={handleAddBookmark}
          onDeleteBookmark={handleDeleteBookmark}
          onResetBookmarks={handleResetBookmarks}
          onClose={() => setIsBookmarksModalOpen(false)}
        />
      )}

      {isChecklistModalOpen && (
        <ChecklistManagerModal
          checklistDefs={checklistDefs}
          quickLinks={quickLinks}
          newChecklistLabel={newChecklistLabel}
          setNewChecklistLabel={setNewChecklistLabel}
          newChecklistUrl={newChecklistUrl}
          setNewChecklistUrl={setNewChecklistUrl}
          onAddChecklistItem={handleAddChecklistItem}
          onDeleteChecklistItem={handleDeleteChecklistItem}
          onSyncWithQuickLinks={handleSyncChecklistWithQuickLinks}
          onResetChecklistDefs={handleResetChecklistDefs}
          onClose={() => setIsChecklistModalOpen(false)}
        />
      )}

      {isFieldsModalOpen && (
        <CustomFieldsModal
          customFields={customFields}
          newFieldLabel={newFieldLabel}
          setNewFieldLabel={setNewFieldLabel}
          newFieldValue={newFieldValue}
          setNewFieldValue={setNewFieldValue}
          onAddField={handleAddCustomField}
          onDeleteField={handleDeleteCustomField}
          onClose={() => setIsFieldsModalOpen(false)}
        />
      )}

      {isTelegramModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4 overflow-hidden">
          <div className="w-full max-w-6xl max-h-[92vh] h-full flex flex-col my-auto min-h-0">
            <TelegramClientPanel
              currentEpisode={currentEpisode}
              currentProject={currentEpisode?.project}
              allProjects={allProjects}
              onRefreshProjects={() => {
                loadProjects();
                onRefresh?.();
              }}
              onClose={() => setIsTelegramModalOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
