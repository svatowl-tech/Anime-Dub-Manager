import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Folder,
  File,
  Upload,
  Download,
  ArrowLeft,
  FolderPlus,
  X,
  Check,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import {
  browseServerFiles,
  createServerDirectory,
  getServerDownloadUrl,
  uploadFileToServer,
  BrowseServerResult,
  ServerFileItem,
} from '../../lib/serverClient';
import {
  registerServerFilePickerHandler,
  ServerFilePickerRequest,
  ServerFilePickerResult,
} from './serverFilePickerBridge';

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 Б';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ`;
}

export const ServerFilePickerModal: React.FC = () => {
  const [request, setRequest] = useState<ServerFilePickerRequest | null>(null);
  const resolverRef = useRef<((res: ServerFilePickerResult) => void) | null>(null);

  const [dirData, setDirData] = useState<BrowseServerResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<ServerFileItem | null>(null);

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploadLabel, setUploadLabel] = useState('');
  const [convertSubs, setConvertSubs] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDirectory = useCallback(async (targetDir?: string) => {
    setLoading(true);
    setError(null);
    setSelectedFile(null);
    try {
      const res = await browseServerFiles(targetDir);
      setDirData(res);
    } catch (err: any) {
      setError(err?.message || 'Не удалось прочитать каталог сервера');
      if (targetDir) {
        try {
          const fallback = await browseServerFiles();
          setDirData(fallback);
          setError(null);
        } catch {}
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    registerServerFilePickerHandler((req) => {
      return new Promise<ServerFilePickerResult>((resolve) => {
        if (resolverRef.current) {
          resolverRef.current({ canceled: true, filePaths: [] });
        }
        resolverRef.current = resolve;
        setRequest(req);
        setNewFolderOpen(false);
        setNewFolderName('');
        void loadDirectory(req.defaultPath);
      });
    });

    return () => {
      registerServerFilePickerHandler(null);
      if (resolverRef.current) {
        resolverRef.current({ canceled: true, filePaths: [] });
        resolverRef.current = null;
      }
    };
  }, [loadDirectory]);

  const closeWithResult = (res: ServerFilePickerResult) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setRequest(null);
    if (resolve) resolve(res);
  };

  if (!request) return null;

  const isFolderMode = request.mode === 'folder' || request.mode === 'directory';
  const isBrowseOnly = request.mode === 'browse';
  const allowedExts = (request.filters || [])
    .flatMap((f) => f.extensions || [])
    .map((e) => e.toLowerCase().replace(/^\./, ''))
    .filter((e) => e && e !== '*');

  const acceptAttr = allowedExts.length > 0 ? allowedExts.map((e) => `.${e}`).join(',') : undefined;

  const filteredItems = (dirData?.items || []).filter((item) => {
    if (item.isDirectory) return true;
    if (isFolderMode) return true;
    if (allowedExts.length === 0) return true;
    const ext = item.ext.replace(/^\./, '').toLowerCase();
    return allowedExts.includes(ext);
  });

  const handleConfirmCurrentDir = () => {
    if (!dirData) return;
    closeWithResult({
      canceled: false,
      path: dirData.currentDir,
      filePath: dirData.currentDir,
      filePaths: [dirData.currentDir],
    });
  };

  const handleConfirmSelectedFile = (item: ServerFileItem) => {
    if (item.isDirectory) {
      void loadDirectory(item.path);
      return;
    }
    if (isFolderMode || isBrowseOnly) return;
    closeWithResult({
      canceled: false,
      path: item.path,
      filePath: item.path,
      filePaths: [item.path],
    });
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newFolderName.trim();
    if (!trimmed || !dirData) return;
    try {
      const separator = dirData.currentDir.endsWith('/') || dirData.currentDir.endsWith('\\') ? '' : '/';
      const created = await createServerDirectory(`${dirData.currentDir}${separator}${trimmed}`);
      setNewFolderOpen(false);
      setNewFolderName('');
      await loadDirectory(created.path);
    } catch (err: any) {
      setError(err?.message || 'Ошибка создания папки');
    }
  };

  const handleUploadChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const targetDir = dirData?.currentDir || 'uploads';
    setUploading(true);
    setUploadPercent(0);
    setUploadLabel(file.name);
    setError(null);

    try {
      const uploaded = await uploadFileToServer(
        file,
        {
          targetDir,
          convertSubtitles: convertSubs && /\.(srt|vtt|ssa)$/i.test(file.name),
        },
        (pct) => setUploadPercent(pct)
      );
      await loadDirectory(targetDir);
      if (request.mode === 'file') {
        closeWithResult({
          canceled: false,
          path: uploaded.path,
          filePath: uploaded.path,
          filePaths: [uploaded.path],
        });
      }
    } catch (err: any) {
      setError(err?.message || 'Ошибка загрузки файла');
    } finally {
      setUploading(false);
      setUploadPercent(0);
      setUploadLabel('');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[90] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={request.title || 'Файлы сервера'}
    >
      <div className="w-full sm:max-w-3xl bg-neutral-900 border border-neutral-800 rounded-t-2xl sm:rounded-xl shadow-2xl flex flex-col max-h-[90dvh] overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-neutral-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-white truncate">
              {request.title ||
                (isFolderMode
                  ? 'Выбор папки на сервере'
                  : isBrowseOnly
                    ? 'Файловый менеджер сервера'
                    : 'Выбор или загрузка файла на сервер')}
            </h2>
            <p className="text-xs text-neutral-400 font-mono truncate mt-0.5 tabular-nums">
              {dirData?.currentDir || 'Загрузка каталога...'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => closeWithResult({ canceled: true, filePaths: [] })}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors shrink-0"
            aria-label="Закрыть"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="px-4 py-2.5 border-b border-neutral-800 bg-neutral-950/60 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!dirData?.parentDir || loading}
            onClick={() => dirData?.parentDir && void loadDirectory(dirData.parentDir)}
            className="min-h-[40px] px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-xs font-medium text-neutral-200 flex items-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Вверх</span>
          </button>

          <button
            type="button"
            disabled={loading}
            onClick={() => void loadDirectory(dirData?.currentDir)}
            className="min-h-[40px] px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-200 flex items-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Обновить</span>
          </button>

          <button
            type="button"
            onClick={() => setNewFolderOpen((v) => !v)}
            className="min-h-[40px] px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-200 flex items-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <FolderPlus className="w-4 h-4" />
            <span>Новая папка</span>
          </button>

          <div className="flex-1" />

          {!isFolderMode && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept={acceptAttr}
                onChange={handleUploadChange}
                className="hidden"
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="min-h-[40px] px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-semibold text-white flex items-center gap-2 transition-colors whitespace-nowrap"
              >
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                <span>{uploading ? `Загрузка ${uploadPercent}%` : 'Загрузить с устройства'}</span>
              </button>
            </>
          )}
        </div>

        {/* Inline New Folder Bar */}
        {newFolderOpen && (
          <form
            onSubmit={handleCreateFolder}
            className="px-4 py-2.5 border-b border-neutral-800 bg-neutral-900 flex items-center gap-2"
          >
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Имя новой папки..."
              autoFocus
              className="flex-1 min-h-[40px] px-3 py-1.5 rounded-lg bg-neutral-950 border border-neutral-800 text-sm text-white focus:border-blue-500 outline-none"
            />
            <button
              type="submit"
              className="min-h-[40px] px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white whitespace-nowrap"
            >
              Создать
            </button>
            <button
              type="button"
              onClick={() => setNewFolderOpen(false)}
              className="min-h-[40px] px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-300"
            >
              Отмена
            </button>
          </form>
        )}

        {/* Upload Progress Bar */}
        {uploading && (
          <div className="px-4 py-2.5 border-b border-neutral-800 bg-neutral-950 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-neutral-300">
              <span className="truncate max-w-[70%]">Загрузка: {uploadLabel}</span>
              <span className="font-mono tabular-nums text-blue-400">{uploadPercent}%</span>
            </div>
            <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-150"
                style={{ width: `${uploadPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Subtitle auto-convert hint when uploading */}
        {!isFolderMode && (
          <div className="px-4 py-2 border-b border-neutral-800/80 bg-neutral-950/40 flex items-center justify-between gap-3 text-xs text-neutral-400">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={convertSubs}
                onChange={(e) => setConvertSubs(e.target.checked)}
                className="rounded border-neutral-700 bg-neutral-900 text-blue-600"
              />
              <span>Автоконвертировать загруженные SRT/VTT в ASS</span>
            </label>
            {allowedExts.length > 0 && (
              <span className="font-mono text-neutral-500 truncate">
                Фильтр: {allowedExts.join(', ')}
              </span>
            )}
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="px-4 py-2.5 bg-red-950/40 border-b border-red-900/50 flex items-center justify-between gap-3 text-xs text-red-300">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => void loadDirectory(dirData?.currentDir)}
              className="underline hover:text-white shrink-0"
            >
              Повторить
            </button>
          </div>
        )}

        {/* Directory Listing (only scrollable container) */}
        <div className="flex-1 min-h-[220px] overflow-y-auto divide-y divide-neutral-800/70">
          {loading && !dirData ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-sm text-neutral-400">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
              <span>Чтение каталога сервера...</span>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-12 px-4 text-center space-y-3">
              <p className="text-sm text-neutral-400">Папка пуста или подходящие файлы отсутствуют.</p>
              {!isFolderMode && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white"
                >
                  <Upload className="w-4 h-4" />
                  <span>Загрузить файл с компьютера / телефона</span>
                </button>
              )}
            </div>
          ) : (
            filteredItems.map((item) => {
              const isSelected = selectedFile?.path === item.path;
              return (
                <div
                  key={item.path}
                  onClick={() => {
                    if (item.isDirectory) {
                      void loadDirectory(item.path);
                    } else {
                      setSelectedFile(item);
                    }
                  }}
                  onDoubleClick={() => handleConfirmSelectedFile(item)}
                  className={`px-4 py-3 min-h-[52px] flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                    isSelected ? 'bg-blue-600/15' : 'hover:bg-neutral-800/60'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {item.isDirectory ? (
                      <Folder className="w-5 h-5 text-blue-400 shrink-0" />
                    ) : (
                      <File className="w-5 h-5 text-neutral-400 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-neutral-100 truncate">{item.name}</p>
                      <p className="text-xs text-neutral-500 tabular-nums">
                        {item.isDirectory ? 'Папка' : formatBytes(item.size)}
                        {item.mtime ? ` · ${new Date(item.mtime).toLocaleString('ru-RU')}` : ''}
                      </p>
                    </div>
                  </div>

                  {!item.isDirectory && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <a
                        href={getServerDownloadUrl(item.path)}
                        download={item.name}
                        onClick={(e) => e.stopPropagation()}
                        className="min-h-[38px] min-w-[38px] px-2.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 flex items-center justify-center gap-1.5 text-xs transition-colors"
                        title="Скачать на устройство"
                      >
                        <Download className="w-4 h-4" />
                        <span className="hidden sm:inline">Скачать</span>
                      </a>
                      {!isFolderMode && !isBrowseOnly && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleConfirmSelectedFile(item);
                          }}
                          className="min-h-[38px] px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
                        >
                          Выбрать
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-neutral-800 bg-neutral-950 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => closeWithResult({ canceled: true, filePaths: [] })}
            className="min-h-[42px] px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-300 transition-colors"
          >
            {isBrowseOnly ? 'Закрыть' : 'Отмена'}
          </button>

          {isFolderMode && (
            <button
              type="button"
              disabled={!dirData}
              onClick={handleConfirmCurrentDir}
              className="min-h-[42px] px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-semibold text-white flex items-center gap-2 transition-colors"
            >
              <Check className="w-4 h-4" />
              <span>Выбрать текущую папку</span>
            </button>
          )}

          {!isFolderMode && !isBrowseOnly && selectedFile && !selectedFile.isDirectory && (
            <button
              type="button"
              onClick={() => handleConfirmSelectedFile(selectedFile)}
              className="min-h-[42px] px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white flex items-center gap-2 transition-colors"
            >
              <Check className="w-4 h-4" />
              <span className="truncate max-w-[200px]">Выбрать {selectedFile.name}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
