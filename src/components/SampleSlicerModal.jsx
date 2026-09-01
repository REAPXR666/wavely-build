import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Scissors, Play, Pause, Download, Volume2, X, Sparkles, Music2, 
  Layers, Disc3, Check, RefreshCw, Key, Keyboard, Grid 
} from 'lucide-react';
import { 
  loadAudioBuffer, getAudioContext, audioBufferToWav, 
  pitchShiftAudioBuffer, timeStretchAudioBuffer, reverseAudioBuffer 
} from '../utils/audioDsp';

const KEY_PAD_MAP = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', '1', '2', '3', '4', '5', '6', '7', '8'];

export default function SampleSlicerModal({ sound, onClose, showToast }) {
  const [sliceCount, setSliceCount] = useState(8);
  const [audioBuffer, setAudioBuffer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeSliceIndex, setActiveSliceIndex] = useState(null);
  const [isPlayingFull, setIsPlayingFull] = useState(false);
  const [pitchSemitones, setPitchSemitones] = useState(0);
  const [speedMultiplier, setSpeedMultiplier] = useState(1.0);
  const [isReversed, setIsReversed] = useState(false);

  const activeSourceRef = useRef(null);
  const canvasRef = useRef(null);

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

    // Draw background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);

    // Draw Audio Waveform
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

    // Draw Slice Boundary Lines
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.fillStyle = '#f87171';
    ctx.font = '11px sans-serif';

    slices.forEach((slice, idx) => {
      if (idx > 0) {
        const x = (slice.startTime / audioBuffer.duration) * width;
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      // Label slice
      const xStart = (slice.startTime / audioBuffer.duration) * width;
      ctx.fillText(`Slice ${idx + 1} (${slice.keyLabel})`, xStart + 6, 16);
    });
  }, [audioBuffer, slices]);

  // Play Individual Slice
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
    source.connect(audioCtx.destination);

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
  }, [slices, audioBuffer, pitchSemitones, speedMultiplier, isReversed]);

  // Export Single Slice as WAV
  const exportSlice = async (slice) => {
    if (!audioBuffer) return;
    try {
      const audioCtx = getAudioContext();
      const numChannels = audioBuffer.numberOfChannels;
      const sampleRate = audioBuffer.sampleRate;
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
      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement('a');
      const cleanName = (sound.name || 'sample').replace(/\.wav$|\.mp3$/i, '');
      a.href = url;
      a.download = `${cleanName}_slice_${slice.index + 1}.wav`;
      a.click();
      URL.revokeObjectURL(url);
      if (showToast) showToast(`Exported Slice ${slice.index + 1} as WAV!`, 'success');
    } catch (err) {
      console.error('Export slice error:', err);
    }
  };

  return (
    <div className="splice-cert-overlay" onClick={onClose} style={{ zIndex: 9999 }}>
      <div 
        className="splice-cert-modal-container" 
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '850px', background: '#0b0f19', border: '1px solid #1e293b', borderRadius: '12px', overflow: 'hidden' }}
      >
        {/* Header Bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #1e293b', background: '#0f172a' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Scissors size={18} className="text-emerald" style={{ color: '#10b981' }} />
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '700', color: '#f8fafc' }}>
              Wavely Pro Transient Slicer & Keyboard Sampler
            </h2>
          </div>
          <button 
            onClick={onClose} 
            style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div style={{ color: '#cbd5e1', fontSize: '0.9rem' }}>
              Sample: <strong style={{ color: '#38bdf8' }}>{sound.name}</strong> ({sound.bpm || '--'} BPM • {sound.key || 'Unknown Key'})
            </div>
            {/* Slice Count Presets */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Grid Slices:</span>
              {[4, 8, 16].map(count => (
                <button
                  key={count}
                  onClick={() => setSliceCount(count)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '4px',
                    fontSize: '0.8rem',
                    fontWeight: '600',
                    border: '1px solid',
                    borderColor: sliceCount === count ? '#10b981' : '#334155',
                    background: sliceCount === count ? 'rgba(16, 185, 129, 0.15)' : '#1e293b',
                    color: sliceCount === count ? '#10b981' : '#cbd5e1',
                    cursor: 'pointer'
                  }}
                >
                  {count} Chops
                </button>
              ))}
            </div>
          </div>

          {/* Visualizer Waveform Canvas */}
          <div style={{ position: 'relative', width: '100%', height: '140px', borderRadius: '8px', overflow: 'hidden', border: '1px solid #334155' }}>
            <canvas 
              ref={canvasRef} 
              width={800} 
              height={140} 
              style={{ width: '100%', height: '100%', display: 'block' }}
            />
          </div>

          {/* Quick DSP Bar (Pitch, Speed, Reverse) */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '16px 0', padding: '10px 14px', background: '#1e293b', borderRadius: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              {/* Pitch */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: '#cbd5e1' }}>
                <span>Pitch:</span>
                <button 
                  onClick={() => setPitchSemitones(p => Math.max(-12, p - 1))}
                  style={{ padding: '2px 8px', background: '#334155', border: 'none', borderRadius: '4px', color: '#f8fafc', cursor: 'pointer' }}
                >
                  -
                </button>
                <strong style={{ minWidth: '32px', textAlign: 'center', color: '#38bdf8' }}>
                  {pitchSemitones > 0 ? `+${pitchSemitones}` : pitchSemitones} st
                </strong>
                <button 
                  onClick={() => setPitchSemitones(p => Math.min(12, p + 1))}
                  style={{ padding: '2px 8px', background: '#334155', border: 'none', borderRadius: '4px', color: '#f8fafc', cursor: 'pointer' }}
                >
                  +
                </button>
              </div>

              {/* Speed */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: '#cbd5e1' }}>
                <span>Speed:</span>
                {[0.5, 1.0, 2.0].map(s => (
                  <button
                    key={s}
                    onClick={() => setSpeedMultiplier(s)}
                    style={{
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '0.78rem',
                      border: '1px solid',
                      borderColor: speedMultiplier === s ? '#38bdf8' : '#334155',
                      background: speedMultiplier === s ? 'rgba(56, 189, 248, 0.15)' : '#0f172a',
                      color: speedMultiplier === s ? '#38bdf8' : '#94a3b8',
                      cursor: 'pointer'
                    }}
                  >
                    {s}x
                  </button>
                ))}
              </div>

              {/* Reverse */}
              <button
                onClick={() => setIsReversed(!isReversed)}
                style={{
                  padding: '4px 10px',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                  border: '1px solid',
                  borderColor: isReversed ? '#e11d48' : '#334155',
                  background: isReversed ? 'rgba(225, 29, 72, 0.15)' : '#0f172a',
                  color: isReversed ? '#f43f5e' : '#94a3b8',
                  cursor: 'pointer'
                }}
              >
                ◀ Reverse
              </button>
            </div>

            <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
              Press keys on your keyboard to trigger chops
            </div>
          </div>

          {/* Interactive Keyboard Playable Slice Pads */}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(8, sliceCount)}, 1fr)`, gap: '8px' }}>
            {slices.map((slice) => {
              const isActive = activeSliceIndex === slice.index;
              return (
                <div
                  key={slice.index}
                  onClick={() => playSlice(slice)}
                  style={{
                    background: isActive ? '#10b981' : '#1e293b',
                    border: `1px solid ${isActive ? '#34d399' : '#334155'}`,
                    borderRadius: '8px',
                    padding: '12px 8px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.1s ease',
                    transform: isActive ? 'scale(0.96)' : 'scale(1)'
                  }}
                >
                  <div style={{ fontSize: '1.2rem', fontWeight: '800', color: isActive ? '#000000' : '#f8fafc', marginBottom: '4px' }}>
                    {slice.keyLabel}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: isActive ? '#000000' : '#94a3b8' }}>
                    Slice {slice.index + 1}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      exportSlice(slice);
                    }}
                    title="Export Slice WAV"
                    style={{
                      marginTop: '8px',
                      background: 'transparent',
                      border: 'none',
                      color: isActive ? '#000000' : '#64748b',
                      cursor: 'pointer',
                      fontSize: '0.7rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '100%'
                    }}
                  >
                    <Download size={11} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid #1e293b', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: '0.8rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Keyboard size={14} /> Playable with Computer Keyboard (A, S, D, F...) or MIDI controller
          </div>
          <button
            onClick={onClose}
            style={{
              padding: '6px 16px',
              borderRadius: '6px',
              background: '#334155',
              border: 'none',
              color: '#f8fafc',
              fontSize: '0.85rem',
              fontWeight: '600',
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
