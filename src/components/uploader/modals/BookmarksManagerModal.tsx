import React from 'react';
import { Bookmark as BookmarkIcon, X, Trash2, Plus } from 'lucide-react';
import { BookmarkItem } from '../types';

interface BookmarksManagerModalProps {
  bookmarks: BookmarkItem[];
  bmFormName: string;
  setBmFormName: (val: string) => void;
  bmFormUrl: string;
  setBmFormUrl: (val: string) => void;
  onAddBookmark: () => void;
  onDeleteBookmark: (id: string) => void;
  onResetBookmarks: () => void;
  onClose: () => void;
}

export const BookmarksManagerModal: React.FC<BookmarksManagerModalProps> = ({
  bookmarks,
  bmFormName,
  setBmFormName,
  bmFormUrl,
  setBmFormUrl,
  onAddBookmark,
  onDeleteBookmark,
  onResetBookmarks,
  onClose
}) => {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
        <div className="px-5 py-3.5 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/90">
          <div className="flex items-center gap-2">
            <BookmarkIcon className="w-5 h-5 text-pink-400" />
            <h3 className="font-bold text-white text-sm">Управление закладками браузера</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-neutral-800 rounded-lg text-neutral-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
          {/* Existing Bookmarks */}
          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {bookmarks.map((bm) => (
              <div key={bm.id} className="flex items-center justify-between p-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-xs">
                <div className="truncate pr-2 min-w-0">
                  <div className="font-semibold text-white truncate">{bm.name}</div>
                  <div className="text-neutral-500 truncate text-[11px] font-mono">{bm.url}</div>
                </div>
                <button
                  onClick={() => onDeleteBookmark(bm.id)}
                  className="p-1.5 text-neutral-500 hover:text-red-400 hover:bg-red-950/50 rounded-lg transition flex-shrink-0 cursor-pointer"
                  title="Удалить закладку"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          <hr className="border-neutral-800" />

          {/* Add New Bookmark Form */}
          <div className="space-y-2 bg-neutral-950 p-3 rounded-xl border border-neutral-800 text-xs">
            <span className="font-semibold text-neutral-200 block">Добавить закладку:</span>
            <input
              type="text"
              placeholder="Название (например, RuTube)"
              value={bmFormName}
              onChange={(e) => setBmFormName(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-1.5 text-neutral-200 focus:outline-none focus:ring-1 focus:ring-pink-500"
            />
            <input
              type="text"
              placeholder="URL (например, https://rutube.ru)"
              value={bmFormUrl}
              onChange={(e) => setBmFormUrl(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-1.5 text-neutral-200 focus:outline-none focus:ring-1 focus:ring-pink-500"
            />
            <button
              onClick={onAddBookmark}
              className="w-full py-2 bg-pink-600 hover:bg-pink-500 text-white rounded-lg font-medium transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Добавить закладку</span>
            </button>
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-neutral-800 bg-neutral-950 flex items-center justify-between">
          <button
            onClick={onResetBookmarks}
            className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-neutral-200 rounded-lg text-xs transition cursor-pointer"
          >
            Сбросить по умолчанию
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-medium transition cursor-pointer"
          >
            Готово
          </button>
        </div>
      </div>
    </div>
  );
};
