import { useState, useEffect } from 'react';
import { Episode, RoleAssignment, Participant, Comment, Track } from '../types';

export const useTracks = (currentEpisode: Episode | null) => {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);

  useEffect(() => {
    if (!currentEpisode) return;
    
    const dubberTracks: Record<string, Track> = {};
    
    currentEpisode.assignments?.forEach(as => {
      const dubberId = as.substituteId || as.dubberId;
      const dubberName = as.substitute?.nickname || as.dubber?.nickname || 'Неизвестно';
      
      const dubberFiles = currentEpisode.uploads?.filter(u => 
        (u.type === 'DUBBER_FILE' || u.type === 'FIXES') && 
        (u.assignmentId === as.id || currentEpisode.assignments?.find(a => a.id === u.assignmentId)?.dubberId === dubberId || currentEpisode.assignments?.find(a => a.id === u.assignmentId)?.substituteId === dubberId)
      ).map(u => ({ id: u.id, path: u.path, createdAt: u.createdAt, type: u.type })) || [];
      
      let comments: Comment[] = [];
      if (as.comments) {
        try {
          comments = JSON.parse(as.comments);
        } catch (e) {
          console.error('Failed to parse comments', e);
        }
      }

      if (!dubberTracks[dubberId]) {
        dubberTracks[dubberId] = {
          id: dubberId,
          participant: dubberName,
          character: as.characterName,
          status: (as.status?.toLowerCase() || 'pending') as Track['status'],
          files: dubberFiles,
          selectedFileId: undefined,
          comments
        };
      } else {
        if (!dubberTracks[dubberId].character.includes(as.characterName)) {
          dubberTracks[dubberId].character += `, ${as.characterName}`;
        }
        dubberFiles.forEach(f => {
          if (!dubberTracks[dubberId].files.find(existing => existing.id === f.id)) {
            dubberTracks[dubberId].files.push(f);
          }
        });
        dubberTracks[dubberId].comments = [...dubberTracks[dubberId].comments, ...comments];
        
        // Upgrade track status if a more critical status is found
        const currentStatus = dubberTracks[dubberId].status;
        const newStatus = as.status?.toLowerCase() as Track['status'];
        
        const priorities: Record<string, number> = {
          'rejected': 4,
          'fixes_needed': 3,
          'pending': 2,
          'approved': 1
        };
        
        const currentPriority = priorities[currentStatus] || 0;
        const newPriority = priorities[newStatus] || 0;
        
        if (newPriority > currentPriority) {
          dubberTracks[dubberId].status = newStatus;
        }
      }
    });
    
    // Set selectedFileId for each track
    Object.values(dubberTracks).forEach(track => {
       const savedSelectedId = localStorage.getItem(`selectedFile_${currentEpisode.id}_${track.id}`);
       if (savedSelectedId && track.files.some(f => f.id === savedSelectedId)) {
          track.selectedFileId = savedSelectedId;
       } else if (track.files.length > 0) {
          // Default to newest file
          const sortedFiles = [...track.files].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          track.selectedFileId = sortedFiles[0].id;
       }
    });

    const mappedTracks = Object.values(dubberTracks);
    
    const originalTrack: Track = {
      id: 'original',
      participant: 'Оригинал',
      character: 'Оригинал',
      status: 'approved',
      files: [{ id: 'orig', path: currentEpisode.rawPath, createdAt: '', type: 'DUBBER_FILE' }],
      selectedFileId: 'orig',
      comments: []
    };
    
    setTracks([originalTrack, ...mappedTracks]);
    if (mappedTracks.length > 0 && !selectedTrackId) {
      setSelectedTrackId(mappedTracks[0].id);
    }
  }, [currentEpisode]);

  return { tracks, setTracks, selectedTrackId, setSelectedTrackId };
};
