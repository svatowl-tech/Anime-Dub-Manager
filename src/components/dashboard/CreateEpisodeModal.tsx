import React, { useState, useEffect } from 'react';
import { X, Plus, Loader2 } from 'lucide-react';

interface CreateEpisodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (episodeNumber: number, title?: string) => Promise<void> | void;
  defaultEpisodeNumber: number;
}

export default function CreateEpisodeModal({ isOpen, onClose, onCreate, defaultEpisodeNumber }: CreateEpisodeModalProps) {
  const [episodeNumber, setEpisodeNumber] = useState(defaultEpisodeNumber);
  const [episodeTitle, setEpisodeTitle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setEpisodeNumber(defaultEpisodeNumber);
      setEpisodeTitle('');
      setIsSubmitting(false);
    }
  }, [isOpen, defaultEpisodeNumber]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isNaN(episodeNumber) || episodeNumber < 1) return;
    setIsSubmitting(true);
    try {
      await onCreate(episodeNumber, episodeTitle.trim() || undefined);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-600/20 text-blue-400 rounded-lg">
              <Plus className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-semibold text-white">Добавить серию</h2>
          </div>
          <button 
            type="button"
            onClick={onClose} 
            disabled={isSubmitting} 
            className="text-neutral-400 hover:text-white disabled:opacity-50 p-1 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-2">Номер серии</label>
            <input 
              type="number" 
              value={episodeNumber || ''} 
              onChange={(e) => setEpisodeNumber(parseInt(e.target.value) || 0)}
              disabled={isSubmitting}
              className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50 transition-all font-mono"
              min="1"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-2">
              Название серии <span className="text-neutral-500 text-xs font-normal">(опционально)</span>
            </label>
            <input 
              type="text" 
              value={episodeTitle} 
              onChange={(e) => setEpisodeTitle(e.target.value)}
              disabled={isSubmitting}
              placeholder="Напр.: Возвращение героя"
              className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50 transition-all text-sm"
            />
            <p className="text-xs text-neutral-500 mt-1.5">
              Если оставить пустым, система попытается автоматически определить название или оставить стандартный номер.
            </p>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button 
              type="button" 
              onClick={onClose} 
              disabled={isSubmitting}
              className="flex-1 py-2.5 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-neutral-300 rounded-lg font-medium transition-colors cursor-pointer"
            >
              Отмена
            </button>
            <button 
              type="submit" 
              disabled={isSubmitting || !episodeNumber || episodeNumber < 1}
              className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-blue-600/20"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Создание...</span>
                </>
              ) : (
                <span>Добавить</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
