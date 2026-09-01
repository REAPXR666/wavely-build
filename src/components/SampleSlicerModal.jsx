import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Scissors, Play, Pause, Download, Volume2, X, Sparkles, Music2, 
  Layers, Disc3, Check, RefreshCw, Key, Keyboard, Grid, Mic, Square,
  FolderOpen, ArrowRight, Zap, Radio, FileAudio, Music
} from 'lucide-react';
import { 
  loadAudioBuffer, getAudioContext, audioBufferToWav, 
  pitchShiftAudioBuffer, timeStretchAudioBuffer, reverseAudioBuffer 
} from '../utils/audioDsp';
import { generateMidiFile, createChopMidiPattern } from '../utils/midiGenerator';

const KEY_PAD_MAP = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', '1', '2', '3', '4', '5', '6', '7', '8'];

export default function SampleSlicerModal({ sound, onClose, showToast }) {
  const [sliceCount, setSliceCount] = useState(8);
  const [audioBuffer, setAudioBuffer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeSliceIndex, setActiveSliceIndex] = useState(null);
  const [pitchSemitones, setPitchSemitones] = useState(0);
  const [speedMultiplier, setSpeedMultiplier] = useState(1.0);
  const [isReversed, setIsReversed] = useState(false);

  // Live Performance Recording States
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordedWavBlob, setRecordedWavBlob] = useState(null);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState(null);
  const [recordedTempFilePath, setRecordedTempFilePath] = useState(null);
  const [isPlayingRecorded, setIsPlayingRecorded] = useState(false);

  // Auto-Chop Sequencer States
  const [autoChopMode, setAutoChopMode] = useState('linear'); // 'linear' | 'stutter' | 'reverse'
  const [isAutoChopPlaying, setIsAutoChopPlaying] = useState(false);
  const autoChopTimerRef = useRef(null);

  const activeSourceRef = useRef(null);
  const canvasRef = useRef(null);
  const recordedAudioRef = useRef(new Audio());

  // Web Audio Recording stream
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const recordingStreamDestRef = useRef(null);

  // Load Audio Buffer on mount
  useEffect(() => {
    let isCancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const url = sound.previewUrl || sound.filePath;
        const buf = await loadAudioBuffer(url);
        if (!isCancelled) {
          setAudioBuffer(buf);
          setLoading(false);
        }
      } catch (err) {
        console.error('Failed to load audio for slicer:', err);
        if (!isCancelled) {
          setLoading(false);
          if (showToast) showToast('Failed to load audio for slicing', 'error');
        }
      }
    };
    load();
    return () => { isCancelled = true; };
  }, [sound]);

  // Compute Slice Intervals
  const slices = useMemo(() => {
    if (!audioBuffer) return [];
    const totalDuration = audioBuffer.duration;
    const sliceDuration = totalDuration / sliceCount;
    const list = [];
    for (let i = 0; i < sliceCount; i++) {
      list.push({
        index: i,
        keyLabel: KEY_PAD_MAP[i] || `${i + 1}`,
        startTime: i * sliceDuration,
        endTime: (i + 1) * sliceDuration,
        duration: sliceDuration
      });
    }
    return list;
  }, [audioBuffer, sliceCount]);

  // Draw Waveform and Slice Markers
  useEffect(() => {
    if (!canvasRef.current || !audioBuffer) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = '#0a0f1d';
    ctx.fillRect(0, 0, width, height);

    // Waveform
    const data = audioBuffer.getChannelData(0);
    const step = Math.ceil(data.length / width);
    const amp = height / 2;

    ctx.fillStyle = '#38bdf8';
    for (let i = 0; i < width; i++) {
      let min = 1.0;
      let max = -1.0;
      for (let j = 0; j < step; j++) {
        const datum = data[(i * step) + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      ctx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
    }

    // Slice Boundary Lines
    ctx.lineWidth = 2;
    ctx.fillStyle = '#f87171';
    ctx.font = '11px sans-serif';

    slices.forEach((slice, idx) => {
      if (idx > 0) {
        const x = (slice.startTime / audioBuffer.duration) * width;
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = '#ef4444';
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      const xStart = (slice.startTime / audioBuffer.duration) * width;
      ctx.fillText(`P${idx + 1} [${slice.keyLabel}]`, xStart + 6, 16);
    });
  }, [audioBuffer, slices]);

  // Play Individual Slice (Routes to Speakers AND to MediaRecorder if recording)
  const playSlice = (slice) => {
    if (!audioBuffer) return;
    const audioCtx = getAudioContext();
    if (activeSourceRef.current) {
      try { activeSourceRef.current.stop(); } catch (e) {}
    }

    let processed = audioBuffer;
    if (isReversed) processed = reverseAudioBuffer(processed);
    if (pitchSemitones !== 0) processed = pitchShiftAudioBuffer(processed, pitchSemitones);
    if (speedMultiplier !== 1.0) processed = timeStretchAudioBuffer(processed, speedMultiplier);

    const source = audioCtx.createBufferSource();
    source.buffer = processed;

    // Connect to speaker
    source.connect(audioCtx.destination);

    // If live recording is active, also route to recorder destination
    if (isRecording && recordingStreamDestRef.current) {
      source.connect(recordingStreamDestRef.current);
    }

    const start = isReversed ? (audioBuffer.duration - slice.endTime) : slice.startTime;
    source.start(0, Math.max(0, start), slice.duration);
    activeSourceRef.current = source;
    setActiveSliceIndex(slice.index);

    source.onended = () => {
      setActiveSliceIndex(null);
    };
  };

  // Keyboard Trigger Listeners
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const key = e.key.toUpperCase();
      const matched = slices.find(s => s.keyLabel === key);
      if (matched) {
        e.preventDefault();
        playSlice(matched);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [slices, audioBuffer, pitchSemitones, speedMultiplier, isReversed, isRecording]);

  // Start Live Performance Recording
  const startRecording = () => {
    const audioCtx = getAudioContext();
    const dest = audioCtx.createMediaStreamDestination();
    recordingStreamDestRef.current = dest;
    recordedChunksRef.current = [];

    const recorder = new MediaRecorder(dest.stream);
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        recordedChunksRef.current.push(e.data);
      }
    };

    recorder.onstop = async () => {
      const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
      // Convert webm recording to WAV AudioBuffer
      try {
        const arrayBuf = await blob.arrayBuffer();
        const decoded = await audioCtx.decodeAudioData(arrayBuf);
        const wavBlob = audioBufferToWav(decoded);
        setRecordedWavBlob(wavBlob);

        const url = URL.createObjectURL(wavBlob);
        setRecordedAudioUrl(url);
        recordedAudioRef.current.src = url;

        // Save to temporary WAV file in Electron for direct DAW drag & drop
        if (window.electron?.saveTempRecording) {
          const reader = new FileReader();
          reader.onloadend = async () => {
            const b64 = reader.result.split(',')[1];
            const cleanName = (sound.name || 'Sample').replace(/\.wav$|\.mp3$/i, '');
            const res = await window.electron.saveTempRecording({
              bufferB64: b64,
              filename: `${cleanName}_Performance_${Date.now()}`
            });
            if (res?.success) {
              setRecordedTempFilePath(res.filePath);
            }
          };
          reader.readAsDataURL(wavBlob);
        }

        if (showToast) showToast('🎙️ Performance Recorded! Ready to export or drag to DAW.', 'success');
      } catch (err) {
        console.error('Decode recording error:', err);
      }
    };

    recorder.start();
    mediaRecorderRef.current = recorder;
    setIsRecording(true);
    setRecordingSeconds(0);

    recordingTimerRef.current = setInterval(() => {
      setRecordingSeconds(prev => prev + 0.1);
    }, 100);
  };

  // Stop Live Performance Recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
    }
    setIsRecording(false);
  };

  // Toggle Play Recorded Performance
  const togglePlayRecorded = () => {
    if (isPlayingRecorded) {
      recordedAudioRef.current.pause();
      setIsPlayingRecorded(false);
    } else {
      recordedAudioRef.current.play();
      setIsPlayingRecorded(true);
      recordedAudioRef.current.onended = () => setIsPlayingRecorded(false);
    }
  };

  // Export Recorded Performance (WAV or MP3)
  const downloadRecordedPerformance = (format = 'wav') => {
    if (!recordedWavBlob) return;
    const cleanName = (sound.name || 'Sample').replace(/\.wav$|\.mp3$/i, '');
    const a = document.createElement('a');
    a.href = recordedAudioUrl;
    a.download = `${cleanName}_Performance.${format}`;
    a.click();
    if (showToast) showToast(`Exported Performance as .${format.toUpperCase()}!`, 'success');
  };

  // Export All Slices as Individual WAV Files to Disk
  const exportAllChops = async () => {
    if (!audioBuffer) return;
    try {
      const audioCtx = getAudioContext();
      const numChannels = audioBuffer.numberOfChannels;
      const sampleRate = audioBuffer.sampleRate;
      const cleanName = (sound.name || 'Sample').replace(/\.wav$|\.mp3$/i, '');
      const chopList = [];

      for (const slice of slices) {
        const startSample = Math.floor(slice.startTime * sampleRate);
        const endSample = Math.min(audioBuffer.length, Math.floor(slice.endTime * sampleRate));
        const sliceLength = endSample - startSample;

        const sliceBuf = audioCtx.createBuffer(numChannels, sliceLength, sampleRate);
        for (let c = 0; c < numChannels; c++) {
          const src = audioBuffer.getChannelData(c);
          const dest = sliceBuf.getChannelData(c);
          for (let i = 0; i < sliceLength; i++) {
            dest[i] = src[startSample + i];
          }
        }

        const wavBlob = audioBufferToWav(sliceBuf);
        const arrayBuf = await wavBlob.arrayBuffer();
        const b64 = Buffer.from(arrayBuf).toString('base64');
        chopList.push({
          name: `${cleanName}_Chop_${slice.index + 1}`,
          bufferB64: b64
        });
      }

      if (window.electron?.exportSampleChops) {
        const res = await window.electron.exportSampleChops({
          sampleName: cleanName,
          chops: chopList
        });
        if (res?.success) {
          if (showToast) showToast(`📦 Exported ${res.count} Chops to /Downloads/Wavely/Chops/!`, 'success');
        }
      }
    } catch (err) {
      console.error('Export all chops error:', err);
    }
  };

  // Export MIDI Clip (.mid)
  const exportMidiClip = () => {
    const cleanName = (sound.name || 'Sample').replace(/\.wav$|\.mp3$/i, '');
    const bpm = parseFloat(sound.bpm) || 120;
    const midiBlob = createChopMidiPattern(sliceCount, bpm, autoChopMode);
    const url = URL.createObjectURL(midiBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cleanName}_Chops_${autoChopMode}.mid`;
    a.click();
    URL.revokeObjectURL(url);
    if (showToast) showToast(`🎹 Exported MIDI Pattern (${autoChopMode.toUpperCase()})!`, 'success');
  };

  // Auto-Chop Sequencer Playback
  const toggleAutoChopPlay = () => {
    if (isAutoChopPlaying) {
      if (autoChopTimerRef.current) clearInterval(autoChopTimerRef.current);
      setIsAutoChopPlaying(false);
      setActiveSliceIndex(null);
      return;
    }

    setIsAutoChopPlaying(true);
    const bpm = parseFloat(sound.bpm) || 120;
    const stepDurationMs = ((60 / bpm) / 2) * 1000; // 1/8 note step

    let stepIdx = 0;
    const sequenceOrder = autoChopMode === 'reverse'
      ? slices.map(s => s.index).reverse()
      : autoChopMode === 'stutter'
      ? [0, 0, 1, 2, 3, 3, 2, 1, 4, 4, 5, 6, 7, 7, 6, 5].map(i => i % sliceCount)
      : slices.map(s => s.index);

    const runStep = () => {
      const sliceIdx = sequenceOrder[stepIdx % sequenceOrder.length];
      const slice = slices[sliceIdx];
      if (slice) playSlice(slice);
      stepIdx++;
    };

    runStep();
    autoChopTimerRef.current = setInterval(runStep, stepDurationMs);
  };

  useEffect(() => {
    return () => {
      if (autoChopTimerRef.current) clearInterval(autoChopTimerRef.current);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
  }, []);

  const handleDragRecording = (e) => {
    e.stopPropagation();
    if (window.electron?.startDrag && recordedTempFilePath) {
      window.electron.startDrag(recordedTempFilePath);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)', position: 'fixed', inset: 0 }}>
      <div 
        className="modal-content" 
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '880px',
          maxWidth: '95vw',
          maxHeight: '92vh',
          backgroundColor: '#0f172a',
          border: '1px solid rgba(56, 189, 248, 0.35)',
          borderRadius: '16px',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 60px -15px rgba(0,0,0,0.9), 0 0 40px rgba(56, 189, 248, 0.2)',
          overflow: 'hidden',
          color: '#f8fafc'
        }}
      >
        {/* Header Bar */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'linear-gradient(135deg, #0284c7, #10b981)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(2, 132, 199, 0.4)' }}>
              <Scissors size={20} color="#ffffff" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>Wavely Sampler & Pad Slicer</h2>
                <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '9999px', background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)', fontWeight: 700 }}>
                  MPC LIVE RECORDER
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#94a3b8' }}>
                Sample: <strong style={{ color: '#e2e8f0' }}>{sound?.name}</strong> ({sound?.bpm || 120} BPM • {sound?.key || 'C Maj'})
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '6px', borderRadius: '8px' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '18px' }}>
          
          {/* Top Controls Toolbar: Slices & Live REC Button */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
            
            {/* Slice Count Grid Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)' }}>Pads:</span>
              {[4, 8, 16].map(count => (
                <button
                  key={count}
                  onClick={() => setSliceCount(count)}
                  style={{
                    padding: '4px 12px',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    border: '1px solid',
                    borderColor: sliceCount === count ? '#38bdf8' : 'rgba(255,255,255,0.1)',
                    background: sliceCount === count ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.04)',
                    color: sliceCount === count ? '#38bdf8' : '#cbd5e1',
                    cursor: 'pointer'
                  }}
                >
                  {count} Chops
                </button>
              ))}
            </div>

            {/* Live Pad Recording Trigger Button */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {isRecording ? (
                <button
                  onClick={stopRecording}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '6px 16px',
                    borderRadius: '8px',
                    border: 'none',
                    background: '#ef4444',
                    color: '#ffffff',
                    fontWeight: 800,
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    boxShadow: '0 0 15px rgba(239, 68, 68, 0.6)'
                  }}
                >
                  <Square size={14} fill="currentColor" />
                  <span>Stop REC ({recordingSeconds.toFixed(1)}s)</span>
                </button>
              ) : (
                <button
                  onClick={startRecording}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '6px 16px',
                    borderRadius: '8px',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    background: 'rgba(239, 68, 68, 0.15)',
                    color: '#f87171',
                    fontWeight: 800,
                    fontSize: '0.82rem',
                    cursor: 'pointer'
                  }}
                >
                  <Mic size={14} />
                  <span>● Record Performance</span>
                </button>
              )}
            </div>

          </div>

          {/* Sliced Waveform Visualizer */}
          <div style={{ position: 'relative', width: '100%', height: '110px', borderRadius: '10px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
            <canvas ref={canvasRef} width={830} height={110} style={{ width: '100%', height: '100%', display: 'block' }} />
          </div>

          {/* Recorded Performance Audio Deck (If Performance Recorded) */}
          {recordedWavBlob && (
            <div style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '12px', padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button
                  onClick={togglePlayRecorded}
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    border: 'none',
                    background: isPlayingRecorded ? '#ef4444' : '#10b981',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer'
                  }}
                >
                  {isPlayingRecorded ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" style={{ marginLeft: '1px' }} />}
                </button>
                <div>
                  <h4 style={{ margin: 0, fontSize: '0.88rem', fontWeight: 800, color: '#34d399' }}>Live Performance Recording</h4>
                  <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{(recordedWavBlob.size / 1024).toFixed(0)} KB • Studio WAV</span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  onClick={() => downloadRecordedPerformance('wav')}
                  style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: '#f8fafc', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}
                >
                  <Download size={13} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                  Export WAV
                </button>
                <button
                  onClick={() => downloadRecordedPerformance('mp3')}
                  style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: '#f8fafc', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}
                >
                  <Download size={13} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                  Export MP3
                </button>
                {recordedTempFilePath && (
                  <button
                    draggable="true"
                    onDragStart={handleDragRecording}
                    style={{ padding: '6px 14px', borderRadius: '6px', border: '1px solid rgba(16, 185, 129, 0.4)', background: 'rgba(16, 185, 129, 0.2)', color: '#34d399', fontSize: '0.78rem', fontWeight: 800, cursor: 'grab' }}
                  >
                    DRAG REC TO DAW
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Interactive MPC Pads Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${sliceCount <= 8 ? 4 : 4}, 1fr)`, gap: '10px' }}>
            {slices.map((slice) => {
              const isActive = activeSliceIndex === slice.index;
              return (
                <div
                  key={slice.index}
                  onClick={() => playSlice(slice)}
                  style={{
                    background: isActive ? 'linear-gradient(135deg, #0284c7, #38bdf8)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${isActive ? '#38bdf8' : 'rgba(255,255,255,0.1)'}`,
                    borderRadius: '10px',
                    padding: '14px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    minHeight: '80px',
                    transition: 'all 0.1s ease',
                    boxShadow: isActive ? '0 0 20px rgba(56, 189, 248, 0.5)' : 'none'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: isActive ? '#fff' : 'var(--text-muted)' }}>
                      Pad {slice.index + 1}
                    </span>
                    <span style={{ fontSize: '0.72rem', padding: '1px 6px', borderRadius: '4px', background: 'rgba(0,0,0,0.3)', color: isActive ? '#fff' : '#38bdf8', fontWeight: 800 }}>
                      Key: {slice.keyLabel}
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
                    <span style={{ fontSize: '0.68rem', color: isActive ? '#fff' : '#64748b' }}>
                      {(slice.duration * 1000).toFixed(0)}ms
                    </span>
                    <span style={{ fontSize: '0.75rem', color: isActive ? '#fff' : '#94a3b8' }}>
                      ▶ Play
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Auto-Chop Sequencer Bar */}
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button
                onClick={toggleAutoChopPlay}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: 'none',
                  background: isAutoChopPlaying ? '#ef4444' : 'linear-gradient(135deg, #a855f7, #38bdf8)',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: '0.82rem',
                  cursor: 'pointer'
                }}
              >
                {isAutoChopPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
                <span>{isAutoChopPlaying ? 'Stop Auto-Chop' : 'Play Auto-Chop Pattern'}</span>
              </button>

              {/* Sequence Mode Picker */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>Pattern:</span>
                {['linear', 'stutter', 'reverse'].map(mode => (
                  <button
                    key={mode}
                    onClick={() => setAutoChopMode(mode)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      border: '1px solid',
                      borderColor: autoChopMode === mode ? '#a855f7' : 'rgba(255,255,255,0.1)',
                      background: autoChopMode === mode ? 'rgba(168, 85, 247, 0.2)' : 'transparent',
                      color: autoChopMode === mode ? '#c084fc' : '#94a3b8',
                      cursor: 'pointer',
                      textTransform: 'capitalize'
                    }}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {/* Export Chops & MIDI Clip Buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                onClick={exportAllChops}
                title="Export all individual slices as WAV files into a folder"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 14px',
                  borderRadius: '8px',
                  border: '1px solid rgba(56, 189, 248, 0.4)',
                  background: 'rgba(56, 189, 248, 0.15)',
                  color: '#38bdf8',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                <FolderOpen size={14} />
                <span>Export All Chops (WAVs)</span>
              </button>

              <button
                onClick={exportMidiClip}
                title="Export MIDI file with chromatic notes triggering each chop"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 14px',
                  borderRadius: '8px',
                  border: '1px solid rgba(168, 85, 247, 0.4)',
                  background: 'rgba(168, 85, 247, 0.15)',
                  color: '#c084fc',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                <Music size={14} />
                <span>Export MIDI Clip (.mid)</span>
              </button>
            </div>
          </div>

        </div>

        {/* Modal Footer */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
            Tip: Press <kbd style={{ padding: '2px 6px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', color: '#e2e8f0' }}>A S D F</kbd> or <kbd style={{ padding: '2px 6px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', color: '#e2e8f0' }}>1 2 3 4</kbd> on your keyboard to trigger pads
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
