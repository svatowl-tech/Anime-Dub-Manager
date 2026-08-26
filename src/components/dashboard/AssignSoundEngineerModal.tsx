import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { Participant } from '../../types';

interface AssignSoundEngineerModalProps {
  isOpen: boolean;
  onClose: () => void;
  participants: Participant[];
  initialSoundEngineerId: string;
  onAssign: (soundEngineerId: string) => void;
}

export default function AssignSoundEngineerModal({ isOpen, onClose, participants, initialSoundEngineerId, onAssign }: AssignSoundEngineerModalProps) {
  const [selectedSoundEngineerId, setSelectedSoundEngineerId] = useState(initialSoundEngineerId);

  useEffect(() => {
    if (isOpen) {
      setSelectedSoundEngineerId(initialSoundEngineerId);
    }
  }, [isOpen, initialSoundEngineerId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden pointer-events-auto">
        <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Назначить звукорежиссера</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-2">Звукорежиссер</label>
            <select 
              value={selectedSoundEngineerId} 
              onChange={(e) => setSelectedSoundEngineerId(e.target.value)}
              className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500/50"
            >
              <option value="">Выберите звукорежиссера</option>
              {participants.filter(p => p.roles?.includes('SOUND_ENGINEER')).map((p, idx) => (
                <option key={(p.id || 'p') + idx} value={p.id}>{p.nickname}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={() => onAssign(selectedSoundEngineerId)}
              className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors"
            >
              Назначить
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
