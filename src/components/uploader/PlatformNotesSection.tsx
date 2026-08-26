import React from 'react';
import { FileText } from 'lucide-react';

interface PlatformNotesSectionProps {
  platformNotes: string;
  setPlatformNotes: (notes: string) => void;
}

export const PlatformNotesSection: React.FC<PlatformNotesSectionProps> = ({
  platformNotes,
  setPlatformNotes
}) => {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3.5 space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-neutral-200 flex items-center gap-1.5">
          <FileText className="w-4 h-4 text-cyan-400" />
          Памятка заливщика
        </span>
      </div>
      <textarea
        value={platformNotes}
        onChange={(e) => setPlatformNotes(e.target.value)}
        placeholder="Заметки или правила публикации..."
        rows={4}
        className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-2.5 text-xs text-neutral-300 focus:outline-none focus:ring-1 focus:ring-cyan-500 resize-y"
      />
    </div>
  );
};
