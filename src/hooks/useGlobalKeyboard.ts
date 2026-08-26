import { useEffect } from 'react';
import { useVideoContext } from '../contexts/VideoContext';

export const useGlobalKeyboard = () => {
  const { togglePlayPause, seekToNext } = useVideoContext();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        const target = event.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
        // Prevent default scrolling behavior
        event.preventDefault();
        togglePlayPause();
      } else if (event.code === 'ArrowRight') {
        const target = event.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
        event.preventDefault();
        seekToNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlayPause, seekToNext]);
};
