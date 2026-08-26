/**
 * Type definitions for character voice and snapshot preview inspection.
 */

import { RoleAssignment, Participant, Episode, Project } from '../../types';

export interface CharacterDialogueLine {
  id: number;
  rawIndex: number;
  start: string;
  end: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  name: string;
  style: string;
  rawText: string;
  cleanText: string;
  snapshotUrl?: string;
  episodeId?: string;
  episodeNumber?: number;
}

export interface CharacterPreviewMetadata {
  characterName: string;
  mainName: string;
  isMain?: boolean;
  dubberId?: string;
  substituteId?: string;
  portraitUrl?: string;
  lineCount: number;
  lines: CharacterDialogueLine[];
  videoSrc?: string;
}

export interface VoicePlaybackSettings {
  preRollSec: number;   // Padding before dialogue start (e.g. 0.2s)
  postRollSec: number;  // Padding after dialogue end (e.g. 0.3s)
  playbackRate: number; // 0.8, 1.0, 1.25, 1.5
  volume: number;       // 0.0 to 1.0
  loop: boolean;        // Loop dialogue line
  autoPlayOnSelect: boolean; // Auto play when selecting a line
}

export interface CharacterInspectionProps {
  isOpen: boolean;
  onClose: () => void;
  characterName: string;
  currentEpisode: Episode | null;
  project?: Project | null;
  participants: Participant[];
  assignments: RoleAssignment[];
  globalMapping: { characterName: string; dubberId: string; photoUrl?: string; isMain?: boolean }[];
  characterAliases?: Record<string, string>;
  onAssignDubber?: (characterName: string, dubberId: string) => void;
  onToggleMainRole?: (characterName: string, isMain: boolean) => void;
  onUpdatePortrait?: (characterName: string, photoUrl: string) => void;
  onNavigateCharacter?: (direction: 'next' | 'prev') => void;
  onReassignLine?: (rawIndex: number, newCharacterName: string, oldCharacterName: string) => Promise<void> | void;
  onRefreshData?: () => void;
  characterList?: string[];
  currentIndex?: number;
  totalCharacters?: number;
}
