import React from 'react';
import { Loader2, CheckCircle, Sparkles } from 'lucide-react';
import { ProgressStepInfo } from '../../types/diarization';

interface DiarizationProgressBarProps {
  progressStep: ProgressStepInfo | null;
  overallPercent: number;
}

export const DiarizationProgressBar: React.FC<DiarizationProgressBarProps> = ({
  progressStep,
  overallPercent
}) => {
  if (!progressStep) return null;

  return (
    <div className="bg-neutral-900/90 border border-indigo-500/30 backdrop-blur-md rounded-xl p-4 shadow-xl shrink-0 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center justify-between gap-4 mb-2">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-indigo-500/20 text-indigo-400 rounded-lg animate-spin">
            <Loader2 className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-semibold text-white flex items-center gap-1.5">
              <span>Шаг {progressStep.step} из {progressStep.totalSteps}:</span>
              <span className="text-neutral-300 font-normal">{progressStep.message}</span>
            </div>
            {progressStep.current !== undefined && progressStep.total !== undefined && (
              <div className="text-[11px] text-neutral-400 mt-0.5">
                Прогресс операции: {progressStep.current}% / {progressStep.total}%
              </div>
            )}
          </div>
        </div>

        <div className="text-right">
          <span className="text-sm font-bold text-indigo-400 font-mono">
            {Math.min(100, Math.max(0, overallPercent))}%
          </span>
        </div>
      </div>

      {/* Progress Track */}
      <div className="w-full bg-neutral-800 rounded-full h-2 overflow-hidden border border-neutral-700/50">
        <div 
          className="bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-400 h-full rounded-full transition-all duration-300 ease-out shadow-sm"
          style={{ width: `${Math.min(100, Math.max(2, overallPercent))}%` }}
        />
      </div>
    </div>
  );
};
