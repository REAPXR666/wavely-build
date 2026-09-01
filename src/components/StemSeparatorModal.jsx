import React, { useState, useEffect, useRef } from 'react';
import { 
  X, Play, Pause, Download, FolderOpen, Loader2, Sparkles, Volume2, 
  VolumeX, CheckCircle2, Layers, Cpu, Music2, Disc3, Award
} from 'lucide-react';

export default function StemSeparatorModal({ sound, onClose, showToast }) {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('Initializing AI neural network...');
  const [stemsData, setStemsData] = useState(null);
  const [error, setError] = useState(null);

  // Mixer playback states
  const [isPlayingAll, setIsPlayingAll] = useState(false);
  const [activeStemPlaying, setActiveStemPlaying] = useState(null);
  const [muteStates, setMuteStates] = useState({ drums: false, bass: false, vocals: false, other: false });
  const [soloStem, setSoloStem] = useState(null);
  const [volumeLevels, setVolumeLevels] = useState({ drums: 0.8, bass: 0.8, vocals: 0.8, other: 0.8 });

  const audioRefs = {
    drums: useRef(null),
    bass: useRef(null),
    vocals: useRef(null),
    other: useRef(null)
  };

  useEffect(() => {
    if (!sound) return;

    let isMounted = true;

    const startSeparation = async () => {
      setLoading(true);
      setProgress(5);
      setError(null);
      setStatusMessage('Preparing sample audio for Demucs...');

      // Subscribe to live IPC progress
      let unsubscribeProgress = null;
      if (window.electron?.onDemucsProgress) {
        unsubscribeProgress = window.electron.onDemucsProgress((data) => {
          if (!isMounted) return;
          if (typeof data.percent === 'number') setProgress(data.percent);
          if (data.message) setStatusMessage(data.message);
        });
      }

      try {
        const audioSrc = sound.filePath || sound.previewUrl || sound._capturedFilePath;
        const res = await window.electron.separateAudioStems({
          audioPath: audioSrc,
          sampleName: sound.name,
          sampleUuid: sound.uuid || sound.id
        });

        if (res?.success) {
          if (isMounted) {
            setStemsData(res);
            setLoading(false);
            setProgress(100);
            if (showToast) showToast('✨ 4-Stem AI Separation Completed!', 'success');
          }
        } else {
          throw new Error(res?.error || 'Stem separation failed');
        }
      } catch (err) {
        console.error('Stem separation error:', err);
        if (isMounted) {
          setError(err.message || 'AI Stem separation error');
          setLoading(false);
        }
      } finally {
        if (unsubscribeProgress) unsubscribeProgress();
      }
    };

    startSeparation();

    return () => {
      isMounted = false;
      Object.values(audioRefs).forEach(ref => {
        if (ref.current) {
          ref.current.pause();
          ref.current.src = '';
        }
      });
    };
  }, [sound]);

  // Master Play / Pause All Stems synchronized
  const togglePlayAll = () => {
    const nextPlay = !isPlayingAll;
    setIsPlayingAll(nextPlay);

    Object.keys(audioRefs).forEach(key => {
      const audio = audioRefs[key].current;
      if (audio) {
        if (nextPlay) {
          const isMuted = muteStates[key] || (soloStem && soloStem !== key);
          audio.volume = isMuted ? 0 : volumeLevels[key];
          audio.currentTime = 0;
          audio.play().catch(e => console.warn(`Play error ${key}:`, e));
        } else {
          audio.pause();
        }
      }
    });
  };

  // Toggle Solo for a single stem
  const toggleSolo = (stemKey) => {
    const nextSolo = soloStem === stemKey ? null : stemKey;
    setSoloStem(nextSolo);

    Object.keys(audioRefs).forEach(key => {
      const audio = audioRefs[key].current;
      if (audio) {
        const isMuted = muteStates[key] || (nextSolo && nextSolo !== key);
        audio.volume = isMuted ? 0 : volumeLevels[key];
      }
    });
  };

  // Toggle Mute for a single stem
  const toggleMute = (stemKey) => {
    const nextMutes = { ...muteStates, [stemKey]: !muteStates[stemKey] };
    setMuteStates(nextMutes);

    const audio = audioRefs[stemKey].current;
    if (audio) {
      const isMuted = nextMutes[stemKey] || (soloStem && soloStem !== stemKey);
      audio.volume = isMuted ? 0 : volumeLevels[stemKey];
    }
  };

  const handleDragStart = (e, stemPath, stemName) => {
    e.stopPropagation();
    if (window.electron?.startDrag && stemPath) {
      window.electron.startDrag(stemPath);
    } else {
      e.dataTransfer.setData('DownloadURL', `audio/wav:${stemName}.wav:${stemPath}`);
    }
  };

  const stemConfigs = [
    { key: 'drums', label: 'Drums & Percussion', icon: '🥁', color: '#f59e0b' },
    { key: 'bass', label: 'Sub & Bassline', icon: '🎸', color: '#8b5cf6' },
    { key: 'vocals', label: 'Lead & Backing Vocals', icon: '🎤', color: '#06b6d4' },
    { key: 'other', label: 'Melody & Synths', icon: '🎹', color: '#10b981' }
  ];

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', position: 'fixed', inset: 0 }}>
      <div 
        className="modal-content" 
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '780px',
          maxWidth: '95vw',
          maxHeight: '90vh',
          backgroundColor: '#0f172a',
          border: '1px solid rgba(124, 58, 237, 0.35)',
          borderRadius: '16px',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 60px -15px rgba(0,0,0,0.9), 0 0 40px rgba(124, 58, 237, 0.2)',
          overflow: 'hidden',
          color: '#f8fafc'
        }}
      >
        {/* Modal Header */}
        <div style={{ padding: '18px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'linear-gradient(135deg, #7c3aed, #06b6d4)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(124, 58, 237, 0.4)' }}>
              <Sparkles size={20} color="#ffffff" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, letterSpacing: '-0.02em' }}>Wavely AI Stem Studio</h2>
                <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '9999px', background: 'rgba(6, 182, 212, 0.15)', color: '#06b6d4', border: '1px solid rgba(6, 182, 212, 0.3)', fontWeight: 700 }}>
                  DEMUCS GPU V4
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#94a3b8' }}>
                Separating <strong style={{ color: '#e2e8f0' }}>{sound?.name}</strong> into 4 isolated audio tracks
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '6px', borderRadius: '8px', transition: 'all 0.15s' }}
            onMouseEnter={(e) => e.currentTarget.style.color = '#fff'}
            onMouseLeave={(e) => e.currentTarget.style.color = '#94a3b8'}
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Progress / Loading State */}
          {loading && (
            <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '30px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
              <div style={{ position: 'relative', width: '60px', height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Loader2 size={50} className="spin-animation" color="#7c3aed" />
                <Cpu size={22} color="#06b6d4" style={{ position: 'absolute' }} />
              </div>
              <div>
                <h3 style={{ margin: '0 0 6px 0', fontSize: '1.05rem', fontWeight: 700 }}>{statusMessage}</h3>
                <p style={{ margin: 0, fontSize: '0.8rem', color: '#94a3b8' }}>Neural network deep learning separation in progress...</p>
              </div>

              {/* Progress Bar */}
              <div style={{ width: '100%', maxWidth: '400px', height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '9999px', overflow: 'hidden', position: 'relative' }}>
                <div style={{ width: `${progress}%`, height: '100%', background: 'linear-gradient(90deg, #7c3aed, #06b6d4)', transition: 'width 0.3s ease', borderRadius: '9999px' }} />
              </div>
              <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#06b6d4' }}>{progress}%</span>
            </div>
          )}

          {/* Error State */}
          {error && (
            <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '12px', padding: '16px', color: '#fca5a5', fontSize: '0.85rem' }}>
              <strong>Stem Separation Error:</strong> {error}
            </div>
          )}

          {/* Separated 4-Stem Mixer Channels */}
          {!loading && stemsData && stemsData.stems && (
            <>
              {/* Master Controls Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '12px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button
                    onClick={togglePlayAll}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 18px',
                      borderRadius: '8px',
                      border: 'none',
                      background: isPlayingAll ? '#ef4444' : 'linear-gradient(135deg, #7c3aed, #06b6d4)',
                      color: '#ffffff',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px rgba(124, 58, 237, 0.3)'
                    }}
                  >
                    {isPlayingAll ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                    <span>{isPlayingAll ? 'Stop All Stems' : 'Audition Full Mix'}</span>
                  </button>
                  <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                    Drag individual stems directly into your DAW arrangement
                  </span>
                </div>

                <button
                  onClick={() => {
                    if (window.electron?.openStemsFolder && stemsData.outputDir) {
                      window.electron.openStemsFolder(stemsData.outputDir);
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.15)',
                    background: 'rgba(255,255,255,0.05)',
                    color: '#f8fafc',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  <FolderOpen size={15} />
                  <span>Open Stems Folder</span>
                </button>
              </div>

              {/* 4 Stems Channels */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {stemConfigs.map(cfg => {
                  const stemPath = stemsData.stems[cfg.key];
                  const isMuted = muteStates[cfg.key] || (soloStem && soloStem !== cfg.key);
                  const isSolo = soloStem === cfg.key;
                  const stemFileUrl = stemPath ? `file:///${stemPath.replace(/\\/g, '/')}` : '';

                  return (
                    <div 
                      key={cfg.key}
                      style={{
                        background: 'rgba(0,0,0,0.35)',
                        border: `1px solid ${isSolo ? cfg.color : 'rgba(255,255,255,0.08)'}`,
                        borderRadius: '12px',
                        padding: '12px 18px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '16px',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <audio ref={audioRefs[cfg.key]} src={stemFileUrl} loop />

                      {/* Stem Label */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: '180px' }}>
                        <span style={{ fontSize: '1.3rem' }}>{cfg.icon}</span>
                        <div>
                          <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: cfg.color }}>{cfg.label}</h4>
                          <span style={{ fontSize: '0.72rem', color: '#64748b' }}>16-Bit WAV • Studio Clean</span>
                        </div>
                      </div>

                      {/* Solo / Mute Controls */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <button
                          onClick={() => toggleSolo(cfg.key)}
                          style={{
                            padding: '4px 10px',
                            borderRadius: '6px',
                            border: '1px solid',
                            borderColor: isSolo ? '#fbbf24' : 'rgba(255,255,255,0.15)',
                            background: isSolo ? '#fbbf24' : 'transparent',
                            color: isSolo ? '#000000' : '#cbd5e1',
                            fontWeight: 800,
                            fontSize: '0.72rem',
                            cursor: 'pointer'
                          }}
                        >
                          SOLO
                        </button>
                        <button
                          onClick={() => toggleMute(cfg.key)}
                          style={{
                            padding: '4px 10px',
                            borderRadius: '6px',
                            border: '1px solid',
                            borderColor: muteStates[cfg.key] ? '#ef4444' : 'rgba(255,255,255,0.15)',
                            background: muteStates[cfg.key] ? '#ef4444' : 'transparent',
                            color: muteStates[cfg.key] ? '#ffffff' : '#cbd5e1',
                            fontWeight: 800,
                            fontSize: '0.72rem',
                            cursor: 'pointer'
                          }}
                        >
                          MUTE
                        </button>
                      </div>

                      {/* DAW Drag-and-Drop & Download Handle */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                          draggable="true"
                          onDragStart={(e) => handleDragStart(e, stemPath, `${sound.name}_${cfg.key}`)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '6px 14px',
                            borderRadius: '8px',
                            background: 'rgba(16, 185, 129, 0.15)',
                            border: '1px solid rgba(16, 185, 129, 0.35)',
                            color: '#34d399',
                            fontWeight: 700,
                            fontSize: '0.78rem',
                            cursor: 'grab'
                          }}
                          title="Drag this separated stem into FL Studio / Ableton / Logic"
                        >
                          <CheckCircle2 size={14} />
                          <span>DRAG TO DAW</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

        </div>

        {/* Modal Footer */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
            Generated stems saved in <code style={{ color: '#94a3b8' }}>/Wavely/Stems/</code>
          </span>
          <button
            onClick={onClose}
            style={{
              padding: '8px 20px',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.08)',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: 'pointer'
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
