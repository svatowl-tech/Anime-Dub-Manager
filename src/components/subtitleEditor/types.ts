export interface RawSubtitleLine {
  id?: number;
  start: string;
  end: string;
  startSec: number;
  endSec: number;
  style: string;
  name: string;
  text: string;
  rawLineIndex: number;
  originalIndex?: number;
}

export type SubtitleUpdates = Record<number, {
  name?: string;
  text?: string;
  start?: string;
  end?: string;
  _forceSave?: boolean;
}>;

export interface UndoRedoState {
  lines: RawSubtitleLine[];
  updates: SubtitleUpdates;
}
