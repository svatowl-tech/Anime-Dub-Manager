import { Participant } from "../types";

export interface RoleMapping {
  [characterName: string]: string; // characterName -> dubberNickname (or comma-separated nicknames)
}

export function exportMappingToJson(mapping: Record<string, string>, participants: Participant[]): string {
  const exportData: RoleMapping = {};
  
  Object.entries(mapping).forEach(([char, dubberId]) => {
    const participant = participants.find(p => p.id === dubberId);
    if (participant) {
      exportData[char] = participant.nickname;
    }
  });
  
  return JSON.stringify(exportData, null, 2);
}

export function importMappingFromJson(jsonString: string, participants: Participant[]): Record<string, string> {
  const importData: RoleMapping = JSON.parse(jsonString);
  const newMapping: Record<string, string> = {};
  
  Object.entries(importData).forEach(([char, nickname]) => {
    // Handle comma-separated nicknames if necessary, though the requested format
    // seems to imply simple mapping or comma-separated strings.
    // For now, we try to find the participant by nickname.
    const participant = participants.find(p => p.nickname === nickname);
    if (participant) {
      newMapping[char] = participant.id;
    }
  });
  
  return newMapping;
}
