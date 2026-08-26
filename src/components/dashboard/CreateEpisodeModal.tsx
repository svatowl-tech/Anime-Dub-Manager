import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';

interface CreateEpisodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (episodeNumber: number) => void;
  defaultEpisodeNumber: number;
}

export default function CreateEpisodeModal({ isOpen, onClose, onCreate, defaultEpisodeNumber }: CreateEpisodeModalProps) {
  const [episodeNumber, setEpisodeNumber] = useState(defaultEpisodeNumber);

  useEffect(() => {
    if (isOpen) {
      setEpisodeNumber(defaultEpisodeNumber);
    }
  }, [isOpen, defaultEpisodeNumber]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate(episodeNumber);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Добавить серию</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-2">Номер серии</label>
            <input 
              type="number" 
              value={episodeNumber} 
              onChange={(e) => setEpisodeNumber(parseInt(e.target.value))}
              className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500/50"
              min="1"
              required
            />
          </div>
          <button type="submit" className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors">Добавить</button>
        </form>
      </div>
    </div>
  );
}
