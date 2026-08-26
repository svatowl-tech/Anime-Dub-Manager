import { useState, useEffect, useMemo, useRef } from 'react';
import { Episode, RoleAssignment, Participant } from '../types';
import { getParticipants } from '../services/dbService';

export const useAssEditorState = (currentEpisode: Episode | null) => {
  const [assignments, setAssignments] = useState<RoleAssignment[]>([]);
  const [actors, setActors] = useState<string[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [activeTab, setActiveTab] = useState<"roles" | "raw" | "translate">("roles");
  const [status, setStatus] = useState("");
  const [checkAll, setCheckAll] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [distributeGroups, setDistributeGroups] = useState(false);
  const [distributeMultipleRoles, setDistributeMultipleRoles] = useState(false);
  const [saveSignsInAss, setSaveSignsInAss] = useState(false);
  const [outputFormat, setOutputFormat] = useState<"ass" | "srt">("ass");
  const [isSplitting, setIsSplitting] = useState(false);
  const [isMessageModalOpen, setIsMessageModalOpen] = useState(false);
  const [generatedMessage, setGeneratedMessage] = useState("");
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportRole, setExportRole] = useState<'DABBER' | 'SOUND_ENGINEER'>('DABBER');
  const [isUploading, setIsUploading] = useState(false);
  const [showSigns, setShowSigns] = useState(true);
  const [linkingCharacter, setLinkingCharacter] = useState<string | null>(null);
  const lastAnalyzedEpisodeId = useRef<string | null>(null);

  useEffect(() => {
    getParticipants().then(setParticipants);
  }, []);

  const globalMapping = useMemo(() => {
    try {
      const raw = currentEpisode?.project?.globalMapping || '[]';
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed as {characterName: string, dubberId: string, photoUrl?: string}[]
        : Object.entries(parsed).map(([k, v]) => ({ characterName: k, dubberId: v as string, photoUrl: undefined }));
    } catch (e) {
      return [];
    }
  }, [currentEpisode?.project?.globalMapping]);

  const characterAliases = useMemo(() => {
    try {
      const raw = currentEpisode?.project?.characterAliases || '{}';
      return JSON.parse(raw) as Record<string, string>;
    } catch (e) {
      return {};
    }
  }, [currentEpisode?.project?.characterAliases]);

  const getCharacterPortrait = (name: string) => {
    const mainName = characterAliases[name] || name;
    return globalMapping.find(m => m.characterName === mainName)?.photoUrl;
  };

  return {
    assignments, setAssignments,
    actors, setActors,
    participants,
    activeTab, setActiveTab,
    status, setStatus,
    checkAll, setCheckAll,
    isSaving, setIsSaving,
    isSplitting, setIsSplitting,
    distributeGroups, setDistributeGroups,
    distributeMultipleRoles, setDistributeMultipleRoles,
    saveSignsInAss, setSaveSignsInAss,
    outputFormat, setOutputFormat,
    isMessageModalOpen, setIsMessageModalOpen,
    generatedMessage, setGeneratedMessage,
    isExportModalOpen, setIsExportModalOpen,
    isExporting, setIsExporting,
    exportProgress, setExportProgress,
    exportRole, setExportRole,
    isUploading, setIsUploading,
    showSigns, setShowSigns,
    linkingCharacter, setLinkingCharacter,
    lastAnalyzedEpisodeId,
    globalMapping,
    characterAliases,
    getCharacterPortrait
  };
};
