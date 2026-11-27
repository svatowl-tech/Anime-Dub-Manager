export interface ServerFilePickerFilter {
  name: string;
  extensions: string[];
}

export interface ServerFilePickerRequest {
  mode: 'file' | 'folder' | 'directory' | 'browse';
  title?: string;
  defaultPath?: string;
  filters?: ServerFilePickerFilter[];
}

export interface ServerFilePickerResult {
  canceled: boolean;
  path?: string;
  filePath?: string;
  filePaths?: string[];
}

type PickerHandler = (req: ServerFilePickerRequest) => Promise<ServerFilePickerResult>;

let activeHandler: PickerHandler | null = null;

export function registerServerFilePickerHandler(handler: PickerHandler | null) {
  activeHandler = handler;
}

export function isServerFilePickerMounted(): boolean {
  return activeHandler !== null;
}

export async function requestServerFilePicker(req: ServerFilePickerRequest): Promise<ServerFilePickerResult> {
  if (!activeHandler) {
    return { canceled: true, filePaths: [] };
  }
  return await activeHandler(req);
}
