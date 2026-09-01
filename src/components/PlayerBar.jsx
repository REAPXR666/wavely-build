import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, Pause, Volume2, Volume1, VolumeX, SkipBack, SkipForward, Repeat,
  Layers, Music, Activity
} from 'lucide-react';

export default function PlayerBar({ 
  currentSound, 
  isPlaying, 
  setIsPlaying, 
  volume = 0.8, 
  setVolume, 
  isLooping, 
  setIsLooping,
  onNext,
  onPrevious,
  onOpenAnalyser
}) {
  const audioRef = useRef(null);
  const canvasRef = useRef(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioBufferData, setAudioBufferData] = useState(null);
  const [hoverPosition, setHoverPosition] = useState(null);
  const [prevVolume, setPrevVolume] = useState(0.8);

  const safeVolume = typeof volume === 'number' && !isNaN(volume) ? Math.max(0, Math.min(1, volume)) : 0.8;

  // The bottom PlayerBar is strictly for Pack Demos!
  const isPackDemo = currentSound && currentSound.productType === 'pack-demo';

  // Listen for sample playback to pause any active pack demo
  useEffect(() => {
    const handleSamplePlayed = () => {
      if (isPackDemo && isPlaying && setIsPlaying) {
        setIsPlaying(false);
      }
    };
    window.addEventListener('wavely-sample-played', handleSamplePlayed);
    return () => window.removeEventListener('wavely-sample-played', handleSamplePlayed);
  }, [isPackDemo, isPlaying, setIsPlaying]);

  // Sync volume with audio element
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = safeVolume;
    }
  }, [safeVolume]);

  // Handle Play/Pause state changes for Pack Demo
  useEffect(() => {
    if (!audioRef.current || !isPackDemo || !currentSound?.previewUrl) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      return;
    }

    if (isPlaying) {
      const playPromise = audioRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          if (err.name !== 'AbortError') {
            console.warn('[PlayerBar] Pack demo play interrupted or failed:', err.message);
          }
        });
      }
    } else {
      audioRef.current.pause();
    }
  }, [isPlaying, isPackDemo, currentSound?.previewUrl]);

  // Load pack demo audio & generate waveform peaks
  useEffect(() => {
    if (!isPackDemo || !currentSound?.previewUrl) {
      setCurrentTime(0);
      setDuration(0);
      setAudioBufferData(null);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
      return;
    }

    const audioUrl = currentSound.previewUrl;
    setCurrentTime(0);
    setDuration(0);

    if (audioRef.current) {
      audioRef.current.src = audioUrl;
      audioRef.current.loop = !!isLooping;
      audioRef.current.volume = safeVolume;
      audioRef.current.load();
      if (isPlaying) {
        audioRef.current.play().catch(e => {
          if (e.name !== 'AbortError') console.warn('[PlayerBar] Demo load play error:', e.message);
        });
      }
    }

    // Generate waveform peak bars using Web Audio API decoding
    let isCancelled = false;
    const generatePeaks = async () => {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        const ctx = new AudioContextClass();
        
        const response = await fetch(audioUrl);
        const arrayBuffer = await response.arrayBuffer();
        if (isCancelled) return;

        const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);
        if (isCancelled) return;

        if (decodedBuffer.duration && isFinite(decodedBuffer.duration) && decodedBuffer.duration > 0) {
          setDuration(decodedBuffer.duration);
        }

        const rawData = decodedBuffer.getChannelData(0);
        const samplesCount = 80; // Sleek number of bars
        const blockSize = Math.floor(rawData.length / samplesCount);
        const peaks = [];

        for (let i = 0; i < samplesCount; i++) {
          const start = i * blockSize;
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(rawData[start + j] || 0);
          }
          peaks.push(sum / blockSize);
        }

        // Normalize peaks to 0..1 range
        const maxPeak = Math.max(...peaks, 0.01);
        const normalized = peaks.map(p => Math.max(0.1, p / maxPeak));
        setAudioBufferData(normalized);
        ctx.close().catch(() => {});
      } catch (err) {
        if (!isCancelled) {
          const fallback = Array.from({ length: 60 }, (_, i) => 
            Math.max(0.15, Math.abs(Math.sin(i * 0.2) * 0.8 + Math.sin(i * 0.1) * 0.2))
          );
          setAudioBufferData(fallback);
        }
      }
    };

    generatePeaks();

    return () => {
      isCancelled = true;
    };
  }, [isPackDemo, currentSound?.previewUrl]);

  // Sync isLooping to audio element
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.loop = !!isLooping;
    }
  }, [isLooping]);

  // Draw interactive Waveform onto Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audioBufferData) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const bars = audioBufferData;
    const barCount = bars.length;
    const barWidth = Math.max(2, (width / barCount) - 2);
    const progress = duration > 0 ? (currentTime / duration) : 0;
    const activeBarIndex = Math.floor(progress * barCount);

    ctx.clearRect(0, 0, width, height);

    bars.forEach((peak, index) => {
      const x = index * (barWidth + 2);
      const barHeight = Math.max(4, peak * (height - 4));
      const y = (height - barHeight) / 2;

      if (index <= activeBarIndex) {
        const grad = ctx.createLinearGradient(0, y, 0, y + barHeight);
        grad.addColorStop(0, '#06b6d4');
        grad.addColorStop(1, '#7c3aed');
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = '#4b5563'; // Muted grey for unplayed
      }

      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, 2);
      ctx.fill();
    });
  }, [audioBufferData, currentTime, duration]);

  // Handle Seeking / Timeline Scrubbing
  const handleTimelineClick = (e) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, clickX / rect.width));
    const targetTime = percentage * duration;
    audioRef.current.currentTime = targetTime;
    setCurrentTime(targetTime);
  };

  const handleTimelineMouseMove = (e) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(1, mouseX / rect.width));
    setHoverPosition({
      percent: percent * 100,
      time: formatTime(percent * duration),
      pixelX: mouseX
    });
  };

  const handleTimelineMouseLeave = () => {
    setHoverPosition(null);
  };

  // Toggle Mute / Unmute
  const handleToggleMute = () => {
    if (safeVolume > 0) {
      setPrevVolume(safeVolume);
      setVolume(0);
    } else {
      setVolume(prevVolume || 0.8);
    }
  };

  // Format mm:ss time display safely
  const formatTime = (secs) => {
    if (!secs || isNaN(secs) || secs === Infinity || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // If not a pack demo, DO NOT render the bottom player bar!
  if (!isPackDemo) {
    return null;
  }

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="player-bar">
      {/* Pack Demo Audio Node */}
      <audio 
        ref={audioRef}
        onTimeUpdate={() => {
          if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
            const d = audioRef.current.duration;
            if (d && !isNaN(d) && isFinite(d) && d > 0) {
              setDuration(d);
            }
          }
        }}
        onLoadedMetadata={() => {
          if (audioRef.current) {
            const d = audioRef.current.duration;
            if (d && !isNaN(d) && isFinite(d) && d > 0) {
              setDuration(d);
            }
          }
        }}
        onEnded={() => {
          if (!isLooping && setIsPlaying) {
            setIsPlaying(false);
          }
        }}
      />

      {/* Left: Pack Demo Track Metadata */}
      <div className="player-left">
        {currentSound.coverArtUrl ? (
          <img 
            src={currentSound.coverArtUrl} 
            alt="Pack Art" 
            className="player-pack-art" 
            style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: '8px', flexShrink: 0 }}
          />
        ) : (
          <div className="player-pack-art" style={{ width: '48px', height: '48px', flexShrink: 0 }}>
            <Music size={20} />
          </div>
        )}
        <div className="player-meta">
          <span className="player-title" title={currentSound.name}>
            {currentSound.name}
          </span>
          <span className="player-subtitle">
            {currentSound.pack || 'Pack Preview Demo'}
          </span>
        </div>
      </div>

      {/* Center: Controls, Scrubber & Waveform */}
      <div className="player-center">
        {/* Play/Pause & Actions Buttons */}
        <div className="player-controls">
          {onPrevious && (
            <button className="control-btn" onClick={onPrevious} title="Previous Track">
              <SkipBack size={16} />
            </button>
          )}

          <button 
            className="control-btn main-play"
            onClick={() => setIsPlaying && setIsPlaying(!isPlaying)}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause size={18} fill="currentColor" />
            ) : (
              <Play size={18} fill="currentColor" style={{ marginLeft: '2px' }} />
            )}
          </button>

          {onNext && (
            <button className="control-btn" onClick={onNext} title="Next Track">
              <SkipForward size={16} />
            </button>
          )}

          <button 
            className={`control-btn ${isLooping ? 'active' : ''}`}
            onClick={() => setIsLooping && setIsLooping(!isLooping)}
            title="Toggle Repeat"
          >
            <Repeat size={14} />
          </button>
        </div>

        {/* Dynamic Waveform Visualizer & Seek Timeline */}
        <div className="player-timeline-wrapper">
          <span className="time-label">{formatTime(currentTime)}</span>

          <div 
            className="player-waveform-scrubber"
            onClick={handleTimelineClick}
            onMouseMove={handleTimelineMouseMove}
            onMouseLeave={handleTimelineMouseLeave}
            title="Click to seek demo"
          >
            {/* Waveform Canvas */}
            <canvas 
              ref={canvasRef} 
              width={420} 
              height={26} 
              className="player-waveform-canvas"
            />

            {/* Glowing Playhead Line */}
            <div 
              className="player-scrub-cursor"
              style={{ left: `${progressPercent}%` }}
            />

            {/* Hover Timestamp Tooltip */}
            {hoverPosition && (
              <div 
                className="player-hover-tooltip"
                style={{ left: `${hoverPosition.pixelX}px` }}
              >
                {hoverPosition.time}
              </div>
            )}
          </div>

          <span className="time-label">{formatTime(duration)}</span>
        </div>
      </div>

      {/* Right: Master Volume Control Slider & Analyser Trigger */}
      <div className="player-right" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {currentSound && (
          <button
            onClick={() => onOpenAnalyser && onOpenAnalyser(currentSound)}
            title="Open track in Wavely Demo Analyser to isolate samples"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 12px',
              borderRadius: '8px',
              border: '1px solid rgba(6, 182, 212, 0.4)',
              background: 'rgba(6, 182, 212, 0.15)',
              color: '#38bdf8',
              fontSize: '0.75rem',
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            <Activity size={13} color="#06b6d4" />
            <span>Open in Analyser</span>
          </button>
        )}

        <div className="volume-container">
          <button 
            className="volume-icon-btn"
            onClick={handleToggleMute}
            title={safeVolume === 0 ? 'Unmute' : 'Mute'}
          >
            {safeVolume === 0 ? (
              <VolumeX size={16} color="#ef4444" />
            ) : safeVolume < 0.5 ? (
              <Volume1 size={16} color="var(--text-main)" />
            ) : (
              <Volume2 size={16} color="var(--text-main)" />
            )}
          </button>

          <input 
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={safeVolume}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (setVolume) setVolume(val);
            }}
            className="volume-slider"
            style={{
              background: `linear-gradient(to right, #dfff00 0%, #dfff00 ${safeVolume * 100}%, rgba(255, 255, 255, 0.15) ${safeVolume * 100}%, rgba(255, 255, 255, 0.15) 100%)`
            }}
          />
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', minWidth: '32px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {Math.round(safeVolume * 100)}%
          </span>
        </div>
      </div>
    </div>
  );
}
