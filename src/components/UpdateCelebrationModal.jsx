import React, { useState, useEffect, useRef } from 'react';
import { 
  Sparkles, Zap, Download, CheckCircle2, ArrowRight, X, Gift, 
  Rocket, RefreshCw, Star, Layers, ShieldCheck, Heart
} from 'lucide-react';

export default function UpdateCelebrationModal({ updateData, onClose, onInstall }) {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const canvasRef = useRef(null);

  // Confetti Particle Simulation Engine
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = ['#f43f5e', '#ec4899', '#d946ef', '#a855f7', '#8b5cf6', '#6366f1', '#3b82f6', '#06b6d4', '#10b981', '#fbbf24', '#f97316'];
    const particles = [];
    const particleCount = 120;

    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * (canvas.height * 0.5) - 50,
        size: Math.random() * 8 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: (Math.random() - 0.5) * 6,
        vy: Math.random() * 4 + 2,
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 10,
        shape: Math.random() > 0.4 ? 'rect' : 'circle',
        opacity: Math.random() * 0.5 + 0.5
      });
    }

    let animId;
    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotationSpeed;

        if (p.y > canvas.height) {
          p.y = -20;
          p.x = Math.random() * canvas.width;
        }

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;

        if (p.shape === 'rect') {
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 3, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      });

      animId = requestAnimationFrame(render);
    };

    render();

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Listen for download progress from Electron
  useEffect(() => {
    if (!window.electron?.onUpdateProgress) return;
    const unsubProgress = window.electron.onUpdateProgress((data) => {
      if (typeof data.percent === 'number') {
        setProgress(data.percent);
        if (data.percent >= 100) {
          setDownloading(false);
          setIsReady(true);
        }
      }
    });

    const unsubReady = window.electron.onUpdateReady?.(() => {
      setDownloading(false);
      setIsReady(true);
    });

    return () => {
      if (unsubProgress) unsubProgress();
      if (unsubReady) unsubReady();
    };
  }, []);

  const handleStartUpdate = async () => {
    if (isReady) {
      if (window.electron?.installDownloadedUpdate) {
        window.electron.installDownloadedUpdate();
      }
      return;
    }

    setDownloading(true);
    setProgress(10);

    if (window.electron?.startUpdateDownload) {
      const res = await window.electron.startUpdateDownload(updateData);
      if (res?.success) {
        setIsReady(true);
        setDownloading(false);
      } else {
        setDownloading(false);
        alert(res?.error || 'Failed to download update.');
      }
    }
  };

  const newVersion = updateData?.version || '1.0.7';
  const releaseNotes = updateData?.notes || '• Added Demo Analyser with timestamped sample identification\n• Added GPU-Accelerated Local Demucs AI 4-Stem Separation\n• Real-Time DSP Audio Pitch & Time-Stretching\n• Steinberg VST3 DAW Plugin Suite\n• Ultra-fast in-memory audio descrambling';

  const notesList = releaseNotes.split('\n').filter(Boolean);

  return (
    <div 
      className="modal-backdrop celebration-backdrop" 
      style={{
        zIndex: 999999,
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(5, 5, 15, 0.88)',
        backdropFilter: 'blur(12px)',
        overflow: 'hidden'
      }}
    >
      {/* Background Interactive Confetti Canvas */}
      <canvas 
        ref={canvasRef} 
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 1
        }} 
      />

      {/* Main Glassmorphism Celebration Card */}
      <div 
        className="celebration-card"
        style={{
          position: 'relative',
          zIndex: 2,
          width: '560px',
          maxWidth: '92vw',
          maxHeight: '90vh',
          background: 'linear-gradient(145deg, rgba(30, 27, 75, 0.95), rgba(15, 23, 42, 0.98))',
          border: '1px solid rgba(168, 85, 247, 0.4)',
          borderRadius: '24px',
          boxShadow: '0 30px 80px -15px rgba(0, 0, 0, 0.9), 0 0 50px rgba(168, 85, 247, 0.35)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'modalSlideUp 0.35s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
      >
        {/* Top Glow Ribbon */}
        <div style={{
          height: '4px',
          width: '100%',
          background: 'linear-gradient(90deg, #ec4899, #8b5cf6, #06b6d4, #10b981)'
        }} />

        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: '#94a3b8',
            borderRadius: '50%',
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.15s'
          }}
          onMouseEnter={(e) => e.currentTarget.style.color = '#ffffff'}
          onMouseLeave={(e) => e.currentTarget.style.color = '#94a3b8'}
        >
          <X size={16} />
        </button>

        {/* Header Hero */}
        <div style={{ padding: '32px 32px 16px 32px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          
          {/* Animated Rocket Icon Badge */}
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: '20px',
            background: 'linear-gradient(135deg, #a855f7, #ec4899)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 10px 25px rgba(168, 85, 247, 0.45)',
            marginBottom: '16px'
          }}>
            <Rocket size={32} color="#ffffff" style={{ transform: 'rotate(45deg)' }} />
          </div>

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 12px', borderRadius: '9999px', background: 'rgba(236, 72, 153, 0.15)', border: '1px solid rgba(236, 72, 153, 0.35)', color: '#f472b6', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
            <Sparkles size={12} />
            <span>New Release Available</span>
          </div>

          <h1 style={{ margin: '0 0 6px 0', fontSize: '1.75rem', fontWeight: 900, letterSpacing: '-0.03em', color: '#ffffff' }}>
            Wavely <span style={{ background: 'linear-gradient(135deg, #a855f7, #38bdf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>v{newVersion}</span> is Here!
          </h1>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#94a3b8' }}>
            A powerful new studio update is ready with brand new features and enhancements.
          </p>
        </div>

        {/* Release Notes Highlight Box */}
        <div style={{ padding: '0 32px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{
            background: 'rgba(0, 0, 0, 0.35)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '16px',
            padding: '16px 20px',
            maxHeight: '180px',
            overflowY: 'auto'
          }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', color: '#a855f7', letterSpacing: '0.05em', display: 'block', marginBottom: '10px' }}>
              ✨ What's New in this Version:
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {notesList.map((note, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '0.82rem', color: '#e2e8f0', lineHeight: '1.4' }}>
                  <span style={{ color: '#10b981', marginTop: '1px' }}>✓</span>
                  <span>{note.replace(/^[•\-*]\s*/, '')}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Progress Bar (When Downloading) */}
        {downloading && (
          <div style={{ padding: '16px 32px 0 32px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600 }}>
              <span>Downloading update package...</span>
              <span style={{ color: '#38bdf8', fontWeight: 800 }}>{progress}%</span>
            </div>
            <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '9999px', overflow: 'hidden' }}>
              <div style={{ width: `${progress}%`, height: '100%', background: 'linear-gradient(90deg, #ec4899, #a855f7, #38bdf8)', transition: 'width 0.3s ease', borderRadius: '9999px' }} />
            </div>
          </div>
        )}

        {/* Action Buttons Footer */}
        <div style={{ padding: '24px 32px 32px 32px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: '12px',
              borderRadius: '12px',
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.04)',
              color: '#94a3b8',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: 'pointer',
              transition: 'all 0.15s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#ffffff';
              e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = '#94a3b8';
              e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
            }}
          >
            Remind Me Later
          </button>

          <button
            onClick={handleStartUpdate}
            disabled={downloading}
            style={{
              flex: 2,
              padding: '12px 20px',
              borderRadius: '12px',
              border: 'none',
              background: isReady 
                ? 'linear-gradient(135deg, #10b981, #06b6d4)' 
                : 'linear-gradient(135deg, #ec4899, #8b5cf6)',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: '0.9rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              cursor: downloading ? 'not-allowed' : 'pointer',
              boxShadow: '0 8px 24px rgba(168, 85, 247, 0.4)',
              transition: 'transform 0.15s ease'
            }}
            onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.98)'}
            onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
          >
            {isReady ? (
              <>
                <CheckCircle2 size={18} />
                <span>Restart & Apply Update Now</span>
              </>
            ) : downloading ? (
              <>
                <RefreshCw size={18} className="spin-animation" />
                <span>Downloading ({progress}%)...</span>
              </>
            ) : (
              <>
                <Zap size={18} />
                <span>Download & Install v{newVersion}</span>
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
