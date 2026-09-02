import React, { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';

// Global registry of all active WaveSurfer players to guarantee 100% exclusive single-source playback
const activeWaveSurfers = new Set();

export default function WaveformRenderer({ 
  audioUrl, 
  isPlaying, 
  onPlayPause, 
  active, 
  isGlobal, 
  sampleName, 
  sampleTags, 
  volume = 0.8, 
  pitchSemitones = 0,
  speedMultiplier = 1.0,
  onError 
}) {
  const containerRef = useRef(null);
  const wavesurferRef = useRef(null);
  const playTimeoutRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    // Reset states on URL change
    setLoading(true);
    setError(false);

    // Use WebAudio backend for all files to ensure 100% full, uninterrupted playback.
    // This fully decodes the audio in memory, avoiding range-request issues on blob/local URLs.
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#4b5563',
      progressColor: '#06b6d4',
      cursorColor: '#7c3aed',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 2,
      height: isGlobal ? 40 : 28,
      normalize: true,
      fillParent: true,
      interact: true,
      url: audioUrl
    });

    try {
      ws.setVolume(volume);
    } catch (err) {
      console.warn('Failed to set initial WaveSurfer volume:', err);
    }

    wavesurferRef.current = ws;
    activeWaveSurfers.add(ws);

    // Stop all other instances as soon as this one plays
    ws.on('play', () => {
      // Ensure audio context is unmuted/resumed
      try {
        const audioCtx = ws.backend?.audioContext;
        if (audioCtx && audioCtx.state === 'suspended') {
          audioCtx.resume();
        }
      } catch (e) {}

      if (playTimeoutRef.current) {
        clearTimeout(playTimeoutRef.current);
        playTimeoutRef.current = null;
      }
      activeWaveSurfers.forEach(instance => {
        if (instance !== ws) {
          try {
            instance.pause();
          } catch (err) {}
        }
      });
      window.dispatchEvent(new CustomEvent('wavely-sample-played'));
    });

    ws.on('ready', () => {
      setLoading(false);
      setError(false);
    });

    ws.on('error', (err) => {
      console.warn('WaveSurfer loading error:', err);
      setLoading(false);
      setError(true);
    });

    ws.on('finish', () => {
      if (onPlayPause) onPlayPause(false);
    });

    // Cleanup on unmount
    return () => {
      if (playTimeoutRef.current) {
        clearTimeout(playTimeoutRef.current);
      }
      try {
        ws.pause();
      } catch (e) {}
      activeWaveSurfers.delete(ws);
      ws.destroy();
    };
  }, [audioUrl]);

  // Sync volume state
  useEffect(() => {
    if (wavesurferRef.current) {
      try {
        wavesurferRef.current.setVolume(volume);
      } catch (err) {}
    }
  }, [volume]);

  // Sync pitch and speed rate changes
  useEffect(() => {
    if (wavesurferRef.current) {
      try {
        const pitchRatio = Math.pow(2, (pitchSemitones || 0) / 12);
        const effectiveRate = (speedMultiplier || 1.0) * pitchRatio;
        wavesurferRef.current.setPlaybackRate(effectiveRate, false);
      } catch (err) {}
    }
  }, [pitchSemitones, speedMultiplier]);

  // Sync playback state
  useEffect(() => {
    if (!wavesurferRef.current) return;

    if (active && isPlaying) {
      if (!loading && !error) {
        wavesurferRef.current.play().catch(() => {
          // Attempt AudioContext resume
          try {
            const audioCtx = wavesurferRef.current?.backend?.audioContext;
            if (audioCtx && audioCtx.state === 'suspended') {
              audioCtx.resume().then(() => wavesurferRef.current.play()).catch(() => {});
            }
          } catch (e) {}
        });

        if (!wavesurferRef.current.isPlaying()) {
          if (playTimeoutRef.current) clearTimeout(playTimeoutRef.current);
          playTimeoutRef.current = setTimeout(() => {
            if (wavesurferRef.current && !wavesurferRef.current.isPlaying()) {
              setError(true);
              setLoading(false);
              if (onError) {
                onError(`Playback error: Failed to load preview for "${sampleName || 'sample'}"`);
              }
            }
          }, 3000);
        }
      }
    } else {
      if (playTimeoutRef.current) {
        clearTimeout(playTimeoutRef.current);
        playTimeoutRef.current = null;
      }
      try {
        wavesurferRef.current.pause();
      } catch (err) {}
    }
  }, [isPlaying, active, loading, error]);

  return (
    <div 
      ref={containerRef} 
      className="wavesurfer-container" 
      style={{ opacity: loading ? 0.4 : (error ? 0.8 : 1), transition: 'opacity 0.2s', width: '100%', position: 'relative' }}
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      {loading && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none' }}>
          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Decoding...</span>
        </div>
      )}
    </div>
  );
}
