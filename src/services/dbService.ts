import { Participant } from '../types';
import { ipcSafe } from '../lib/ipcSafe';

const PARTICIPANTS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let cachedParticipants: Participant[] | null = null;
let cacheTimestamp = 0;
let inFlightParticipantsPromise: Promise<Participant[]> | null = null;

export const invalidateParticipantsCache = (): void => {
  cachedParticipants = null;
  cacheTimestamp = 0;
  inFlightParticipantsPromise = null;
};

export const getParticipants = async (forceRefresh = false): Promise<Participant[]> => {
  const now = Date.now();
  if (!forceRefresh && cachedParticipants && now - cacheTimestamp < PARTICIPANTS_CACHE_TTL_MS) {
    return cachedParticipants;
  }

  if (!forceRefresh && inFlightParticipantsPromise) {
    return inFlightParticipantsPromise;
  }

  inFlightParticipantsPromise = ipcSafe
    .invoke('get-participants')
    .then((res: Participant[]) => {
      const list = Array.isArray(res) ? res : [];
      cachedParticipants = list;
      cacheTimestamp = Date.now();
      return list;
    })
    .finally(() => {
      inFlightParticipantsPromise = null;
    });

  return inFlightParticipantsPromise;
};

export const saveParticipant = async (participant: Participant): Promise<void> => {
  const res = await ipcSafe.invoke('save-participant', participant);
  if (Array.isArray(res)) {
    cachedParticipants = res;
    cacheTimestamp = Date.now();
  } else {
    invalidateParticipantsCache();
  }
};

export const deleteParticipant = async (id: string): Promise<void> => {
  const res = await ipcSafe.invoke('delete-participant', id);
  if (Array.isArray(res)) {
    cachedParticipants = res;
    cacheTimestamp = Date.now();
  } else {
    invalidateParticipantsCache();
  }
};

export const exportParticipants = async (): Promise<string> => {
  const participants = await getParticipants();
  return JSON.stringify(participants);
};

export const importParticipants = async (json: string): Promise<void> => {
  const participants: Participant[] = JSON.parse(json);
  await ipcSafe.invoke('import-participants', participants);
  invalidateParticipantsCache();
};

