import { Participant } from '../types';
import { ipcSafe } from '../lib/ipcSafe';

export const getParticipants = async (): Promise<Participant[]> => {
  return await ipcSafe.invoke('get-participants');
};

export const saveParticipant = async (participant: Participant): Promise<void> => {
  return await ipcSafe.invoke('save-participant', participant);
};

export const deleteParticipant = async (id: string): Promise<void> => {
  return await ipcSafe.invoke('delete-participant', id);
};

export const exportParticipants = async (): Promise<string> => {
  const participants = await getParticipants();
  return JSON.stringify(participants);
};

export const importParticipants = async (json: string): Promise<void> => {
  const participants: Participant[] = JSON.parse(json);
  return await ipcSafe.invoke('import-participants', participants);
};
