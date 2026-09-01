import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, Pause, SlidersHorizontal, Sparkles, Download, CheckCircle2, 
  FolderOpen, Music, Search, Disc3, Layers, Clock, Award, Activity, Scissors, Cpu
} from 'lucide-react';
import WaveSurfer from 'wavesurfer.js';
import { identifySamplesInSection, formatTime, parseTime } from '../utils/audioAnalyser';
import StemSeparatorModal from '../components/StemSeparatorModal';
import SampleSlicerModal from '../components/SampleSlicerModal';

export default function AnalyserPage({ 
  user,
  subscription,
  showToast,
  volume = 0.8
}) {
  const [demoPacks, setDemoPacks] = useState([]);
  const [selectedPack, setSelectedPack] = useState(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(180); // seconds
  const [currentTime, setCurrentTime] = useState(0);

  // Time Range Selection (e.g. 01:35 to 02:15)
  const [startSec, setStartSec] = useState(30);
  const [endSec, setEndSec] = useState(75);

  // Analysis & Identified Samples States
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [identifiedSamples, setIdentifiedSamples] = useState([]);
  const [hasAnalysed, setHasAnalysed] = useState(false);

  // Active playing identified sample
  const [activePlayingSampleId, setActivePlayingSampleId] = useState(null);
  const sampleAudioRef = useRef(new Audio());

  // Stems & Slicer Modals
  const [stemModalSound, setStemModalSound] = useState(null);
  const [slicerSound, setSlicerSound] = useState(null);

  const containerRef = useRef(null);
  const wavesurferRef = useRef(null);

  // Load sample packs on mount
  useEffect(() => {
    const loadPacks = async () => {
      try {
        if (window.electron?.searchSounds) {
          const results = await window.electron.searchSounds('', { startPage: 1, endPage: 2 });
          // Group by packName
          const packMap = new Map();
          results.forEach(s => {
            const pName = s.packName || s.source || 'Electronic Essentials';
            if (!packMap.has(pName)) {
              packMap.set(pName, {
                name: pName,
                coverArtUrl: s.coverArtUrl || s.artworkUrl || '',
                previewUrl: s.previewUrl || '',
                samples: []
              });
            }
            packMap.get(pName).samples.push(s);
          });

          const pList = Array.from(packMap.values());
          setDemoPacks(pList);
          if (pList.length > 0) {
            setSelectedPack(pList[0]);
            setAudioUrl(pList[0].previewUrl || '');
          }
        }
      } catch (err) {
        console.error('Failed to load packs for analyser:', err);
      }
    };
    loadPacks();
  }, []);

  // Initialize WaveSurfer for the demo audio
  useEffect(() => {
    if (!containerRef.current || !audioUrl) return;

    if (wavesurferRef.current) {
      try {
        wavesurferRef.current.destroy();
      } catch (e) {}
    }

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#475569',
      progressColor: '#06b6d4',
      cursorColor: '#7c3aed',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 2,
      height: 70,
      normalize: true,
      fillParent: true,
      interact: true,
      backend: 'WebAudio',
      url: audioUrl
    });

    ws.on('ready', () => {
      const dur = ws.getDuration() || 180;
      setDuration(dur);
      setStartSec(Math.min(30, Math.floor(dur * 0.2)));
      setEndSec(Math.min(dur, Math.floor(dur * 0.5)));
    });

    ws.on('audioprocess', (time) => {
      setCurrentTime(time);
    });

    ws.on('finish', () => {
      setIsPlaying(false);
    });

    wavesurferRef.current = ws;

    return () => {
      try {
        ws.destroy();
      } catch (e) {}
    };
  }, [audioUrl]);

  const togglePlayDemo = () => {
    if (!wavesurferRef.current) return;
    if (isPlaying) {
      wavesurferRef.current.pause();
      setIsPlaying(false);
    } else {
      wavesurferRef.current.play();
      setIsPlaying(true);
    }
  };

  const playSelectedRegionOnly = () => {
    if (!wavesurferRef.current) return;
    wavesurferRef.current.setTime(startSec);
    wavesurferRef.current.play();
    setIsPlaying(true);
  };

  // Run AI Sample Identification on the selected timeframe
  const handleRunAnalysis = async () => {
    setIsAnalysing(true);
    setHasAnalysed(false);

    try {
      // Collect candidate sounds from the selected pack or broader catalog
      let candidates = selectedPack ? selectedPack.samples : [];
      if (candidates.length < 20 && window.electron?.searchSounds) {
        const extra = await window.electron.searchSounds('', { startPage: 1, endPage: 2 });
        candidates = [...candidates, ...extra];
      }

      const results = identifySamplesInSection(null, candidates, {
        startSec: startSec,
        endSec: endSec,
        packName: selectedPack?.name || '',
        minConfidence: 60
      });

      setTimeout(() => {
        setIdentifiedSamples(results);
        setIsAnalysing(false);
        setHasAnalysed(true);
        if (showToast) {
          showToast(`🎯 Identified ${results.length} samples in section [${formatTime(startSec)} - ${formatTime(endSec)}]!`, 'success');
        }
      }, 700);
    } catch (err) {
      console.error('Analysis error:', err);
      setIsAnalysing(false);
      if (showToast) showToast('Failed to analyze section', 'error');
    }
  };

  const handlePlaySample = (sound) => {
    if (activePlayingSampleId === sound.id) {
      sampleAudioRef.current.pause();
      setActivePlayingSampleId(null);
    } else {
      sampleAudioRef.current.src = sound.filePath ? `file:///${sound.filePath.replace(/\\/g, '/')}` : sound.previewUrl;
      sampleAudioRef.current.volume = volume;
      sampleAudioRef.current.play().catch(e => console.warn('Preview play error:', e));
      setActivePlayingSampleId(sound.id);
      sampleAudioRef.current.onended = () => setActivePlayingSampleId(null);
    }
  };

  const handleDragStart = (e, sound) => {
    e.stopPropagation();
    if (window.electron?.startDrag && sound.filePath) {
      window.electron.startDrag(sound.filePath);
    } else {
      e.dataTransfer.setData('DownloadURL', `audio/wav:${sound.name}.wav:${sound.filePath || sound.previewUrl}`);
    }
  };

  return (
    <div className="analyser-page-container" style={{ padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: '24px', color: '#f8fafc' }}>
      
      {/* Header Banner */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: 'linear-gradient(135deg, #06b6d4, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 20px rgba(6, 182, 212, 0.3)' }}>
            <Activity size={24} color="#ffffff" />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-0.02em' }}>Wavely Demo Analyser</h1>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Pinpoint, isolate, and drag individual samples directly out of full pack demos & song arrangements
            </p>
          </div>
        </div>
      </div>

      {/* Main Studio Workstation Card */}
      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        
        {/* Pack Selector Row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-muted)' }}>Source Demo:</span>
            <select
              value={selectedPack?.name || ''}
              onChange={(e) => {
                const p = demoPacks.find(x => x.name === e.target.value);
                if (p) {
                  setSelectedPack(p);
                  setAudioUrl(p.previewUrl || '');
                }
              }}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                background: 'var(--bg-hover)',
                border: '1px solid var(--border-color)',
                color: '#f8fafc',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer'
              }}
            >
              {demoPacks.map(p => (
                <option key={p.name} value={p.name}>{p.name} (Official Demo)</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
              Current Playhead: <strong style={{ color: '#06b6d4' }}>{formatTime(currentTime)}</strong> / {formatTime(duration)}
            </span>
          </div>
        </div>

        {/* Master Waveform Timeline */}
        <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '16px', position: 'relative' }}>
          <div ref={containerRef} style={{ width: '100%' }} />

          {/* Range Overlay Highlight */}
          <div style={{
            position: 'absolute',
            top: '16px',
            bottom: '16px',
            left: `${(startSec / Math.max(1, duration)) * 100}%`,
            width: `${((endSec - startSec) / Math.max(1, duration)) * 100}%`,
            background: 'rgba(6, 182, 212, 0.15)',
            borderLeft: '2px solid #06b6d4',
            borderRight: '2px solid #7c3aed',
            pointerEvents: 'none'
          }} />
        </div>

        {/* Time Region Selector & Controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px', background: 'rgba(255,255,255,0.02)', padding: '14px 18px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
          
          {/* Playback Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={togglePlayDemo}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                background: isPlaying ? '#ef4444' : 'linear-gradient(135deg, #7c3aed, #06b6d4)',
                color: '#fff',
                fontWeight: 700,
                fontSize: '0.82rem',
                cursor: 'pointer'
              }}
            >
              {isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
              <span>{isPlaying ? 'Pause Demo' : 'Play Demo'}</span>
            </button>

            <button
              onClick={playSelectedRegionOnly}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                borderRadius: '8px',
                border: '1px solid rgba(6, 182, 212, 0.35)',
                background: 'rgba(6, 182, 212, 0.12)',
                color: '#06b6d4',
                fontWeight: 700,
                fontSize: '0.82rem',
                cursor: 'pointer'
              }}
            >
              <Clock size={14} />
              <span>Audition Selected Region</span>
            </button>
          </div>

          {/* Dual Time Sliders */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>From:</span>
              <input 
                type="range"
                min="0"
                max={Math.max(1, endSec - 1)}
                value={startSec}
                onChange={(e) => setStartSec(parseFloat(e.target.value))}
                style={{ width: '100px', accentColor: '#06b6d4' }}
              />
              <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#06b6d4', minWidth: '42px' }}>{formatTime(startSec)}</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>To:</span>
              <input 
                type="range"
                min={startSec + 1}
                max={Math.max(startSec + 1, duration)}
                value={endSec}
                onChange={(e) => setEndSec(parseFloat(e.target.value))}
                style={{ width: '100px', accentColor: '#7c3aed' }}
              />
              <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#7c3aed', minWidth: '42px' }}>{formatTime(endSec)}</span>
            </div>
          </div>

          {/* Analyse Trigger Button */}
          <button
            onClick={handleRunAnalysis}
            disabled={isAnalysing}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 22px',
              borderRadius: '10px',
              border: 'none',
              background: 'linear-gradient(135deg, #10b981, #06b6d4)',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: '0.88rem',
              cursor: isAnalysing ? 'not-allowed' : 'pointer',
              boxShadow: '0 4px 16px rgba(16, 185, 129, 0.35)'
            }}
          >
            {isAnalysing ? <Loader2 size={16} className="spin-animation" /> : <Sparkles size={16} />}
            <span>{isAnalysing ? 'Analysing Waveforms...' : '🔬 Identify Samples in Section'}</span>
          </button>
        </div>

      </div>

      {/* Identified Samples Results Section */}
      {hasAnalysed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span>🎯 Identified Samples in Section</span>
              <span style={{ fontSize: '0.78rem', background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '2px 10px', borderRadius: '9999px' }}>
                {identifiedSamples.length} Matches Found
              </span>
            </h2>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Timeframe: <strong style={{ color: '#f8fafc' }}>{formatTime(startSec)} - {formatTime(endSec)}</strong>
            </span>
          </div>

          {/* Identified Samples Table */}
          <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '16px', overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '44px 2.5fr 1.2fr 1fr 1fr 180px', padding: '12px 18px', borderBottom: '1px solid var(--border-color)', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              <div>Play</div>
              <div>Sample Name</div>
              <div>Category</div>
              <div>Confidence</div>
              <div>Appears At</div>
              <div style={{ textAlign: 'right' }}>Actions</div>
            </div>

            {identifiedSamples.map(sound => {
              const isSamplePlaying = activePlayingSampleId === sound.id;

              return (
                <div 
                  key={sound.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '44px 2.5fr 1.2fr 1fr 1fr 180px',
                    padding: '12px 18px',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    alignItems: 'center',
                    background: isSamplePlaying ? 'rgba(6, 182, 212, 0.08)' : 'transparent',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {/* Play Button */}
                  <div>
                    <button
                      onClick={() => handlePlaySample(sound)}
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        border: 'none',
                        background: isSamplePlaying ? '#06b6d4' : 'rgba(255,255,255,0.1)',
                        color: isSamplePlaying ? '#000' : '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer'
                      }}
                    >
                      {isSamplePlaying ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" style={{ marginLeft: '1px' }} />}
                    </button>
                  </div>

                  {/* Sample Name */}
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.88rem', color: '#f8fafc' }}>{sound.name}</span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{sound.key || 'C Maj'} • {sound.bpm || 128} BPM</span>
                  </div>

                  {/* Category Tag */}
                  <div>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: '6px', background: 'rgba(124, 58, 237, 0.15)', color: '#a78bfa', border: '1px solid rgba(124, 58, 237, 0.3)' }}>
                      {sound.category || 'Sample'}
                    </span>
                  </div>

                  {/* Match Confidence */}
                  <div>
                    <span style={{ fontWeight: 800, fontSize: '0.82rem', color: sound.confidence > 85 ? '#34d399' : '#38bdf8' }}>
                      {sound.confidence}% Match
                    </span>
                  </div>

                  {/* Occurrence Timestamp */}
                  <div>
                    <span style={{ fontSize: '0.8rem', color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Clock size={12} color="#06b6d4" />
                      <span>~{sound.timestampFormatted}</span>
                    </span>
                  </div>

                  {/* Actions (Stems, Slicer, Drag to DAW) */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                    {/* Create Stems Button */}
                    <button
                      onClick={() => setStemModalSound(sound)}
                      title="Separate sample into 4 AI stems with Demucs"
                      style={{
                        padding: '4px 8px',
                        borderRadius: '6px',
                        border: '1px solid rgba(124, 58, 237, 0.3)',
                        background: 'rgba(124, 58, 237, 0.12)',
                        color: '#a78bfa',
                        cursor: 'pointer'
                      }}
                    >
                      <Cpu size={13} />
                    </button>

                    {/* Slicer Button */}
                    <button
                      onClick={() => setSlicerSound(sound)}
                      title="Chop and slice in Transient Slicer"
                      style={{
                        padding: '4px 8px',
                        borderRadius: '6px',
                        border: '1px solid rgba(56, 189, 248, 0.3)',
                        background: 'rgba(56, 189, 248, 0.12)',
                        color: '#38bdf8',
                        cursor: 'pointer'
                      }}
                    >
                      <Scissors size={13} />
                    </button>

                    {/* DAW Drag Handle */}
                    <button
                      draggable="true"
                      onDragStart={(e) => handleDragStart(e, sound)}
                      title="Drag into your DAW"
                      style={{
                        padding: '4px 10px',
                        borderRadius: '6px',
                        border: '1px solid rgba(16, 185, 129, 0.35)',
                        background: 'rgba(16, 185, 129, 0.15)',
                        color: '#34d399',
                        fontWeight: 700,
                        fontSize: '0.72rem',
                        cursor: 'grab'
                      }}
                    >
                      DRAG TO DAW
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Stem Separator Modal */}
      {stemModalSound && (
        <StemSeparatorModal
          sound={stemModalSound}
          onClose={() => setStemModalSound(null)}
          showToast={showToast}
        />
      )}

      {/* Transient Slicer Modal */}
      {slicerSound && (
        <SampleSlicerModal
          sound={slicerSound}
          onClose={() => setSlicerSound(null)}
          showToast={showToast}
        />
      )}

    </div>
  );
}
