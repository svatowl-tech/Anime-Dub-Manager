import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { Participant } from '../../types';

interface AssignDubbersModalProps {
  isOpen: boolean;
  onClose: () => void;
  participants: Participant[];
  initialSelectedDubbers: string[];
  onSave: (selectedDubbers: string[]) => void;
}

export default function AssignDubbersModal({ isOpen, onClose, participants, initialSelectedDubbers, onSave }: AssignDubbersModalProps) {
  const [selectedDubbers, setSelectedDubbers] = useState<string[]>(initialSelectedDubbers);

  useEffect(() => {
    if (isOpen) {
      setSelectedDubbers(initialSelectedDubbers);
    }
  }, [isOpen, initialSelectedDubbers]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave(selectedDubbers);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Назначить даберов на проект</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4 max-h-96 overflow-y-auto">
          {participants.map((p, idx) => (
            <label key={(p.id || 'p') + idx} className="flex items-center gap-3 p-3 rounded-lg hover:bg-neutral-800 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedDubbers.includes(p.id)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelectedDubbers([...selectedDubbers, p.id]);
                  } else {
                    setSelectedDubbers(selectedDubbers.filter(id => id !== p.id));
                  }
                }}
                className="w-4 h-4 rounded border-neutral-700 bg-neutral-950 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-neutral-200">{p.nickname}</span>
            </label>
          ))}
        </div>
        <div className="p-6 border-t border-neutral-800">
          <button onClick={handleSave} className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors">Сохранить</button>
        </div>
      </div>
    </div>
  );
}
