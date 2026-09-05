import { Episode, Project, TelegramMTProtoDialog, TelegramMTProtoSettings, TelegramMTProtoStatus } from '../../types';

export interface TelegramChatMessage {
  id: string;
  senderName: string;
  text: string;
  time: string;
  isMe: boolean;
  mediaPath?: string;
  isPinned?: boolean;
}

export type TelegramTabType = 'web' | 'tracks' | 'verify' | 'composer' | 'automations' | 'messenger' | 'dialogs' | 'settings';

export interface TelegramAudioFileItem {
  id: number;
  date: number;
  dateFormatted: string;
  sender: {
    id: string;
    name: string;
    username: string;
  };
  fileName: string;
  mimeType: string;
  size: number;
  sizeFormatted: string;
  duration?: number;
  durationFormatted?: string;
  isVoice?: boolean;
  caption?: string;
  downloadedPath?: string;
}

export interface TelegramPostSearchResult {
  id: number;
  date: number;
  dateFormatted: string;
  text: string;
  views?: number;
  forwards?: number;
  hasMedia?: boolean;
  link: string;
}

export interface TelegramTabProps {
  status: TelegramMTProtoStatus | null;
  onRefreshStatus: () => Promise<void>;
  currentEpisode?: Episode | null;
  currentProject?: Project | null;
  allProjects?: Project[];
}
