import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, Pause, SlidersHorizontal, Sparkles, Download, CheckCircle2, 
  FolderOpen, Music, Search, Disc3, Layers, Clock, Award, Activity, Scissors, Cpu,
  RefreshCw, Volume2, ArrowRight, Zap, Check, UploadCloud
} from 'lucide-react';
import WaveSurfer from 'wavesurfer.js';
import { identifySamplesInSection, formatTime, parseTime } from '../utils/audioAnalyser';
import StemSeparatorModal from '../components/StemSeparatorModal';
import SampleSlicerModal from '../components/SampleSlicerModal';

const PRESET_PACKS = [
  {
    name: 'Noisia Sample Pack Vol. 1',
    artist: 'Noisia',
    coverArtUrl: 'https://splice.com/blog/wp-content/uploads/2019/06/noisia-sample-pack-vol-1-cover.jpg',
    demoUrl: 'https://cdn.splice.com/packs/noisia-vol-1-demo.mp3',
    genre: 'Drum & Bass / Bass Music'
  },
  {
    name: 'KSHMR Sounds of KSHMR Vol. 4',
    artist: 'KSHMR',
    coverArtUrl: 'https://splice.com/blog/wp-content/uploads/2021/04/sounds-of-kshmr-vol-4-cover.jpg',
    demoUrl: 'https://cdn.splice.com/packs/kshmr-vol-4-demo.mp3',
    genre: 'EDM / Dance'
  },
  {
    name: 'DECAP - Drums That Knock Vol. 9',
    artist: 'DECAP',
    coverArtUrl: 'https://splice.com/blog/wp-content/uploads/2020/11/drums-that-knock-vol-9.jpg',
    demoUrl: 'https://cdn.splice.com/packs/decap-vol-9-demo.mp3',
    genre: 'Hip Hop / Trap'
  },
  {
    name: 'Oliver: Power Tools Sample Pack III',
    artist: 'Oliver',
    coverArtUrl: 'https://splice.com/blog/wp-content/uploads/2021/09/oliver-power-tools-vol-3.jpg',
    demoUrl: 'https://cdn.splice.com/packs/oliver-vol-3-demo.mp3',
    genre: 'Synthwave / Pop'
  },
  {
    name: 'Virtual Riot - Heavy Bass Design Vol. 2',
    artist: 'Virtual Riot',
    coverArtUrl: 'https://splice.com/blog/wp-content/uploads/2020/05/virtual-riot-heavy-bass.jpg',
    demoUrl: 'https://cdn.splice.com/packs/virtual-riot-vol-2-demo.mp3',
    genre: 'Dubstep / Bass'
  }
];

export default function AnalyserPage({ 
  user,
  subscription,
  showToast,
  volume = 0.8,
  currentSound,
  setCurrentSound,
  isPlaying: isGlobalPlaying,
  setIsPlaying: setIsGlobalPlaying,
  setActiveTab
}) {
  const [demoPacks, setDemoPacks] = useState(PRESET_PACKS);
  const [selectedPackName, setSelectedPackName] = useState('');
  const [packTitle, setPackTitle] = useState('Active Demo Track');
  const [coverArtUrl, setCoverArtUrl] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(180); // seconds
  const [currentTime, setCurrentTime] = useState(0);

  // Time Range Selection (e.g. 01:35 to 02:15)
  const [startSec, setStartSec] = useState(95); // 1:35 default
  const [endSec, setEndSec] = useState(135);   // 2:15 default

  // Analysis & Identified Samples States
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [identifiedSamples, setIdentifiedSamples] = useState([]);
  const [hasAnalysed, setHasAnalysed] = useState(false);
  const [packSoundsList, setPackSoundsList] = useState([]);

  // Active playing identified sample
  const [activePlayingSampleId, setActivePlayingSampleId] = useState(null);
  const sampleAudioRef = useRef(new Audio());

  // Stems & Slicer Modals
  const [stemModalSound, setStemModalSound] = useState(null);
  const [slicerSound, setSlicerSound] = useState(null);

  const containerRef = useRef(null);
  const wavesurferRef = useRef(null);

  // Load downloaded & indexed packs on mount
  useEffect(() => {
    const loadAllPacks = async () => {
      try {
        let loaded = [...PRESET_PACKS];

        if (window.electron?.getDownloadedPacks) {
          const res = await window.electron.getDownloadedPacks();
          if (res?.success && Array.isArray(res.packs)) {
            res.packs.forEach(p => {
              if (p.name && !loaded.some(x => x.name.toLowerCase() === p.name.toLowerCase())) {
                loaded.push({
                  name: p.name,
                  artist: 'Downloaded Pack',
                  coverArtUrl: p.coverArtUrl || '',
                  demoUrl: p.demoUrl || p.previewUrl || '',
                  genre: 'Local Library'
                });
              }
            });
          }
        }

        if (window.electron?.searchSounds) {
          const sounds = await window.electron.searchSounds('', { startPage: 1, endPage: 2 });
          const packMap = new Map();
          sounds.forEach(s => {
            const pName = s.packName || s.source || s.pack;
            if (pName && pName !== 'Splice' && !packMap.has(pName)) {
              packMap.set(pName, {
                name: pName,
                artist: s.artist || 'Splice Creator',
                coverArtUrl: s.coverArtUrl || s.artworkUrl || '',
                demoUrl: s.previewUrl || '',
                genre: 'Catalog Pack'
              });
            }
          });

          packMap.forEach((p, k) => {
            if (!loaded.some(x => x.name.toLowerCase() === k.toLowerCase())) {
              loaded.push(p);
            }
          });
        }

        setDemoPacks(loaded);
      } catch (err) {
        console.error('Failed to load packs for analyser:', err);
      }
    };
    loadAllPacks();
  }, []);

  // Sync with currentSound when available or changed
  useEffect(() => {
    if (currentSound && currentSound.previewUrl) {
      const pName = currentSound.packName || currentSound.pack || currentSound.name || 'Current Playing Demo';
      setSelectedPackName(pName);
      setPackTitle(pName);
      setCoverArtUrl(currentSound.artworkUrl || currentSound.coverArtUrl || '');
      setAudioUrl(currentSound.previewUrl || currentSound.filePath || '');
    } else if (demoPacks.length > 0 && !audioUrl) {
      const first = demoPacks[0];
      setSelectedPackName(first.name);
      setPackTitle(first.name);
      setCoverArtUrl(first.coverArtUrl || '');
      setAudioUrl(first.demoUrl || '');
    }
  }, [currentSound, demoPacks]);

  // Load samples strictly belonging to the selected pack
  useEffect(() => {
    if (!packTitle) return;
    const fetchPackSounds = async () => {
      try {
        if (window.electron?.getPackSamples) {
          const res = await window.electron.getPackSamples({ 
            packUuid: currentSound?.packUuid || currentSound?.uuid || null, 
            packName: packTitle 
          });
          if (res?.success && Array.isArray(res.samples)) {
            setPackSoundsList(res.samples);
            return;
          }
        }
        setPackSoundsList([]);
      } catch (err) {
        console.warn('Failed to fetch pack samples:', err);
        setPackSoundsList([]);
      }
    };
    fetchPackSounds();
  }, [packTitle, currentSound]);

  // Initialize WaveSurfer
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
      cursorColor: '#a855f7',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 2,
      height: 76,
      normalize: true,
      fillParent: true,
      interact: true,
      backend: 'WebAudio',
      url: audioUrl
    });

    ws.on('ready', () => {
      const dur = Math.round(ws.getDuration()) || 180;
      setDuration(dur);
      // Auto-set range (e.g. 1:35 to 2:15 or proportional)
      if (dur >= 140) {
        setStartSec(95); // 1:35
        setEndSec(135);  // 2:15
      } else {
        setStartSec(Math.max(0, Math.floor(dur * 0.2)));
        setEndSec(Math.min(dur, Math.floor(dur * 0.6)));
      }
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

  // Play / Pause Demo
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

  // Seek and play selected region
  const playSelectedRegionOnly = () => {
    if (!wavesurferRef.current) return;
    wavesurferRef.current.setTime(startSec);
    wavesurferRef.current.play();
    setIsPlaying(true);
  };

  // Load a pack from dropdown
  const handleSelectPack = (name) => {
    const p = demoPacks.find(x => x.name === name);
    if (p) {
      setSelectedPackName(p.name);
      setPackTitle(p.name);
      setCoverArtUrl(p.coverArtUrl || '');
      setAudioUrl(p.demoUrl || '');
      setHasAnalysed(false);
      setIdentifiedSamples([]);
    }
  };

  // Load Active track from player
  const handleLoadActiveTrack = () => {
    if (currentSound && currentSound.previewUrl) {
      const pName = currentSound.packName || currentSound.pack || currentSound.name || 'Current Track';
      setSelectedPackName(pName);
      setPackTitle(pName);
      setCoverArtUrl(currentSound.artworkUrl || currentSound.coverArtUrl || '');
      setAudioUrl(currentSound.previewUrl || currentSound.filePath || '');
      setHasAnalysed(false);
      setIdentifiedSamples([]);
      if (showToast) showToast(`Loaded "${pName}" into Analyser!`, 'success');
    }
  };

  // Run AI Acoustic Sample Identification
  const handleRunAnalysis = async () => {
    setIsAnalysing(true);
    setHasAnalysed(false);

    try {
      if (!packSoundsList || packSoundsList.length === 0) {
        setIsAnalysing(false);
        if (showToast) {
          showToast(`No samples indexed strictly for "${packTitle}".`, 'info');
        }
        return;
      }

      // STRICTLY analyze ONLY the samples from this pack
      const results = identifySamplesInSection(null, packSoundsList, {
        startSec: startSec,
        endSec: endSec,
        packName: packTitle,
        maxResults: 10
      });

      setTimeout(() => {
        setIdentifiedSamples(results);
        setIsAnalysing(false);
        setHasAnalysed(true);
        if (showToast) {
          showToast(`🎯 Identified ${results.length} samples strictly from "${packTitle}"!`, 'success');
        }
      }, 350);
    } catch (err) {
      console.error('Analysis error:', err);
      setIsAnalysing(false);
      if (showToast) showToast('Failed to analyze section', 'error');
    }
  };

  // Play candidate sample
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

  // Drag sample to DAW
  const handleDragStart = (e, sound) => {
    e.stopPropagation();
    if (window.electron?.startDrag && sound.filePath) {
      window.electron.startDrag(sound.filePath);
    } else {
      e.dataTransfer.setData('DownloadURL', `audio/wav:${sound.name}.wav:${sound.filePath || sound.previewUrl}`);
    }
  };

  // Jump demo playhead to sample timestamp
  const handleJumpToTimestamp = (sec) => {
    if (wavesurferRef.current) {
      wavesurferRef.current.setTime(sec);
      wavesurferRef.current.play();
      setIsPlaying(true);
    }
  };

  const isCurrentSoundPlaying = currentSound && currentSound.previewUrl;

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

        {/* Sync with Active Playing Demo in PlayerBar */}
        {isCurrentSoundPlaying && (
          <button
            onClick={handleLoadActiveTrack}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              borderRadius: '10px',
              border: '1px solid rgba(168, 85, 247, 0.4)',
              background: 'rgba(168, 85, 247, 0.15)',
              color: '#c084fc',
              fontSize: '0.82rem',
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(168, 85, 247, 0.2)'
            }}
          >
            <Zap size={15} color="#c084fc" />
            <span>Load Active Playing Demo ({currentSound.packName || currentSound.name})</span>
          </button>
        )}
      </div>

      {/* Main Workstation Studio Card */}
      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        
        {/* Pack Selector & Info Row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {coverArtUrl ? (
              <img 
                src={coverArtUrl} 
                alt="Pack Cover" 
                style={{ width: '48px', height: '48px', borderRadius: '8px', objectFit: 'cover', border: '1px solid rgba(255,255,255,0.1)' }} 
              />
            ) : (
              <div style={{ width: '48px', height: '48px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Music size={22} color="#94a3b8" />
              </div>
            )}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)' }}>Pack Demo:</span>
                <select
                  value={selectedPackName}
                  onChange={(e) => handleSelectPack(e.target.value)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '8px',
                    background: 'var(--bg-hover)',
                    border: '1px solid var(--border-color)',
                    color: '#f8fafc',
                    fontWeight: 700,
                    fontSize: '0.88rem',
                    cursor: 'pointer',
                    maxWidth: '320px'
                  }}
                >
                  {demoPacks.map(p => (
                    <option key={p.name} value={p.name}>{p.name} ({p.genre || 'Demo'})</option>
                  ))}
                </select>
              </div>
              <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '2px', display: 'block' }}>
                {packSoundsList.length} candidate samples indexed in pack
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
              Playhead: <strong style={{ color: '#06b6d4', fontVariantNumeric: 'tabular-nums' }}>{formatTime(currentTime)}</strong> / {formatTime(duration)}
            </span>
          </div>
        </div>

        {/* Master Demo Waveform */}
        <div style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '16px', position: 'relative' }}>
          <div ref={containerRef} style={{ width: '100%' }} />

          {/* Range Selection Highlight Overlay */}
          <div style={{
            position: 'absolute',
            top: '16px',
            bottom: '16px',
            left: `${(startSec / Math.max(1, duration)) * 100}%`,
            width: `${((endSec - startSec) / Math.max(1, duration)) * 100}%`,
            background: 'rgba(6, 182, 212, 0.18)',
            borderLeft: '2px solid #06b6d4',
            borderRight: '2px solid #a855f7',
            boxShadow: '0 0 15px rgba(6, 182, 212, 0.3)',
            pointerEvents: 'none'
          }} />
        </div>

        {/* Timeline Range Selector & Controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px', background: 'rgba(255,255,255,0.02)', padding: '16px 20px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
          
          {/* Playback Controls */}
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
              <span>Audition Section ({formatTime(startSec)} - {formatTime(endSec)})</span>
            </button>
          </div>

          {/* Dual Range Sliders (e.g. 1:35 to 2:15) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)' }}>Start:</span>
              <input 
                type="range"
                min="0"
                max={Math.max(1, endSec - 1)}
                value={startSec}
                onChange={(e) => setStartSec(parseFloat(e.target.value))}
                style={{ width: '110px', accentColor: '#06b6d4', cursor: 'pointer' }}
              />
              <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#06b6d4', minWidth: '45px', fontVariantNumeric: 'tabular-nums' }}>
                {formatTime(startSec)}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)' }}>End:</span>
              <input 
                type="range"
                min={startSec + 1}
                max={Math.max(startSec + 1, duration)}
                value={endSec}
                onChange={(e) => setEndSec(parseFloat(e.target.value))}
                style={{ width: '110px', accentColor: '#a855f7', cursor: 'pointer' }}
              />
              <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#a855f7', minWidth: '45px', fontVariantNumeric: 'tabular-nums' }}>
                {formatTime(endSec)}
              </span>
            </div>
          </div>

          {/* Trigger Analysis Button */}
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
            {isAnalysing ? <RefreshCw size={16} className="spin-animation" /> : <Sparkles size={16} />}
            <span>{isAnalysing ? 'Analyzing Audio...' : '🔬 Identify Samples in Section'}</span>
          </button>
        </div>

      </div>

      {/* Identified Samples Results Section */}
      {hasAnalysed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span>🎯 Identified Samples in Section</span>
              <span style={{ fontSize: '0.78rem', background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '2px 10px', borderRadius: '9999px', fontWeight: 800 }}>
                {identifiedSamples.length} Sounds Found
              </span>
            </h2>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Section: <strong style={{ color: '#f8fafc' }}>{formatTime(startSec)} - {formatTime(endSec)}</strong> in {packTitle}
            </span>
          </div>

          {/* Identified Samples Table */}
          <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '16px', overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '44px 2.5fr 1.2fr 1fr 1.2fr 200px', padding: '12px 18px', borderBottom: '1px solid var(--border-color)', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
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
                    gridTemplateColumns: '44px 2.5fr 1.2fr 1fr 1.2fr 200px',
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

                  {/* Occurrence Timestamp with Seek Trigger */}
                  <div>
                    <button
                      onClick={() => handleJumpToTimestamp(sound.timestampSec)}
                      title="Click to jump playhead to this exact moment in demo"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        background: 'rgba(6, 182, 212, 0.1)',
                        border: '1px solid rgba(6, 182, 212, 0.25)',
                        padding: '3px 8px',
                        borderRadius: '6px',
                        color: '#38bdf8',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                    >
                      <Clock size={11} color="#06b6d4" />
                      <span>~{sound.timestampFormatted} (Jump)</span>
                    </button>
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
                      title="Drag into FL Studio / Ableton / Logic"
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
