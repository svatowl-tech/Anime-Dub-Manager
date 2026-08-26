import { SubtitleLine } from '../../types';
import { CorrectionLine } from '../../types/diarization';

/**
 * Generates correction lines for review mode
 */
export function generateCorrectionLines(
  subLines: SubtitleLine[],
  speakerMapping: Record<string, string>,
  characterAssignments: Record<string, string>,
  correctionMode: boolean
): CorrectionLine[] {
  const result: CorrectionLine[] = [];

  for (const line of subLines) {
    const rawSpeaker = speakerMapping[String(line.id)];
    if (!rawSpeaker) continue;

    const oldName = (line.name || '').trim();
    const isAlreadyAssigned = oldName && oldName !== 'Default' && !oldName.startsWith('Speaker ');

    // Determine proposed name: first check character assignments from VoiceBase / LLM, then raw speaker
    let proposedName = characterAssignments[rawSpeaker] || rawSpeaker;

    // In non-correction mode (mode with preservation), don't change already assigned characters
    if (!correctionMode && isAlreadyAssigned) {
      continue;
    }

    // Only add to review if name changes or if we want to confirm
    const isDifferent = oldName !== proposedName;

    result.push({
      lineId: line.id,
      start: String(line.start || '00:00:00'),
      text: line.text || '',
      oldName: oldName || '—',
      proposedName: proposedName,
      approved: isDifferent // Auto-check if it introduces a change
    });
  }

  return result;
}

/**
 * Applies approved corrections to subtitle lines
 */
export function applyApprovedCorrections(
  subLines: SubtitleLine[],
  approvedLines: CorrectionLine[]
): SubtitleLine[] {
  const approvedMap = new Map<string, string>();
  for (const c of approvedLines) {
    if (c.approved) {
      approvedMap.set(String(c.lineId), c.proposedName);
    }
  }

  return subLines.map(line => {
    const proposed = approvedMap.get(String(line.id));
    if (proposed) {
      return {
        ...line,
        name: proposed
      };
    }
    return line;
  });
}
