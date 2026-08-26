import React, { useState, useEffect } from "react";
import {
  Scissors,
  Upload,
  Save,
  User,
  CheckSquare,
  FileText,
  Edit3,
  Download,
  FileUp,
  Languages,
  Trash2,
  Plus,
  MessageSquare,
  Settings2,
  Loader2,
  X,
  FileAudio,
  AlertCircle,
  Mic,
  Video,
  Terminal,
} from "lucide-react";
import TranslatePanel from "../components/TranslatePanel";
import AssOcrPanel from "../components/AssOcrPanel";
import AssWhisperPanel from "../components/AssWhisperPanel";
import AssDiarizationPanel from "../components/AssDiarizationPanel";
import CharacterVoiceInspectorModal from "../components/characterPreview/CharacterVoiceInspectorModal";
import { Participant, Episode, RoleAssignment } from "../types";
import { sanitizeFolderName } from "../lib/pathUtils";
import { getParticipants } from "../services/dbService";
import RawSubtitleEditor from "../components/RawSubtitleEditor";
import { exportMappingToJson, importMappingFromJson } from "../lib/mappingExport";
import { ipcSafe } from "../lib/ipcSafe";
import { latinToCyrillic, polivanovToHepburn } from "../lib/translit";
import { generateStartEpisodeMessage } from "../lib/templates";
import { ExportModal } from '../components/ExportModal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { SIGN_KEYWORDS, GROUP_KEYWORDS } from "../constants";
import { toast } from 'sonner';
import { appLogger } from "../lib/appLogger";
import { useModuleLogs } from "../hooks/useModuleLogs";
import { LogViewerDrawer } from "../components/common/LogViewerDrawer";

interface AssLine {
  id: string;
  actor: string;
  text: string;
  assignedTo?: string;
}

interface AssEditorProps {
  currentEpisode: Episode | null;
  onRefresh: () => void;
}

export default function AssEditor({
  currentEpisode,
  onRefresh,
}: AssEditorProps) {
  const [file, setFile] = useState<File | null>(null);
  const [lines, setLines] = useState<AssLine[]>([]);
  const [actors, setActors] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<RoleAssignment[]>([]);
  const [checkAll, setCheckAll] = useState(true);
  const [status, setStatus] = useState("");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"roles" | "raw" | "translate" | "ocr" | "whisper" | "diarization">("roles");
  const [linkingCharacter, setLinkingCharacter] = useState<string | null>(null);
  const lastAnalyzedEpisodeId = React.useRef<string | null>(null);

  // Splitter state
  const [distributeGroups, setDistributeGroups] = useState(false);
  const [distributeMultipleRoles, setDistributeMultipleRoles] = useState(false);
  const [saveSignsInAss, setSaveSignsInAss] = useState(false);
  const [outputFormat, setOutputFormat] = useState<"ass" | "srt">("ass");
  const [isSplitting, setIsSplitting] = useState(false);
  const [isMessageModalOpen, setIsMessageModalOpen] = useState(false);
  
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    variant?: 'danger' | 'warning' | 'info';
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });
  const [generatedMessage, setGeneratedMessage] = useState("");
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportRole, setExportRole] = useState<'DABBER' | 'SOUND_ENGINEER'>('DABBER');
  const [isUploading, setIsUploading] = useState(false);
  const [showSigns, setShowSigns] = useState(true);
  const [unassignedLinesCount, setUnassignedLinesCount] = useState(0);
  const [inspectingCharacter, setInspectingCharacter] = useState<string | null>(null);
  const [isLogsOpen, setIsLogsOpen] = useState(false);

  const { logs: assLogs, clearLogs: clearAssLogs } = useModuleLogs('ass');
  const assErrorCount = assLogs.filter(l => l.level === 'error').length;

  const globalMapping = React.useMemo(() => {
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

  const characterAliases = React.useMemo(() => {
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

  useEffect(() => {
    const checkUnassigned = async () => {
      if (!currentEpisode?.subPath) {
        setUnassignedLinesCount(0);
        return;
      }
      try {
        const data = await ipcSafe.invoke('get-raw-subtitles', currentEpisode.subPath);
        const lines = data.lines || data;
        const count = lines.filter((l: any) => !l.name || !l.name.trim()).length;
        setUnassignedLinesCount(count);
      } catch (e) {
        console.error("Error checking unassigned lines:", e);
      }
    };
    checkUnassigned();
  }, [currentEpisode, activeTab]);

  useEffect(() => {
    getParticipants().then(setParticipants);
  }, []);

  const saveToDatabase = async (currentAssignments: RoleAssignment[]) => {
    if (!currentEpisode) return;
    
    try {
      const cleanAssignments = currentAssignments.map(a => {
        const { dubber, substitute, ...rest } = a;
        return rest;
      });

      const updatedEpisode = {
        ...currentEpisode,
        assignments: cleanAssignments
      };
      
      await ipcSafe.invoke('save-episode', updatedEpisode);
      
      // Also update global mapping if needed
      if (currentEpisode.projectId && currentEpisode.project) {
        const currentMapping: {characterName: string, dubberId: string, isMain?: boolean}[] = currentAssignments
          .filter(a => a.dubberId)
          .map(a => ({ 
            characterName: a.characterName, 
            dubberId: a.dubberId,
            isMain: a.isMain
          }));
        
        // Merge with existing global mapping
        const existingMappingRaw = currentEpisode.project.globalMapping || '[]';
        const existingMapping: {characterName: string, dubberId: string, isMain?: boolean}[] = Array.isArray(JSON.parse(existingMappingRaw))
          ? JSON.parse(existingMappingRaw)
          : Object.entries(JSON.parse(existingMappingRaw)).map(([k, v]) => ({ characterName: k, dubberId: v as string, isMain: undefined }));

        const mergedMapping = [...existingMapping];
        
        // Group by characterName to process character-by-character
        const currentGrouped: Record<string, typeof currentMapping> = {};
        currentMapping.forEach(m => {
          if (!currentGrouped[m.characterName]) currentGrouped[m.characterName] = [];
          currentGrouped[m.characterName].push(m);
        });

        Object.entries(currentGrouped).forEach(([charName, currentEntries]) => {
          // Find all existing mapping entries for this character
          const existingIndices: number[] = [];
          mergedMapping.forEach((em, idx) => {
            if (em.characterName === charName) {
              existingIndices.push(idx);
            }
          });

          if (existingIndices.length > 0) {
            // We have existing entries. Let's update them 1-to-1 with current entries
            currentEntries.forEach((m, i) => {
              if (i < existingIndices.length) {
                // Update existing entry's dubberId and isMain
                const idx = existingIndices[i];
                mergedMapping[idx].dubberId = m.dubberId;
                mergedMapping[idx].isMain = m.isMain;
              } else {
                // We have more current assignments than existing mappings. Add as new
                mergedMapping.push(m);
              }
            });
          } else {
            // No existing entries at all. Just add all of them
            currentEntries.forEach(m => {
              mergedMapping.push(m);
            });
          }
        });

        const updatedProject = {
          ...currentEpisode.project,
          globalMapping: JSON.stringify(mergedMapping)
        };
        await ipcSafe.invoke('save-project', updatedProject);
      }
      
      onRefresh();
    } catch (error) {
      console.error("Auto-save error:", error);
    }
  };

  const handleAnalyzeExisting = async (currentAssignments: RoleAssignment[] = assignments): Promise<RoleAssignment[]> => {
    if (!currentEpisode?.subPath) return [];
    
    setStatus("Анализ существующих субтитров...");
    try {
      const result = await ipcSafe.invoke('get-raw-subtitles', currentEpisode.subPath);
      
      if (result && result.actors) {
        const aliases: Record<string, string> = JSON.parse(currentEpisode?.project?.characterAliases || '{}');
        const rawActors: string[] = result.actors;
        const lines: any[] = result.lines || [];
        
        // Calculate line counts per main character
        const lineCounts: Record<string, number> = {};
        lines.forEach(line => {
          const nameToUse = line.name || line.style || "Unknown";
          const mainName = aliases[nameToUse] || nameToUse;
          lineCounts[mainName] = (lineCounts[mainName] || 0) + 1;
        });

        // Map to main names and deduplicate, filtering out signs
        const mainActors = Array.from(new Set(rawActors.map(name => {
          const nameToUse = name || "Unknown";
          return aliases[nameToUse] || nameToUse;
        }))).filter(name => !SIGN_KEYWORDS.includes(name as string)) as string[];
        
        setActors(mainActors);

        const globalMappingRaw = currentEpisode?.project?.globalMapping || '[]';
        let globalMapping: {characterName: string, dubberId: string, isMain?: boolean}[] = [];
        try {
          const parsed = JSON.parse(globalMappingRaw);
          if (Array.isArray(parsed)) {
            globalMapping = parsed;
          } else if (parsed && typeof parsed === 'object') {
            globalMapping = Object.entries(parsed).map(([k, v]) => ({ characterName: k, dubberId: v as string, isMain: undefined }));
          }
        } catch (e) {
          console.error("Error parsing global mapping:", e);
        }

        const existingNames = new Set(currentAssignments.map(a => a.characterName));
        const toAdd = mainActors.filter((name: string) => !existingNames.has(name));
        
        const updatedPrev = currentAssignments.map(a => {
          const mapping = globalMapping.find(m => m.characterName === a.characterName && m.dubberId === a.dubberId);
          return {
            ...a,
            lineCount: lineCounts[a.characterName] || 0,
            isMain: mapping?.isMain !== undefined ? mapping.isMain : a.isMain
          };
        });

        let finalAssignments: RoleAssignment[] = [];
        if (toAdd?.length > 0) {
          const newAssignments = toAdd.map((actor: string) => {
            // Priority 1: Global mapping
            const mappingEntry = globalMapping.find(m => m.characterName === actor);
            let dubberId = mappingEntry?.dubberId || "";
            let isMain = mappingEntry?.isMain || false;
            
            // Priority 2: Case-insensitive nickname match if no global mapping
            if (!dubberId) {
              const matchedParticipant = participants.find(
                p => p.nickname.toLowerCase() === actor.toLowerCase()
              );
              if (matchedParticipant) {
                dubberId = matchedParticipant.id;
              }
            }

            const dubber = participants.find(p => p.id === dubberId);
            return {
              id: Math.random().toString(),
              episodeId: currentEpisode.id,
              characterName: actor,
              dubberId: dubberId,
              dubber: dubber,
              status: "PENDING" as const,
              lineCount: lineCounts[actor] || 0,
              isMain: isMain
            };
          });

          finalAssignments = [...updatedPrev, ...newAssignments];
        } else {
          finalAssignments = updatedPrev;
        }

        const finalAssignmentsCleaned = finalAssignments.filter(a => (a.lineCount || 0) > 0);

        setAssignments(finalAssignmentsCleaned);
        saveToDatabase(finalAssignmentsCleaned);

        lastAnalyzedEpisodeId.current = currentEpisode.id;
        setStatus(`Анализ завершен. Найдено ${mainActors?.length || 0} персонажей. Удалено пустых ролей: ${finalAssignments.length - finalAssignmentsCleaned.length}`);
        return finalAssignmentsCleaned;
      }
      return assignments;
    } catch (error) {
      console.error("Parse error:", error);
      setStatus("Ошибка при анализе файла.");
      return assignments;
    }
  };

  // Load existing assignments if currentEpisode changes
  useEffect(() => {
    if (!currentEpisode) return;

    if (Array.isArray(currentEpisode.assignments) && currentEpisode.assignments.length > 0) {
      // Sync with global mapping for unassigned characters
      let globalMapping: {characterName: string, dubberId: string, isMain?: boolean}[] = [];
      try {
        const raw = currentEpisode.project?.globalMapping || '[]';
        const parsed = JSON.parse(raw);
        globalMapping = Array.isArray(parsed)
          ? parsed
          : Object.entries(parsed).map(([k, v]) => ({ characterName: k, dubberId: v as string, isMain: undefined }));
      } catch (e) {
        console.error("Error parsing global mapping:", e);
      }

      const assignedDubbersPerCharacter: Record<string, Set<string>> = {};
      currentEpisode.assignments.forEach(a => {
        if (a.dubberId) {
          if (!assignedDubbersPerCharacter[a.characterName]) {
            assignedDubbersPerCharacter[a.characterName] = new Set();
          }
          assignedDubbersPerCharacter[a.characterName].add(a.dubberId);
        }
      });

      const updatedAssignments = currentEpisode.assignments.map(a => {
        let newA = { ...a };
        
        const mappings = globalMapping.filter(m => m.characterName === newA.characterName && m.dubberId);
        
        if (!newA.dubberId) {
          const assignedSet = assignedDubbersPerCharacter[newA.characterName] || new Set();
          const availableMapping = mappings.find(m => !assignedSet.has(m.dubberId));
          
          if (availableMapping) {
            newA.dubberId = availableMapping.dubberId;
            newA.isMain = availableMapping.isMain !== undefined ? availableMapping.isMain : newA.isMain;
            assignedSet.add(availableMapping.dubberId);
            assignedDubbersPerCharacter[newA.characterName] = assignedSet;
          }
        } else {
          // Even if assigned, sync isMain status from global mapping if available
          const mapping = mappings.find(m => m.dubberId === newA.dubberId);
          if (mapping && mapping.isMain !== undefined) {
            newA.isMain = mapping.isMain;
          }
        }

        if (newA.dubberId && !newA.dubber) {
          newA.dubber = participants.find(p => p.id === newA.dubberId);
        }
        if (newA.substituteId && !newA.substitute) {
          newA.substitute = participants.find(p => p.id === newA.substituteId);
        }

        return newA;
      });

      // Only update state if there are actual changes to avoid loops
      const cleanUpdated = updatedAssignments.map(a => {
        const { dubber, substitute, ...rest } = a;
        return rest;
      });
      const cleanCurrent = currentEpisode.assignments.map(a => {
        const { dubber, substitute, ...rest } = a;
        return rest;
      });

      const hasChanges = JSON.stringify(cleanUpdated) !== JSON.stringify(cleanCurrent);
      
      if (hasChanges) {
        console.log("AssEditor: Auto-saving assignments due to changes", {
          cleanUpdated,
          cleanCurrent
        });
        setAssignments(updatedAssignments);
        setActors(updatedAssignments.map(a => a.characterName));
        saveToDatabase(updatedAssignments);
      } else {
        // Even if no DB changes, we still need to set the state with populated dubbers
        setAssignments(updatedAssignments);
        setActors(Array.isArray(currentEpisode.assignments) ? currentEpisode.assignments.map(a => a.characterName) : []);
      }
      
      lastAnalyzedEpisodeId.current = currentEpisode.id;
      
      // If line counts are missing, trigger analysis
      const hasLineCounts = updatedAssignments.some(a => (a.lineCount || 0) > 0);
      if (!hasLineCounts && currentEpisode.subPath && lastAnalyzedEpisodeId.current !== currentEpisode.id + '_auto') {
        lastAnalyzedEpisodeId.current = currentEpisode.id + '_auto';
        handleAnalyzeExisting(updatedAssignments);
      }
    } else {
      // Only clear if it's a different episode
      if (lastAnalyzedEpisodeId.current !== currentEpisode.id) {
        setAssignments([]);
        setActors([]);
        if (currentEpisode.subPath) {
          lastAnalyzedEpisodeId.current = currentEpisode.id + '_auto';
          handleAnalyzeExisting([]);
        } else {
          lastAnalyzedEpisodeId.current = currentEpisode.id;
        }
      }
    }
  }, [currentEpisode?.id, currentEpisode?.subPath, currentEpisode?.project?.globalMapping, participants.length]);

  const handleTransliterateNames = () => {
    if (assignments.length === 0) return;
    
    const newAssignments = assignments.map(a => ({
      ...a,
      characterName: latinToCyrillic(a.characterName)
    }));
    
    setAssignments(newAssignments);
    saveToDatabase(newAssignments);
    setStatus("Имена персонажей транслитерированы.");
  };

  const handlePolivanovToHepburn = () => {
    if (assignments.length === 0) return;
    
    const newAssignments = assignments.map(a => ({
      ...a,
      characterName: polivanovToHepburn(a.characterName)
    }));
    
    setAssignments(newAssignments);
    saveToDatabase(newAssignments);
    setStatus("Имена персонажей переведены на систему Хэпберна.");
  };

  const handleExportMapping = () => {
    const mapping: Record<string, string> = assignments.reduce((acc, a) => ({ ...acc, [a.characterName]: a.dubberId }), {});
    const json = exportMappingToJson(mapping, participants);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mapping_${currentEpisode?.project?.title || 'project'}_ep${currentEpisode?.number || 0}.json`;
    a.click();
  };

  const handleImportMapping = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const json = event.target?.result as string;
      const newMapping = importMappingFromJson(json, participants);
      
      setAssignments(prev => prev.map(a => ({
        ...a,
        dubberId: newMapping[a.characterName] || a.dubberId
      })));
      setStatus("Распределение ролей импортировано!");
    };
    reader.readAsText(file);
  };

  const handleAssignById = async (assignmentId: string, dubberId: string) => {
    const dubber = participants.find(p => p.id === dubberId);
    const newAssignments = assignments.map(a => a.id === assignmentId ? {...a, dubberId, dubber} : a);
    setAssignments(newAssignments);
    
    // Auto-save
    if (currentEpisode) {
      await saveToDatabase(newAssignments);
    }
  };

  const handleAddDubberToCharacter = async (characterName: string) => {
    const newAssignment: RoleAssignment = {
      id: Math.random().toString(),
      episodeId: currentEpisode!.id,
      characterName,
      dubberId: "",
      status: "PENDING"
    };
    
    // Find the last index of an assignment with this characterName to insert after it
    const lastIdx = [...assignments].reverse().findIndex(a => a.characterName === characterName);
    const actualIdx = lastIdx === -1 ? assignments.length : assignments.length - lastIdx;
    
    const newAssignments = [...assignments];
    newAssignments.splice(actualIdx, 0, newAssignment);
    
    setAssignments(newAssignments);
    
    if (currentEpisode) {
      await saveToDatabase(newAssignments);
    }
  };

  useEffect(() => {
    const removeListener = ipcSafe.on('ffmpeg-progress', (progress: number) => {
      setExportProgress(progress);
    });
    return () => removeListener();
  }, []);

  const handleExport = async (targetDir: string, skipConversion: boolean, smartExport?: boolean, uploadToYandex?: boolean, additionalProcessing?: boolean, currentAssignments?: RoleAssignment[]) => {
    if (!currentEpisode) return;
    
    try {
      const taskType = exportRole === 'DABBER' ? 'export-dabber-files' : 'export-sound-engineer-files';
      const roleName = exportRole === 'DABBER' ? 'Даберам' : 'Звукорежиссеру';
      const newStatus = exportRole === 'DABBER' ? 'RECORDING' : 'SOUND_ENGINEERING';
      
      const assignmentsToUse = currentAssignments || assignments;
      
      const updatedEpisode = {
        ...currentEpisode,
        status: newStatus as any,
        assignments: assignmentsToUse.map(a => {
          const { dubber, substitute, ...rest } = a;
          return rest;
        })
      };

      await ipcSafe.invoke('save-episode', updatedEpisode);
      
      await ipcSafe.invoke('enqueue-ffmpeg-task', {
        type: taskType,
        payload: { 
          episode: updatedEpisode, 
          targetDir, 
          skipConversion, 
          smartExport,
          uploadToYandex,
          additionalProcessing
        },
        metadata: {
          title: `Экспорт ${roleName}: ${currentEpisode.project?.title} - Серия ${currentEpisode.number}`
        }
      });
      
      setIsExportModalOpen(false);
      setStatus(`Задание на экспорт (${roleName}) добавлено в очередь.`);
      onRefresh();
    } catch (error: any) {
      console.error('Enqueue task error:', error);
      setStatus('Ошибка при постановке в очередь: ' + error.message);
    }
  };

  const handleRemoveAssignment = async (assignmentId: string, characterName: string) => {
    const charAssignments = assignments.filter(a => a.characterName === characterName);
    let newAssignments;
    // Always remove if there are multiple dubbers for same character
    // Or if it's the only one, we can also remove it if it has 0 lines or if forced
    if (charAssignments.length > 1) {
      newAssignments = assignments.filter(a => a.id !== assignmentId);
    } else {
      // If it's the last one, we might want to just clear it instead of removing?
      // User says "deletion doesn't work", so let's allow total removal.
      newAssignments = assignments.filter(a => a.id !== assignmentId);
    }
    setAssignments(newAssignments);
    setActors(newAssignments.map(a => a.characterName));
    
    if (currentEpisode) {
      await saveToDatabase(newAssignments);
    }
  };

  interface RawSubtitleLine {
    id: number;
    start: string;
    end: string;
    style: string;
    name: string;
    text: string;
    rawLineIndex: number;
  }

  const handleSetSubstitute = async (assignmentId: string, substituteId: string) => {
    const newAssignments = assignments.map(a => a.id === assignmentId ? {...a, substituteId} : a);
    setAssignments(newAssignments);
    
    // Auto-save
    if (currentEpisode) {
      await saveToDatabase(newAssignments);
    }
  };

  const checkConsecutiveDubberLines = async (currentAssignments: RoleAssignment[]) => {
    if (!currentEpisode?.subPath) return;

    try {
      const data = await ipcSafe.invoke('get-raw-subtitles', currentEpisode.subPath);
      const lines: RawSubtitleLine[] = data.lines || data;
      
      const warnings: string[] = [];
      
      for (let i = 0; i < lines.length - 1; i++) {
        const line1 = lines[i];
        const line2 = lines[i + 1];
        
        if (!line1.name || !line2.name || line1.name === line2.name) continue;
        
        const assignment1 = currentAssignments.find(a => a.characterName === line1.name);
        const assignment2 = currentAssignments.find(a => a.characterName === line2.name);
        
        if (assignment1 && assignment2 && assignment1.dubberId && assignment2.dubberId && assignment1.dubberId === assignment2.dubberId) {
          warnings.push(`Дабер ${assignment1.dubber?.nickname || assignment1.dubberId} озвучивает подряд персонажей ${line1.name} и ${line2.name} (строки ${line1.rawLineIndex} и ${line2.rawLineIndex})`);
        }
      }
      
      if (warnings.length > 0) {
        setStatus(`Внимание: ${warnings.length} случаев подряд озвучки одним дабером!`);
      } else {
        setStatus("Распределение ролей корректно.");
      }
    } catch (error) {
      console.error("Error checking consecutive lines:", error);
    }
  };



  useEffect(() => {
    if (assignments.length > 0) {
      checkConsecutiveDubberLines(assignments);
    }
  }, [assignments]);

  const handleLinkAsAlias = async (aliasName: string, mainName: string) => {
    if (!currentEpisode || !currentEpisode.project) return;
    if (aliasName === mainName) return;

    setConfirmState({
      isOpen: true,
      title: 'Связывание алиаса',
      message: `Связать "${aliasName}" как алиас для "${mainName}"? Все реплики "${aliasName}" будут переназначены на "${mainName}".`,
      onConfirm: async () => {
        try {
          // 1. Update project aliases
          const currentAliases: Record<string, string> = JSON.parse(currentEpisode.project!.characterAliases || '{}');
          currentAliases[aliasName] = mainName;
          
          // 2. Find dubber from global mapping for the main character
          let globalMapping: {characterName: string, dubberId: string}[] = [];
          try {
            const raw = currentEpisode.project?.globalMapping || '[]';
            const parsed = JSON.parse(raw);
            globalMapping = Array.isArray(parsed)
              ? parsed
              : Object.entries(parsed).map(([k, v]) => ({ characterName: k, dubberId: v as string }));
          } catch (e) {
            console.error("Error parsing global mapping:", e);
          }
          
          const mappingEntries = globalMapping.filter(m => m.characterName === mainName && m.dubberId);

          const updatedProject = {
            ...currentEpisode.project!,
            characterAliases: JSON.stringify(currentAliases)
          };
          await ipcSafe.invoke('save-project', updatedProject);

          // 3. Merge assignments in current episode
          const aliasAssignments = assignments.filter(a => a.characterName === aliasName);
          let updatedAssignments = assignments.filter(a => a.characterName !== aliasName);
          
          // Transfer dubber assignments from alias to main if they exist
          aliasAssignments.forEach(aa => {
            const dubberIdToUse = aa.dubberId;
            const dubberToUse = aa.dubber;
            
            const alreadyHasThisDubber = updatedAssignments.some(a => a.characterName === mainName && a.dubberId === dubberIdToUse);
            
            if (!alreadyHasThisDubber && dubberIdToUse) {
               updatedAssignments.push({
                 ...aa,
                 characterName: mainName,
                 dubberId: dubberIdToUse,
                 dubber: dubberToUse,
                 id: Math.random().toString(36).substring(2, 11)
               });
            }
          });

          // Also ensure all dubbers from global mapping for the main character are present
          mappingEntries.forEach(me => {
            const alreadyHasThisDubber = updatedAssignments.some(a => a.characterName === mainName && a.dubberId === me.dubberId);
            if (!alreadyHasThisDubber) {
              updatedAssignments.push({
                id: Math.random().toString(36).substring(2, 11),
                episodeId: currentEpisode.id,
                characterName: mainName,
                dubberId: me.dubberId,
                dubber: participants.find(p => p.id === me.dubberId),
                status: 'PENDING',
                lineCount: 0
              });
            }
          });

          // If main character still has no assignments, create one empty
          if (updatedAssignments.filter(a => a.characterName === mainName).length === 0) {
            updatedAssignments.push({
              id: Math.random().toString(36).substring(2, 11),
              episodeId: currentEpisode.id,
              characterName: mainName,
              dubberId: "",
              status: "PENDING"
            });
          }

          // Rename speaker names in actual .ass file if it exists
          if (currentEpisode.subPath) {
            try {
              const data = await ipcSafe.invoke('get-raw-subtitles', currentEpisode.subPath);
              if (data && data.lines) {
                const updatedLines = data.lines.map((l: any) => {
                  if (l.name === aliasName) {
                    return { ...l, name: mainName };
                  }
                  return l;
                });
                await ipcSafe.invoke('save-translated-subtitles', {
                  assFilePath: currentEpisode.subPath,
                  translatedLines: updatedLines
                });
              }
            } catch (err) {
              console.error("Error updating .ass file with new alias:", err);
            }
          }

          setAssignments(updatedAssignments);
          await saveToDatabase(updatedAssignments);
          
          // 4. Update actors list
          setActors(prev => prev.filter(a => a !== aliasName));
          
          setLinkingCharacter(null);
          toast.success(`Персонаж "${aliasName}" успешно связан с "${mainName}".`);
          onRefresh();
        } catch (error) {
          console.error("Link alias error:", error);
          toast.error("Ошибка при связывании алиаса.");
        }
      }
    });
  };

  const handleClearAssignments = async () => {
    setConfirmState({
      isOpen: true,
      title: 'Очистка распределений',
      message: 'Вы уверены, что хотите очистить ВСЕ распределения ролей для этого эпизода?',
      variant: 'danger',
      onConfirm: async () => {
        setAssignments([]);
        setActors([]);
        if (currentEpisode) {
          await saveToDatabase([]);
        }
        toast.success("Все распределения ролей очищены.");
      }
    });
  };

  const handleStartRecording = async () => {
    if (!currentEpisode) return;

    setIsSaving(true);
    setStatus("Перевод эпизода в статус 'ЗАПИСЬ'...");

    try {
      const updatedEpisode = {
        ...currentEpisode,
        status: "RECORDING" as const
      };
      await ipcSafe.invoke('save-episode', updatedEpisode);
      setStatus("Статус обновлен! Теперь можно приступать к записи.");
      onRefresh();
    } catch (error) {
      console.error("Status update error:", error);
      setStatus("Ошибка при обновлении статуса.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSplitAss = async () => {
    if (!currentEpisode || !currentEpisode.subPath) return;
    setIsSplitting(true);
    setStatus("Генерация разделенных файлов...");

    try {
      const projectTitle = sanitizeFolderName(currentEpisode.project?.title || "Project");
      const episodeFolder = sanitizeFolderName(`Episode_${currentEpisode.number || "0"}`);
      const subDir = `${projectTitle}/${episodeFolder}/Subtitles/output_dubbers`;
      
      const config = await ipcSafe.invoke('get-config');
      const baseDir = config.baseDir || '';
      const outputDirectory = `${baseDir}/${subDir}`;

      const options = {
        distributeGroups,
        distributeMultipleRoles,
        saveSignsInAss,
        outputFormat
      };

      const data = await ipcSafe.invoke('split-subs-by-dubber', {
        assFilePath: currentEpisode.subPath,
        outputDirectory,
        assignments,
        options
      });

      if (data && data.generatedFiles) {
        setStatus(
          `Файлы успешно разделены и сохранены в папке output_dubbers! Сгенерировано файлов: ${data.generatedFiles.length}`,
        );
      } else {
        setStatus("Ошибка при разделении файлов: Не удалось получить список сгенерированных файлов.");
      }
    } catch (error: any) {
      console.error("Split error:", error);
      setStatus("Ошибка при разделении файлов: " + (error.message || String(error)));
    } finally {
      setIsSplitting(false);
    }
  };

  const handleGenerateStartMessage = async () => {
    if (!currentEpisode) return;
    
    let currentAssignments = assignments;
    // Refresh line counts before generating if they are all zero
    const hasLineCounts = assignments.some(a => (a.lineCount || 0) > 0);
    if (!hasLineCounts && currentEpisode.subPath) {
      currentAssignments = await handleAnalyzeExisting();
    }
    
    const msg = generateStartEpisodeMessage({ ...currentEpisode, assignments: currentAssignments }, participants);
    setGeneratedMessage(msg);
    setIsMessageModalOpen(true);
  };

  const [showConsecutiveWarnings, setShowConsecutiveWarnings] = useState(false);
  const [consecutiveWarnings, setConsecutiveWarnings] = useState<any[]>([]);

  const parseAssTime = (timeStr: string) => {
    const parts = timeStr.split(':');
    if (parts.length === 3) {
      const hours = parseInt(parts[0], 10);
      const minutes = parseInt(parts[1], 10);
      const seconds = parseFloat(parts[2]);
      return (hours * 3600) + (minutes * 60) + seconds;
    }
    return 0;
  };

  const handleCheckConsecutiveLines = async () => {
    if (!currentEpisode?.subPath) return;
    setStatus("Проверка на склейки...");
    try {
      const result = await ipcSafe.invoke('get-raw-subtitles', currentEpisode.subPath);
      if (!result || !result.lines) {
        setStatus("Ошибка при чтении субтитров.");
        return;
      }

      const aliases: Record<string, string> = JSON.parse(currentEpisode?.project?.characterAliases || '{}');
      
      const linesWithDubbers = result.lines.map((line: any) => {
        const charName = aliases[line.name] || line.name;
        const assignment = assignments.find(a => a.characterName === charName);
        const dubberId = assignment?.substituteId || assignment?.dubberId;
        const dubber = participants.find(p => p.id === dubberId);
        return {
          ...line,
          mainCharacter: charName,
          dubberId: dubberId,
          dubberName: dubber?.nickname || "Неизвестно",
          startTime: parseAssTime(line.start),
          endTime: parseAssTime(line.end)
        };
      }).filter((l: any) => l.dubberId && l.mainCharacter);

      linesWithDubbers.sort((a: any, b: any) => a.startTime - b.startTime);

      const warnings: any[] = [];
      const dubberLines: Record<string, any[]> = {};
      linesWithDubbers.forEach((l: any) => {
        if (!dubberLines[l.dubberId]) dubberLines[l.dubberId] = [];
        dubberLines[l.dubberId].push(l);
      });

      for (const dubberId in dubberLines) {
        const dLines = dubberLines[dubberId];
        for (let i = 0; i < dLines.length - 1; i++) {
          const current = dLines[i];
          const next = dLines[i+1];
          
          if (current.mainCharacter !== next.mainCharacter) {
            const gap = next.startTime - current.endTime;
            if (gap < 2) {
              warnings.push({
                dubberName: current.dubberName,
                char1: current.mainCharacter,
                char2: next.mainCharacter,
                time1: current.start,
                end1: current.end,
                time2: next.start,
                end2: next.end,
                text1: current.text,
                text2: next.text,
                gap: gap
              });
            }
          }
        }
      }

      setConsecutiveWarnings(warnings);
      setShowConsecutiveWarnings(true);
      setStatus(`Проверка завершена. Найдено склеек: ${warnings.length}`);
    } catch (error) {
      console.error(error);
      setStatus("Ошибка при проверке склеек.");
    }
  };

  const handleExportFullAss = async () => {
    if (!currentEpisode || !currentEpisode.subPath) return;
    setStatus("Экспорт полного файла с ролями...");

    try {
      const projectTitle = sanitizeFolderName(currentEpisode.project?.title || "Project");
      const episodeFolder = sanitizeFolderName(`Episode_${currentEpisode.number || "0"}`);
      const subDir = `${projectTitle}/${episodeFolder}/Subtitles`;
      
      const config = await ipcSafe.invoke('get-config');
      const baseDir = config.baseDir || '';
      const outputPath = `${baseDir}/${subDir}/${projectTitle}_Ep${currentEpisode.number}_Full_Roles.ass`;

      const result = await ipcSafe.invoke('export-full-ass-with-roles', {
        assFilePath: currentEpisode.subPath,
        outputPath,
        assignments
      });

      if (result && result.path) {
        setStatus(`Полный файл успешно экспортирован: ${result.path}`);
      } else {
        setStatus("Ошибка при экспорте полного файла: Не удалось получить путь.");
      }
    } catch (error: any) {
      console.error("Export error:", error);
      setStatus("Ошибка при экспорте полного файла: " + (error.message || String(error)));
    }
  };

  const handleExportCharacterSubtitles = async (characterName: string) => {
    if (!currentEpisode || !currentEpisode.subPath) {
      toast.error("Нет загруженного файла субтитров для этого эпизода.");
      return;
    }

    try {
      const projectTitle = sanitizeFolderName(currentEpisode.project?.title || "Project");
      const defaultName = `${projectTitle}_Ep${currentEpisode.number || "0"}_${characterName}.ass`;
      
      const saveResult = await ipcSafe.invoke('show-save-dialog', {
        title: `Экспорт субтитров персонажа ${characterName}`,
        defaultPath: defaultName,
        filters: [
          { name: 'Advanced SubStation Alpha', extensions: ['ass'] },
          { name: 'SubRip Subtitles', extensions: ['srt'] }
        ]
      });

      if (saveResult.canceled || !saveResult.filePath) {
        return;
      }

      const format = saveResult.filePath.toLowerCase().endsWith('.srt') ? 'srt' : 'ass';
      
      setStatus(`Экспорт субтитров для ${characterName}...`);
      const result = await ipcSafe.invoke('export-character-subtitles', {
        assFilePath: currentEpisode.subPath,
        outputPath: saveResult.filePath,
        characterName,
        characterAliases: currentEpisode.project?.characterAliases || '{}',
        format
      });

      if (result && result.path) {
        toast.success(`Субтитры персонажа ${characterName} успешно сохранены!`);
        setStatus(`Файл сохранен: ${result.path}`);
      } else {
        toast.error("Не удалось экспортировать файл субтитров.");
      }
    } catch (error: any) {
      console.error("Character subtitle export error:", error);
      toast.error(`Ошибка при экспорте: ${error.message || String(error)}`);
      setStatus("Ошибка при экспорте: " + (error.message || String(error)));
    }
  };

  return (
    <div className="w-full h-full flex flex-col space-y-4 overflow-hidden pt-4 px-4 md:px-8 pb-8">
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

        <div className="flex bg-neutral-900 rounded-lg p-1 border border-neutral-800">
          <button
            onClick={() => setActiveTab("raw")}
            title="Переключиться на редактор разметки реплик"
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors relative ${
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
            onClick={() => setActiveTab("roles")}
            title="Переключиться на распределение ролей"
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === "roles"
                ? "bg-neutral-800 text-white shadow-sm"
                : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
            }`}
          >
            <User className="w-4 h-4" />
            Распределение ролей
          </button>
          <button
            onClick={() => setActiveTab("translate")}
            title="Переключиться на панель перевода"
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === "translate"
                ? "bg-neutral-800 text-white shadow-sm"
                : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
            }`}
          >
            <Languages className="w-4 h-4" />
            Перевод
          </button>
          <button
            onClick={() => setActiveTab("ocr")}
            title="Переключиться на распознавание хардсаба"
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === "ocr"
                ? "bg-neutral-800 text-white shadow-sm"
                : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
            }`}
          >
            <FileText className="w-4 h-4" />
            Распознавание хардсаба
          </button>
          <button
            onClick={() => setActiveTab("whisper")}
            title="Переключиться на распознавание речи"
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === "whisper"
                ? "bg-neutral-800 text-white shadow-sm"
                : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
            }`}
          >
            <FileAudio className="w-4 h-4" />
            Распознавание аудио
          </button>
          <button
            onClick={() => setActiveTab("diarization")}
            title="Разделение голосов (Диаризация)"
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1 overflow-y-auto min-h-0 pb-4 pr-2">
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-xl">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Upload className="w-5 h-5 text-indigo-400" />
                Загрузка файла
              </h2>

              {currentEpisode?.subPath && (
                <div className="space-y-3">
                  <button
                    onClick={() => handleAnalyzeExisting()}
                    title="Проанализировать загруженный файл субтитров"
                    className="w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20"
                  >
                    <Scissors className="w-4 h-4" />
                    Анализировать загруженные субтитры
                  </button>
                  
                  {unassignedLinesCount > 0 && (
                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-bold text-red-400">Обнаружены неразмеченные реплики</p>
                        <p className="text-xs text-red-400/70 mt-1">
                          В файле {unassignedLinesCount} реплик с пустым полем персонажа. Перейдите во вкладку "Разметка реплик", чтобы исправить это.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {status && (
                <p className="mt-4 text-sm text-neutral-400">{status}</p>
              )}
            </div>

            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-xl">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Save className="w-5 h-5 text-purple-400" />
                Действия
              </h2>

              <div className="space-y-4">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className="relative flex items-center justify-center w-5 h-5 border border-neutral-600 rounded bg-neutral-950 group-hover:border-indigo-500 transition-colors">
                    <input
                      type="checkbox"
                      className="absolute opacity-0 cursor-pointer"
                      checked={checkAll}
                      onChange={(e) => setCheckAll(e.target.checked)}
                    />
                    {checkAll && (
                      <CheckSquare className="w-5 h-5 text-indigo-500 absolute" />
                    )}
                  </div>
                  <span className="text-sm text-neutral-300 group-hover:text-white transition-colors">
                    Выбрать все (Генерировать для всех)
                  </span>
                </label>

                <button
                  onClick={handleStartRecording}
                  title="Перевести эпизод в статус 'ЗАПИСЬ'"
                  disabled={
                    !currentEpisode ||
                    assignments.length === 0 ||
                    isSaving ||
                    currentEpisode.status === "RECORDING"
                  }
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors shadow-lg shadow-indigo-500/20"
                >
                  {isSaving ? "Обработка..." : currentEpisode?.status === "RECORDING" ? "Уже в записи" : "Начать запись (Статус)"}
                </button>

                <div className="h-px bg-neutral-800 my-2" />

                <button
                  onClick={handleSplitAss}
                  disabled={!currentEpisode?.subPath || assignments.length === 0 || isSplitting}
                  className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2"
                  title="Разделить реплики по даберам"
                >
                  <Scissors className="w-4 h-4" />
                  {isSplitting ? "Разделение..." : "Разделить роли"}
                </button>

                <button
                  onClick={handleGenerateStartMessage}
                  disabled={assignments.length === 0}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2"
                  title="Сгенерировать сообщение для начала работы над серией"
                >
                  <MessageSquare className="w-4 h-4" />
                  Сообщение старт серии
                </button>

                <div className="h-px bg-neutral-800 my-2" />

                <div className="p-4 bg-neutral-950 border border-neutral-800 rounded-lg space-y-3">
                  <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-wider flex items-center gap-2">
                    <Settings2 className="w-3 h-3" />
                    Настройки разделения
                  </h3>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={distributeGroups}
                        onChange={(e) => setDistributeGroups(e.target.checked)}
                        className="w-3.5 h-3.5 bg-neutral-900 border-neutral-700 rounded text-indigo-500 focus:ring-0"
                      />
                      <span className="text-[11px] text-neutral-400 group-hover:text-neutral-200">Распределять 'гуры/все'</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={distributeMultipleRoles}
                        onChange={(e) => setDistributeMultipleRoles(e.target.checked)}
                        className="w-3.5 h-3.5 bg-neutral-900 border-neutral-700 rounded text-indigo-500 focus:ring-0"
                      />
                      <span className="text-[11px] text-neutral-400 group-hover:text-neutral-200">Множественные роли</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={saveSignsInAss}
                        onChange={(e) => setSaveSignsInAss(e.target.checked)}
                        className="w-3.5 h-3.5 bg-neutral-900 border-neutral-700 rounded text-indigo-500 focus:ring-0"
                      />
                      <span className="text-[11px] text-neutral-400 group-hover:text-neutral-200">Сохранять надписи в .ass</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={showSigns}
                        onChange={(e) => setShowSigns(e.target.checked)}
                        className="w-3.5 h-3.5 bg-neutral-900 border-neutral-700 rounded text-indigo-500 focus:ring-0"
                      />
                      <span className="text-[11px] text-neutral-400 group-hover:text-neutral-200">Показывать надписи</span>
                    </label>
                    <div className="flex gap-3 pt-1">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="outputFormat"
                          value="ass"
                          checked={outputFormat === "ass"}
                          onChange={() => setOutputFormat("ass")}
                          className="w-3 h-3 text-indigo-500 bg-neutral-900 border-neutral-700"
                        />
                        <span className="text-[11px] text-white">.ass</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="outputFormat"
                          value="srt"
                          checked={outputFormat === "srt"}
                          onChange={() => setOutputFormat("srt")}
                          className="w-3 h-3 text-indigo-500 bg-neutral-900 border-neutral-700"
                        />
                        <span className="text-[11px] text-white">.srt</span>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handleExportMapping}
                    title="Экспортировать распределение ролей в JSON"
                    className="flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-white px-4 py-2.5 rounded-lg font-medium transition-colors border border-neutral-700"
                  >
                    <Download className="w-4 h-4" />
                    Экспорт
                  </button>
                  <label 
                    title="Импортировать распределение ролей из JSON"
                    className="flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-white px-4 py-2.5 rounded-lg font-medium transition-colors border border-neutral-700 cursor-pointer"
                  >
                    <FileUp className="w-4 h-4" />
                    Импорт
                    <input type="file" accept=".json" className="hidden" onChange={handleImportMapping} />
                  </label>
                </div>

                <button
                  onClick={handleCheckConsecutiveLines}
                  disabled={!currentEpisode?.subPath || assignments.length === 0}
                  className="w-full bg-amber-900/20 hover:bg-amber-900/40 text-amber-400 px-4 py-2.5 rounded-lg font-medium transition-colors border border-amber-900/50 flex items-center justify-center gap-2"
                  title="Проверить, нет ли подряд идущих реплик разных персонажей у одного дабера"
                >
                  <Edit3 className="w-4 h-4" />
                  Проверить склейки
                </button>

                <button
                  onClick={handleExportFullAss}
                  title="Экспортировать полный файл субтитров с ролями"
                  disabled={!currentEpisode?.subPath || assignments.length === 0}
                  className="w-full bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors border border-neutral-700 flex items-center justify-center gap-2"
                >
                  <FileText className="w-4 h-4" />
                  Экспортировать полный ASS
                </button>

                <button
                  onClick={() => { setExportRole('DABBER'); setIsExportModalOpen(true); }}
                  title="Экспортировать файлы для даберов"
                  disabled={!currentEpisode?.subPath || assignments.length === 0}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors border border-indigo-500 flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20"
                >
                  <Download className="w-4 h-4" />
                  Экспорт Даберам
                </button>

                <button
                  onClick={handleClearAssignments}
                  title="Очистить все распределения ролей для этого эпизода"
                  disabled={assignments.length === 0}
                  className="w-full bg-red-900/20 hover:bg-red-900/40 text-red-400 px-4 py-2.5 rounded-lg font-medium transition-colors border border-red-900/50 flex items-center justify-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Очистить все роли
                </button>

                <button
                  onClick={handleTransliterateNames}
                  disabled={assignments.length === 0}
                  className="w-full bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors border border-neutral-700 flex items-center justify-center gap-2"
                  title="Транслитерация имен (Латиница -> Кириллица)"
                >
                  <Languages className="w-4 h-4" />
                  Транслит (Lat &rarr; Cyr)
                </button>

                <button
                  onClick={handlePolivanovToHepburn}
                  disabled={assignments.length === 0}
                  className="w-full bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition-colors border border-neutral-700 flex items-center justify-center gap-2"
                  title="Поливанов -> Хэпберн (Кириллица)"
                >
                  <Languages className="w-4 h-4 text-amber-400" />
                  Поливанов &rarr; Хэпберн
                </button>
              </div>
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl shadow-xl overflow-hidden h-full flex flex-col">
              <div className="p-4 border-b border-neutral-800 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <User className="w-5 h-5 text-indigo-500" />
                  <h3 className="font-bold text-white">Распределение ролей</h3>
                </div>
              </div>

              <div className="p-4 flex-1 overflow-y-auto">
                {assignments.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-neutral-500 space-y-3 py-12">
                    <Scissors className="w-12 h-12 opacity-20" />
                    <p>Загрузите файл для начала работы</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Группировка по даберам */}
                    {Object.entries(
                      assignments
                        .filter(a => {
                          if (showSigns) return true;
                          const name = a.characterName.toLowerCase();
                          const signs = ["sign", "signs", "title", "op", "ed", "song", "note", "music", "logo", "staff", "credit", "credits", "надпись", "титры", "инфо", "info"];
                          return !signs.some(s => {
                            if (s === 'op' || s === 'ed') {
                              const regex = new RegExp(`(^|[^a-z])${s}([^a-z]|$)`, 'i');
                              return regex.test(name);
                            }
                            return name.includes(s);
                          }) && !SIGN_KEYWORDS.some(k => name.includes(k.toLowerCase()));
                        })
                        .reduce((acc: Record<string, RoleAssignment[]>, curr: RoleAssignment) => {
                        const dubberId = curr.dubberId || "unassigned";
                        if (!acc[dubberId]) acc[dubberId] = [];
                        acc[dubberId].push(curr);
                        return acc;
                      }, {} as Record<string, RoleAssignment[]>)
                    ).map(([dubberId, dubberAssignments]: [string, RoleAssignment[]]) => {
                      const dubber = participants.find(p => p.id === dubberId);
                      const totalLines = dubberAssignments.reduce((sum: number, a: RoleAssignment) => sum + (a.lineCount || 0), 0);
                      
                      return (
                        <div key={dubberId} className="bg-neutral-950 border border-neutral-800 rounded-lg overflow-hidden">
                          <div className="bg-neutral-900/50 px-4 py-2 border-b border-neutral-800 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className={`font-semibold ${dubberId === 'unassigned' ? 'text-amber-500' : 'text-indigo-400'}`}>
                                {dubber?.nickname || (dubberId === 'unassigned' ? "Не распределено" : "Неизвестный")}
                              </span>
                              <span className="text-[10px] bg-neutral-800 text-neutral-400 px-2 py-0.5 rounded-full border border-neutral-700">
                                {totalLines} реплик
                              </span>
                            </div>
                          </div>
                          
                          <div className="p-3 space-y-3">
                            {dubberAssignments.map((assignment: RoleAssignment) => (
                              <div key={assignment.id} className="flex flex-col gap-1.5 p-2 bg-neutral-900/30 rounded border border-neutral-800/50">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    {(() => {
                                      const portrait = getCharacterPortrait(assignment.characterName);
                                      return portrait ? (
                                        <div className="relative w-6 h-6 flex-shrink-0">
                                          <img 
                                            src={portrait || undefined} 
                                            alt="" 
                                            className="absolute inset-0 w-6 h-6 rounded-full object-cover border border-neutral-700 z-10"
                                            referrerPolicy="no-referrer"
                                            onError={(e) => {
                                              e.currentTarget.style.display = 'none';
                                              const next = e.currentTarget.nextSibling;
                                              if (next && next instanceof HTMLElement) {
                                                next.classList.remove('hidden');
                                              }
                                            }}
                                          />
                                          <div className="absolute inset-0 w-6 h-6 rounded-full bg-neutral-800 flex items-center justify-center text-[10px] text-neutral-500 border border-neutral-700 hidden">
                                            <User className="w-3 h-3" />
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="w-6 h-6 rounded-full bg-neutral-800 flex items-center justify-center text-[10px] text-neutral-500 border border-neutral-700 flex-shrink-0">
                                          <User className="w-3 h-3" />
                                        </div>
                                      );
                                    })()}
                                    <span className="text-sm text-neutral-200 font-medium">{assignment.characterName}</span>
                                    <span className="text-[10px] text-neutral-500">({assignment.lineCount || 0} реп.)</span>
                                    <button
                                      onClick={() => {
                                        const newAssignments = assignments.map(a => 
                                          a.id === assignment.id ? { ...a, isMain: !a.isMain } : a
                                        );
                                        setAssignments(newAssignments);
                                        saveToDatabase(newAssignments);
                                      }}
                                      className={`text-[10px] px-1.5 py-0.5 rounded transition-colors border ${
                                        assignment.isMain 
                                          ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' 
                                          : 'bg-neutral-800 text-neutral-500 border-neutral-700 hover:text-indigo-400'
                                      }`}
                                    >
                                      {assignment.isMain ? 'Главная' : 'Втор.'}
                                    </button>
                                    <button
                                      onClick={() => setLinkingCharacter(linkingCharacter === assignment.characterName ? null : assignment.characterName)}
                                      className={`text-[10px] px-1 rounded transition-colors ${
                                        linkingCharacter === assignment.characterName 
                                          ? 'bg-amber-500/20 text-amber-400' 
                                          : 'text-neutral-600 hover:text-amber-400'
                                      }`}
                                    >
                                      Связать
                                    </button>
                                    <button
                                      onClick={() => setInspectingCharacter(assignment.characterName)}
                                      title="Посмотреть кадры и прослушать голос персонажа"
                                      className="text-[10px] px-1.5 py-0.5 rounded text-indigo-300 hover:text-indigo-200 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 transition-all flex items-center gap-1"
                                    >
                                      <Video className="w-3 h-3 text-indigo-400" />
                                      <span>Голос и кадр</span>
                                    </button>
                                    <button
                                      onClick={() => handleExportCharacterSubtitles(assignment.characterName)}
                                      title="Экспортировать субтитры этого персонажа"
                                      className="text-[10px] px-1.5 py-0.5 rounded text-neutral-400 hover:text-indigo-400 hover:bg-neutral-800 transition-all flex items-center gap-1 border border-transparent hover:border-neutral-700"
                                    >
                                      <Download className="w-3 h-3" />
                                      Экспорт сабов
                                    </button>
                                  </div>
                                  <button
                                    onClick={() => handleAddDubberToCharacter(assignment.characterName)}
                                    className="text-[10px] text-indigo-500 hover:text-indigo-400 flex items-center gap-0.5"
                                  >
                                    <Plus className="w-2.5 h-2.5" />
                                    Даббер
                                  </button>
                                </div>

                                {linkingCharacter === assignment.characterName && (
                                  <div className="my-2 p-2 bg-neutral-900 border border-amber-500/30 rounded text-[10px]">
                                    <p className="text-amber-400 mb-1">Связать с персонажем проекта:</p>
                                    <div className="flex flex-wrap gap-1 mb-2">
                                      {globalMapping.map(m => (
                                        <button
                                          key={m.characterName}
                                          onClick={() => handleLinkAsAlias(assignment.characterName, m.characterName)}
                                          className="px-1.5 py-0.5 bg-neutral-800 hover:bg-amber-500/20 text-neutral-300 rounded border border-neutral-700 flex items-center gap-1.5"
                                        >
                                          {m.photoUrl ? (
                                            <div className="relative w-4 h-4 shrink-0">
                                              <img 
                                                src={m.photoUrl || undefined} 
                                                alt="" 
                                                className="absolute inset-0 w-4 h-4 rounded-full object-cover border border-neutral-600 z-10"
                                                referrerPolicy="no-referrer"
                                                onError={(e) => {
                                                  e.currentTarget.style.display = 'none';
                                                  const next = e.currentTarget.nextSibling;
                                                  if (next && next instanceof HTMLElement) {
                                                    next.classList.remove('hidden');
                                                  }
                                                }}
                                              />
                                              <div className="absolute inset-0 w-4 h-4 rounded-full bg-neutral-700 flex items-center justify-center text-[6px] hidden">
                                                <User className="w-2 h-2" />
                                              </div>
                                            </div>
                                          ) : null}
                                          <span>{m.characterName}</span>
                                          {m.dubberId && <span className="text-[8px] text-indigo-400">({participants.find(p => p.id === m.dubberId)?.nickname})</span>}
                                        </button>
                                      ))}
                                    </div>
                                    
                                    <p className="text-neutral-500 mb-1">Или с другим персонажем из субтитров:</p>
                                    <div className="flex flex-wrap gap-1">
                                      {Array.from(new Set(assignments.map(a => a.characterName)))
                                        .filter(name => name !== assignment.characterName)
                                        .map((name: string) => (
                                          <button
                                            key={name}
                                            onClick={() => handleLinkAsAlias(assignment.characterName, name)}
                                            className="px-1.5 py-0.5 bg-neutral-800 hover:bg-amber-500/20 text-neutral-300 rounded border border-neutral-700"
                                          >
                                            {name}
                                          </button>
                                        ))}
                                    </div>
                                  </div>
                                )}

                                <div className="flex gap-2">
                                  <select
                                    value={assignment.dubberId}
                                    onChange={(e) => handleAssignById(assignment.id, e.target.value)}
                                    className="flex-1 bg-neutral-900 border border-neutral-700 text-white rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
                                  >
                                    <option value="">-- Выберите дабера --</option>
                                    {participants
                                      .filter(user => 
                                        currentEpisode?.project?.assignedDubberIds?.includes(user.id) || 
                                        user.id === assignment.dubberId
                                      )
                                      .map((user) => (
                                        <option key={user.id} value={user.id}>
                                          {user.nickname}
                                        </option>
                                      ))}
                                  </select>
                                  
                                  <select
                                    value={assignment.substituteId || ""}
                                    onChange={(e) => handleSetSubstitute(assignment.id, e.target.value)}
                                    className="w-1/3 bg-neutral-900 border border-neutral-700 text-white rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all"
                                  >
                                    <option value="">-- Замена --</option>
                                    {participants.map((user) => (
                                      <option key={user.id} value={user.id}>
                                        {user.nickname}
                                      </option>
                                    ))}
                                  </select>

                                  <button
                                    onClick={() => handleRemoveAssignment(assignment.id, assignment.characterName)}
                                    className="p-1 text-neutral-500 hover:text-red-400 transition-colors"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

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
                className="text-neutral-500 hover:text-white transition-colors"
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
          onExport={(targetDir, skipConversion, smartExport, uploadToYandex, additionalProcessing) => { handleExport(targetDir, skipConversion, smartExport, uploadToYandex, additionalProcessing, assignments); }}
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
                className="text-neutral-500 hover:text-white transition-colors"
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
                onClick={() => {
                  navigator.clipboard.writeText(generatedMessage);
                  setStatus("Сообщение скопировано в буфер обмена!");
                }}
                className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                Копировать
              </button>
              <button
                onClick={() => setIsMessageModalOpen(false)}
                className="flex-1 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg font-medium transition-colors"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
      <ConfirmModal 
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        variant={confirmState.variant}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState(prev => ({ ...prev, isOpen: false }))}
      />

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
            const updated = assignments.map(a => 
              a.characterName === charName ? { ...a, dubberId } : a
            );
            setAssignments(updated);
            saveToDatabase(updated);
          }}
          onToggleMainRole={(charName, isMain) => {
            const updated = assignments.map(a => 
              a.characterName === charName ? { ...a, isMain } : a
            );
            setAssignments(updated);
            saveToDatabase(updated);
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
    </div>
  );
}
