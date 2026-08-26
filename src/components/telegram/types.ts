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

export type TelegramTabType = 'web' | 'messenger' | 'composer' | 'automations' | 'dialogs' | 'settings';

export interface TelegramTabProps {
  status: TelegramMTProtoStatus | null;
  onRefreshStatus: () => Promise<void>;
  currentEpisode?: Episode | null;
  currentProject?: Project | null;
  allProjects?: Project[];
}
