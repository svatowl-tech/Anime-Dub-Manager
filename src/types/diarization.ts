export type DiarizationMethod = 
  | 'whisperx' 
  | 'wlk_sortformer' 
  | 'wlk_diart' 
  | 'onnx_transformers';

export type DiarizationTabType = 'pipeline' | 'quick-assign' | 'voicebase' | 'sidecar';

export interface CorrectionLine {
  lineId: number | string;
  start: string;
  text: string;
  oldName: string;
  proposedName: string;
  approved: boolean;
}

export interface DiarizationPipelineResult {
  success: boolean;
  speakerMapping: Record<string, string>; // lineId -> "Speaker X"
  characterAssignments: Record<string, string>; // "Speaker X" -> "Character Name"
  detectedSpeakersCount: number;
  error?: string;
}

export interface TimingMatchStats {
  mapped: number;
  skipped: number;
  total: number;
  newCharacters: string[];
}

export interface ProgressStepInfo {
  step: number;
  totalSteps: number;
  message: string;
  current?: number;
  total?: number;
}
