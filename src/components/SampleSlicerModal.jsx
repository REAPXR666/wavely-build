import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Scissors, Play, Pause, Download, Volume2, X, Sparkles, Music2, 
  Layers, Disc3, Check, RefreshCw, Key, Keyboard, Grid, Mic, Square,
  FolderOpen, ArrowRight, Zap, Radio, FileAudio, Music, Dices, RotateCcw
} from 'lucide-react';
import { 
  loadAudioBuffer, getAudioContext, audioBufferToWav, 
  pitchShiftAudioBuffer, timeStretchAudioBuffer, reverseAudioBuffer 
} from '../utils/audioDsp';
import { generateMidiFile, createCustomPatternMidi, generateRandomPattern } from '../utils/midiGenerator';

const KEY_PAD_MAP = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', '1', '2', '3', '4', '5', '6', '7', '8'];

export default function SampleSlicerModal({ sound, onClose, showToast }) {
  const defaultBpm = parseFloat(sound?.bpm) || 120;
  const [bpm, setBpm] = useState(defaultBpm);
  const [stepDivision, setStepDivision] = useState(1); // 1 = 1/4 note (1 step per beat - relaxed natural groove), 2 = 1/8 note, 0.5 = 1/2 note, 4 = 1/16 note
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

  // Procedural Random Pattern Sequencer States
  const [patternStyle, setPatternStyle] = useState('groove'); // 'groove' | 'breakbeat' | 'stutter' | 'trap_roll'
  const [activeStepIndex, setActiveStepIndex] = useState(null);
  const [isPatternPlaying, setIsPatternPlaying] = useState(false);
  
  // 16-step active sequence of pad indices (0 to sliceCount-1, or null for rest)
  const [sequence, setSequence] = useState(() => generateRandomPattern(8, 'groove', 16));

  const activeSourceRef = useRef(null);
  const canvasRef = useRef(null);
  const recordedAudioRef = useRef(new Audio());
  const patternTimerRef = useRef(null);

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

  // Regenerate pattern when sliceCount changes
  const rollNewRandomPattern = (style = patternStyle) => {
    const newSeq = generateRandomPattern(sliceCount, style, 16);
    setSequence(newSeq);
    if (showToast) showToast(`🎲 Rolled fresh "${style.replace('_', ' ').toUpperCase()}" pattern!`, 'info');
  };

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
  const playSlice = (slice, maxDuration = null) => {
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
    const dur = maxDuration ? Math.min(slice.duration, maxDuration * 1.1) : slice.duration;
    source.start(0, Math.max(0, start), dur);
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
      try {
        const arrayBuf = await blob.arrayBuffer();
        const decoded = await audioCtx.decodeAudioData(arrayBuf);
        const wavBlob = audioBufferToWav(decoded);
        setRecordedWavBlob(wavBlob);

        const url = URL.createObjectURL(wavBlob);
        setRecordedAudioUrl(url);
        recordedAudioRef.current.src = url;

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

  // Export MIDI Clip (.mid) with Custom Generated Random Pattern, Custom BPM & Step Division
  const exportMidiClip = () => {
    const cleanName = (sound.name || 'Sample').replace(/\.wav$|\.mp3$/i, '');
    const currentBpm = Math.max(40, Math.min(300, bpm));
    const midiBlob = createCustomPatternMidi(sequence, sliceCount, currentBpm, stepDivision);
    const url = URL.createObjectURL(midiBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cleanName}_Chops_${currentBpm}BPM_Pattern.mid`;
    a.click();
    URL.revokeObjectURL(url);
    if (showToast) showToast(`🎹 Exported MIDI Pattern (${currentBpm} BPM)!`, 'success');
  };

  // Render & Export Pattern Audio (WAV)
  const exportPatternAudio = async () => {
    if (!audioBuffer) return;
    try {
      const audioCtx = getAudioContext();
      const currentBpm = Math.max(40, Math.min(300, bpm));
      const stepDuration = (60 / currentBpm) / Math.max(0.25, stepDivision);
      const totalDuration = sequence.length * stepDuration;

      const numChannels = audioBuffer.numberOfChannels;
      const sampleRate = audioBuffer.sampleRate;
      const totalSamples = Math.ceil(totalDuration * sampleRate);

      const outputBuffer = audioCtx.createBuffer(numChannels, totalSamples, sampleRate);

      sequence.forEach((sliceIdx, step) => {
        if (sliceIdx !== null && sliceIdx !== undefined && sliceIdx >= 0) {
          const slice = slices[sliceIdx % sliceCount];
          if (!slice) return;

          const outStart = Math.floor(step * stepDuration * sampleRate);
          const srcStart = Math.floor(slice.startTime * sampleRate);
          const copyLen = Math.min(Math.floor(stepDuration * sampleRate), Math.floor(slice.duration * sampleRate));

          for (let c = 0; c < numChannels; c++) {
            const src = audioBuffer.getChannelData(c);
            const dest = outputBuffer.getChannelData(c);
            for (let i = 0; i < copyLen && (outStart + i) < totalSamples; i++) {
              dest[outStart + i] += src[srcStart + i];
            }
          }
        }
      });

      const wavBlob = audioBufferToWav(outputBuffer);
      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement('a');
      const cleanName = (sound.name || 'Sample').replace(/\.wav$|\.mp3$/i, '');
      a.href = url;
      a.download = `${cleanName}_RandomChop_${currentBpm}BPM.wav`;
      a.click();
      URL.revokeObjectURL(url);
      if (showToast) showToast(`💾 Exported Pattern Audio Loop (${currentBpm} BPM WAV)!`, 'success');
    } catch (err) {
      console.error('Export pattern audio error:', err);
    }
  };

  // Toggle Live Sequencer Playback
  const togglePatternPlay = () => {
    if (isPatternPlaying) {
      setIsPatternPlaying(false);
      setActiveStepIndex(null);
      setActiveSliceIndex(null);
      if (patternTimerRef.current) clearInterval(patternTimerRef.current);
      return;
    }
    setIsPatternPlaying(true);
  };

  // Dynamic Live Sequencer Timer: automatically adjusts speed instantly when BPM or stepDivision changes!
  useEffect(() => {
    if (!isPatternPlaying) {
      if (patternTimerRef.current) clearInterval(patternTimerRef.current);
      setActiveStepIndex(null);
      return;
    }

    if (patternTimerRef.current) clearInterval(patternTimerRef.current);

    const currentBpm = Math.max(40, Math.min(300, bpm));
    // Step Duration in seconds: (60 / currentBpm) / stepDivision
    const stepSeconds = (60 / currentBpm) / Math.max(0.25, stepDivision);
    const stepDurationMs = stepSeconds * 1000;

    let currentStep = activeStepIndex !== null ? activeStepIndex : 0;
    const runStep = () => {
      const stepVal = sequence[currentStep % sequence.length];
      setActiveStepIndex(currentStep % sequence.length);

      if (stepVal !== null && stepVal !== undefined && stepVal >= 0) {
        const slice = slices[stepVal % sliceCount];
        if (slice) playSlice(slice, stepSeconds);
      }

      currentStep++;
    };

    runStep();
    patternTimerRef.current = setInterval(runStep, stepDurationMs);

    return () => {
      if (patternTimerRef.current) clearInterval(patternTimerRef.current);
    };
  }, [isPatternPlaying, bpm, stepDivision, sequence, slices, sliceCount]);

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
          width: '940px',
          maxWidth: '96vw',
          maxHeight: '94vh',
          backgroundColor: '#0b1120',
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
                <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>Wavely Sampler & Random Pattern Engine</h2>
                <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '9999px', background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)', fontWeight: 700 }}>
                  PROCEDURAL CHOP GENERATOR
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#94a3b8' }}>
                Sample: <strong style={{ color: '#e2e8f0' }}>{sound?.name}</strong> • Key: {sound?.key || 'C Maj'}
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
        <div style={{ padding: '18px 24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          {/* Top Controls Toolbar: Slices, Tempo (BPM) & Live REC */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px', background: 'rgba(255,255,255,0.02)', padding: '12px 16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
            
            {/* Slice Count Grid Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)' }}>Pads:</span>
              {[4, 8, 16].map(count => (
                <button
                  key={count}
                  onClick={() => {
                    setSliceCount(count);
                    rollNewRandomPattern();
                  }}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    fontSize: '0.78rem',
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

            {/* Custom Interactive BPM Control */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#38bdf8' }}>BPM:</span>
              <input
                type="number"
                min="40"
                max="280"
                value={bpm}
                onChange={(e) => setBpm(parseFloat(e.target.value) || 120)}
                style={{
                  width: '60px',
                  padding: '4px 8px',
                  borderRadius: '6px',
                  background: 'rgba(0,0,0,0.4)',
                  border: '1px solid rgba(56, 189, 248, 0.4)',
                  color: '#ffffff',
                  fontWeight: 800,
                  fontSize: '0.85rem',
                  textAlign: 'center'
                }}
              />
              <input
                type="range"
                min="50"
                max="220"
                value={bpm}
                onChange={(e) => setBpm(parseFloat(e.target.value) || 120)}
                style={{ width: '80px', accentColor: '#38bdf8', cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  onClick={() => setBpm(Math.round(bpm / 2))}
                  title="Half-Time BPM"
                  style={{ padding: '3px 6px', fontSize: '0.7rem', borderRadius: '4px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', cursor: 'pointer' }}
                >
                  ÷2
                </button>
                <button
                  onClick={() => setBpm(Math.round(bpm * 2))}
                  title="Double-Time BPM"
                  style={{ padding: '3px 6px', fontSize: '0.7rem', borderRadius: '4px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', cursor: 'pointer' }}
                >
                  ×2
                </button>
                <button
                  onClick={() => setBpm(defaultBpm)}
                  title="Reset to Original BPM"
                  style={{ padding: '3px 6px', fontSize: '0.7rem', borderRadius: '4px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', cursor: 'pointer' }}
                >
                  <RotateCcw size={11} />
                </button>
              </div>
            </div>

            {/* Live Pad Recording Trigger Button */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {isRecording ? (
                <button
                  onClick={stopRecording}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 14px',
                    borderRadius: '8px',
                    border: 'none',
                    background: '#ef4444',
                    color: '#ffffff',
                    fontWeight: 800,
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                    boxShadow: '0 0 15px rgba(239, 68, 68, 0.6)'
                  }}
                >
                  <Square size={13} fill="currentColor" />
                  <span>Stop REC ({recordingSeconds.toFixed(1)}s)</span>
                </button>
              ) : (
                <button
                  onClick={startRecording}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 14px',
                    borderRadius: '8px',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    background: 'rgba(239, 68, 68, 0.15)',
                    color: '#f87171',
                    fontWeight: 800,
                    fontSize: '0.8rem',
                    cursor: 'pointer'
                  }}
                >
                  <Mic size={13} />
                  <span>● Record Live</span>
                </button>
              )}
            </div>

          </div>

          {/* Sliced Waveform Visualizer */}
          <div style={{ position: 'relative', width: '100%', height: '100px', borderRadius: '10px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
            <canvas ref={canvasRef} width={890} height={100} style={{ width: '100%', height: '100%', display: 'block' }} />
          </div>

          {/* Recorded Performance Audio Deck (If Performance Recorded) */}
          {recordedWavBlob && (
            <div style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '12px', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button
                  onClick={togglePlayRecorded}
                  style={{
                    width: '30px',
                    height: '30px',
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
                  {isPlayingRecorded ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" style={{ marginLeft: '1px' }} />}
                </button>
                <div>
                  <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 800, color: '#34d399' }}>Live Performance Recording</h4>
                  <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{(recordedWavBlob.size / 1024).toFixed(0)} KB • Studio WAV</span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  onClick={() => downloadRecordedPerformance('wav')}
                  style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: '#f8fafc', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
                >
                  <Download size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                  WAV
                </button>
                <button
                  onClick={() => downloadRecordedPerformance('mp3')}
                  style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: '#f8fafc', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
                >
                  <Download size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                  MP3
                </button>
                {recordedTempFilePath && (
                  <button
                    draggable="true"
                    onDragStart={handleDragRecording}
                    style={{ padding: '5px 12px', borderRadius: '6px', border: '1px solid rgba(16, 185, 129, 0.4)', background: 'rgba(16, 185, 129, 0.2)', color: '#34d399', fontSize: '0.75rem', fontWeight: 800, cursor: 'grab' }}
                  >
                    DRAG TO DAW
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Interactive MPC Pads Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(4, 1fr)`, gap: '8px' }}>
            {slices.map((slice) => {
              const isActive = activeSliceIndex === slice.index;
              return (
                <div
                  key={slice.index}
                  onClick={() => playSlice(slice)}
                  style={{
                    background: isActive ? 'linear-gradient(135deg, #0284c7, #38bdf8)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${isActive ? '#38bdf8' : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: '8px',
                    padding: '12px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    minHeight: '70px',
                    transition: 'all 0.08s ease',
                    boxShadow: isActive ? '0 0 16px rgba(56, 189, 248, 0.5)' : 'none'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: isActive ? '#fff' : 'var(--text-muted)' }}>
                      Pad {slice.index + 1}
                    </span>
                    <span style={{ fontSize: '0.7rem', padding: '1px 5px', borderRadius: '4px', background: 'rgba(0,0,0,0.3)', color: isActive ? '#fff' : '#38bdf8', fontWeight: 800 }}>
                      Key: {slice.keyLabel}
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
                    <span style={{ fontSize: '0.65rem', color: isActive ? '#fff' : '#64748b' }}>
                      {(slice.duration * 1000).toFixed(0)}ms
                    </span>
                    <span style={{ fontSize: '0.7rem', color: isActive ? '#fff' : '#94a3b8' }}>
                      ▶ Play
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Random Procedural Chop Sequencer Section */}
          <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(168, 85, 247, 0.3)', borderRadius: '12px', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            
            {/* Sequencer Toolbar Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button
                  onClick={togglePatternPlay}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: 'none',
                    background: isPatternPlaying ? '#ef4444' : 'linear-gradient(135deg, #9333ea, #38bdf8)',
                    color: '#fff',
                    fontWeight: 800,
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    boxShadow: isPatternPlaying ? '0 0 16px rgba(239, 68, 68, 0.5)' : '0 4px 14px rgba(147, 51, 234, 0.35)'
                  }}
                >
                  {isPatternPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
                  <span>{isPatternPlaying ? 'Stop Groove' : `Play Random Groove (${bpm} BPM)`}</span>
                </button>

                {/* Roll New Pattern Button */}
                <button
                  onClick={() => rollNewRandomPattern(patternStyle)}
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
                    fontWeight: 800,
                    cursor: 'pointer'
                  }}
                >
                  <Dices size={15} />
                  <span>🎲 Roll New Pattern</span>
                </button>
              </div>

              {/* Step Speed & Groove Style Selectors */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                {/* Step Speed / Grid Division */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '0.75rem', color: '#38bdf8', fontWeight: 700 }}>Speed:</span>
                  {[
                    { div: 0.5, label: '1/2 (Slow)' },
                    { div: 1, label: '1/4 (Standard)' },
                    { div: 2, label: '1/8 (Upbeat)' },
                    { div: 4, label: '1/16 (Fast)' }
                  ].map(item => (
                    <button
                      key={item.div}
                      onClick={() => setStepDivision(item.div)}
                      style={{
                        padding: '3px 8px',
                        borderRadius: '5px',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        border: '1px solid',
                        borderColor: stepDivision === item.div ? '#38bdf8' : 'rgba(255,255,255,0.08)',
                        background: stepDivision === item.div ? 'rgba(56, 189, 248, 0.25)' : 'transparent',
                        color: stepDivision === item.div ? '#38bdf8' : '#94a3b8',
                        cursor: 'pointer'
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                {/* Style Presets */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '0.75rem', color: '#c084fc', fontWeight: 700 }}>Style:</span>
                  {[
                    { id: 'groove', label: 'Bounce' },
                    { id: 'breakbeat', label: 'Breakbeat' },
                    { id: 'stutter', label: 'Glitch' },
                    { id: 'trap_roll', label: 'Trap' }
                  ].map(s => (
                    <button
                      key={s.id}
                      onClick={() => {
                        setPatternStyle(s.id);
                        rollNewRandomPattern(s.id);
                      }}
                      style={{
                        padding: '3px 8px',
                        borderRadius: '5px',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        border: '1px solid',
                        borderColor: patternStyle === s.id ? '#a855f7' : 'rgba(255,255,255,0.08)',
                        background: patternStyle === s.id ? 'rgba(168, 85, 247, 0.25)' : 'transparent',
                        color: patternStyle === s.id ? '#e9d5ff' : '#94a3b8',
                        cursor: 'pointer'
                      }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 16-Step Visual Step Sequencer Rack */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(16, 1fr)', gap: '4px' }}>
              {sequence.map((stepPad, idx) => {
                const isCurrentStep = activeStepIndex === idx;
                const hasNote = stepPad !== null && stepPad !== undefined;
                return (
                  <div
                    key={idx}
                    onClick={() => {
                      const newSeq = [...sequence];
                      if (stepPad === null) newSeq[idx] = 0;
                      else if (stepPad < sliceCount - 1) newSeq[idx] = stepPad + 1;
                      else newSeq[idx] = null;
                      setSequence(newSeq);
                    }}
                    title={`Step ${idx + 1}: ${hasNote ? `Pad ${stepPad + 1}` : 'Rest'} (Click to cycle)`}
                    style={{
                      height: '40px',
                      borderRadius: '6px',
                      background: isCurrentStep 
                        ? '#38bdf8' 
                        : hasNote 
                        ? 'rgba(168, 85, 247, 0.35)' 
                        : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${isCurrentStep ? '#fff' : hasNote ? 'rgba(168, 85, 247, 0.6)' : 'rgba(255,255,255,0.08)'}`,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.05s ease',
                      boxShadow: isCurrentStep ? '0 0 12px #38bdf8' : 'none'
                    }}
                  >
                    <span style={{ fontSize: '0.62rem', fontWeight: 800, color: isCurrentStep ? '#000' : hasNote ? '#f8fafc' : '#475569' }}>
                      {hasNote ? `P${stepPad + 1}` : '—'}
                    </span>
                    <span style={{ fontSize: '0.55rem', color: isCurrentStep ? '#000' : '#64748b' }}>
                      {idx + 1}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Pattern Export Action Bar */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: '8px', marginTop: '4px' }}>
              <button
                onClick={exportPatternAudio}
                title="Render this random chop sequence to a loopable WAV file"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: '1px solid rgba(56, 189, 248, 0.4)',
                  background: 'rgba(56, 189, 248, 0.15)',
                  color: '#38bdf8',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                <Download size={13} />
                <span>Export Pattern (WAV Loop)</span>
              </button>

              <button
                onClick={exportMidiClip}
                title="Export standard MIDI clip (.mid) with this exact pattern at set BPM"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: '1px solid rgba(168, 85, 247, 0.4)',
                  background: 'rgba(168, 85, 247, 0.15)',
                  color: '#c084fc',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                <Music size={13} />
                <span>Export MIDI Clip ({bpm} BPM .mid)</span>
              </button>

              <button
                onClick={exportAllChops}
                title="Export all individual slice WAV files into a folder"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  background: 'rgba(255, 255, 255, 0.05)',
                  color: '#f8fafc',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                <FolderOpen size={13} />
                <span>Export All Chops</span>
              </button>
            </div>

          </div>

        </div>

        {/* Modal Footer */}
        <div style={{ padding: '12px 24px', borderTop: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
            Tip: Press <kbd style={{ padding: '2px 5px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', color: '#e2e8f0' }}>A S D F</kbd> / <kbd style={{ padding: '2px 5px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', color: '#e2e8f0' }}>1 2 3 4</kbd> on your keyboard to play pads live
          </span>
          <button
            onClick={onClose}
            style={{
              padding: '6px 18px',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.08)',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '0.82rem',
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
