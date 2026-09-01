import React, { useState } from 'react';
import { 
  Play, Pause, Maximize2, Search, Volume2, 
  Sparkles, Sliders, Music2, Move, ExternalLink 
} from 'lucide-react';

export default function MiniDockPlayer({ 
  currentSound, 
  isPlaying, 
  setIsPlaying, 
  onExitMiniDock, 
  onSearch, 
  pitchSemitones, 
  setPitchSemitones, 
  speedMultiplier, 
  setSpeedMultiplier 
}) {
  const [query, setQuery] = useState('');

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (onSearch) onSearch(query);
  };

  const handleDragStart = (e) => {
    if (currentSound?.filePath && window.electron?.startDrag) {
      e.preventDefault();
      window.electron.startDrag(currentSound.filePath);
    }
  };

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: '#090d16',
      color: '#f8fafc',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: '10px 14px',
      boxSizing: 'border-box',
      userSelect: 'none',
      overflow: 'hidden',
      border: '1px solid #1e293b'
    }}>
      {/* Top Controls Row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }} />
          <span style={{ fontSize: '0.75rem', fontWeight: '800', letterSpacing: '0.5px', color: '#38bdf8' }}>
            WAVELY DOCK
          </span>
        </div>

        {/* Compact Search Bar */}
        <form onSubmit={handleSearchSubmit} style={{ flex: 1, margin: '0 8px' }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input 
              type="text"
              placeholder="Quick search samples..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{
                width: '100%',
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '4px',
                padding: '4px 8px 4px 24px',
                fontSize: '0.78rem',
                color: '#f8fafc',
                outline: 'none'
              }}
            />
            <Search size={12} style={{ position: 'absolute', left: '7px', color: '#64748b' }} />
          </div>
        </form>

        {/* Exit Mini Dock back to Full App */}
        <button
          onClick={onExitMiniDock}
          title="Restore Full App Window"
          style={{
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '4px',
            color: '#94a3b8',
            padding: '4px 8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '0.72rem'
          }}
        >
          <Maximize2 size={12} />
          <span>Full</span>
        </button>
      </div>

      {/* Bottom Sample Info & Playback */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
        {/* Play/Pause Button */}
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          disabled={!currentSound}
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            background: isPlaying ? '#10b981' : '#38bdf8',
            border: 'none',
            color: '#000000',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: currentSound ? 'pointer' : 'default',
            opacity: currentSound ? 1 : 0.4
          }}
        >
          {isPlaying ? <Pause size={15} fill="#000000" /> : <Play size={15} fill="#000000" style={{ marginLeft: '2px' }} />}
        </button>

        {/* Active Sound Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: '0.82rem',
            fontWeight: '700',
            color: '#f8fafc',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}>
            {currentSound ? currentSound.name : 'No sample selected'}
          </div>
          <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
            {currentSound ? `${currentSound.bpm || '--'} BPM • ${currentSound.key || 'No Key'} • ${currentSound.pack || 'Catalog'}` : 'Search or click a sound to audition'}
          </div>
        </div>

        {/* Pitch & Speed Modifiers */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            onClick={() => setPitchSemitones(p => Math.max(-12, p - 1))}
            style={{ padding: '2px 5px', background: '#1e293b', border: '1px solid #334155', borderRadius: '3px', color: '#cbd5e1', fontSize: '0.7rem', cursor: 'pointer' }}
          >
            -
          </button>
          <span style={{ fontSize: '0.72rem', fontWeight: '700', color: '#38bdf8', minWidth: '24px', textAlign: 'center' }}>
            {pitchSemitones > 0 ? `+${pitchSemitones}` : pitchSemitones}
          </span>
          <button
            onClick={() => setPitchSemitones(p => Math.min(12, p + 1))}
            style={{ padding: '2px 5px', background: '#1e293b', border: '1px solid #334155', borderRadius: '3px', color: '#cbd5e1', fontSize: '0.7rem', cursor: 'pointer' }}
          >
            +
          </button>
        </div>

        {/* Direct DAW Drag Handle */}
        {currentSound && (
          <div
            draggable
            onDragStart={handleDragStart}
            title="Drag directly into DAW playlist / arrangement"
            style={{
              padding: '6px 10px',
              background: '#047857',
              borderRadius: '4px',
              color: '#ffffff',
              fontSize: '0.75rem',
              fontWeight: '700',
              cursor: 'grab',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <Move size={12} />
            <span>DRAG TO DAW</span>
          </div>
        )}
      </div>
    </div>
  );
}
