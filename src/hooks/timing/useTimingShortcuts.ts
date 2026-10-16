import { useEffect } from 'react';

interface TimingShortcutsProps {
  onTogglePlay: () => void;
  onSplit: () => void;
  onDelete: () => void;
  onNudge: (deltaSec: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onRewind: () => void;
}

export function useTimingShortcuts({
  onTogglePlay,
  onSplit,
  onDelete,
  onNudge,
  onUndo,
  onRedo,
  onRewind
}: TimingShortcutsProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing inside form elements
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      // Space -> Toggle Play / Pause
      if (e.code === 'Space') {
        e.preventDefault();
        onTogglePlay();
        return;
      }

      // S -> Split clip at cursor
      if (e.code === 'KeyS' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onSplit();
        return;
      }

      // Delete or Backspace -> Delete clip
      if (e.code === 'Delete' || e.code === 'Backspace') {
        e.preventDefault();
        onDelete();
        return;
      }

      // Arrow Left / Right -> Nudge clip
      if (e.code === 'ArrowLeft') {
        e.preventDefault();
        const delta = e.shiftKey ? -0.10 : -0.01;
        onNudge(delta);
        return;
      }

      if (e.code === 'ArrowRight') {
        e.preventDefault();
        const delta = e.shiftKey ? 0.10 : 0.01;
        onNudge(delta);
        return;
      }

      // Ctrl+Z / Cmd+Z -> Undo
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !e.shiftKey) {
        e.preventDefault();
        onUndo();
        return;
      }

      // Ctrl+Y / Cmd+Shift+Z -> Redo
      if (
        ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyZ')
      ) {
        e.preventDefault();
        onRedo();
        return;
      }

      // Home -> Rewind to 00:00
      if (e.code === 'Home') {
        e.preventDefault();
        onRewind();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onTogglePlay, onSplit, onDelete, onNudge, onUndo, onRedo, onRewind]);
}
