import React, { useState } from 'react';
import { Lock, Sparkles, ExternalLink, RefreshCw, LogOut, CheckCircle2 } from 'lucide-react';

export default function SubscriptionGate({ user, onRefreshStatus, onLogout }) {
  const [checking, setChecking] = useState(false);

  const handleOpenPricing = () => {
    if (window.electron?.openFolder) {
      window.electron.openFolder('https://wavely.lol/pricing');
    }
  };

  const handleRefresh = async () => {
    setChecking(true);
    try {
      if (onRefreshStatus) await onRefreshStatus();
    } finally {
      setTimeout(() => setChecking(false), 800);
    }
  };

  return (
    <div className="subscription-overlay" style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9990,
      background: 'rgba(5, 7, 12, 0.94)',
      backdropFilter: 'blur(20px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem'
    }}>
      <div className="subscription-dialog" style={{
        maxWidth: '560px',
        width: '100%',
        background: 'linear-gradient(145deg, rgba(18, 24, 38, 0.95), rgba(10, 15, 26, 0.98))',
        border: '2px solid rgba(6, 182, 212, 0.5)',
        borderRadius: '24px',
        padding: '3rem 2.5rem',
        textAlign: 'center',
        boxShadow: '0 25px 60px rgba(0, 0, 0, 0.9), 0 0 45px rgba(6, 182, 212, 0.25)'
      }}>
        
        {/* Glow Icon */}
        <div className="subscription-mark" style={{
          width: '64px',
          height: '64px',
          background: 'linear-gradient(135deg, #06b6d4, #8b5cf6)',
          borderRadius: '18px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '1.5rem',
          boxShadow: '0 0 25px rgba(6, 182, 212, 0.6)'
        }}>
          <span></span><span></span><span></span><span></span><span></span>
        </div>

        <h2 style={{ fontSize: '2rem', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.5px', marginBottom: '0.75rem' }}>
          Subscription Required
        </h2>

        <p style={{ color: '#94a3b8', fontSize: '1.05rem', lineHeight: '1.6', marginBottom: '2rem' }}>
          Welcome, <strong style={{ color: '#ffffff' }}>{user?.username || 'Producer'}</strong>. Your Wavely account does not have an active membership. Subscribe at <strong style={{ color: '#06b6d4' }}>wavely.lol</strong> to unlock unlimited DAW-synced sample downloads and VST synth presets.
        </p>

        {/* Feature Highlights */}
        <div className="subscription-features" style={{
          background: 'rgba(0, 0, 0, 0.4)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '14px',
          padding: '1.25rem',
          textAlign: 'left',
          marginBottom: '2rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          fontSize: '0.9rem',
          color: '#f8fafc'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <CheckCircle2 size={16} color="#06b6d4" />
            <span>Zero-Silence & Sony ACID DAW Tempo Quantization</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <CheckCircle2 size={16} color="#06b6d4" />
            <span>Serum, Vital, Massive & PhasePlant VST Presets</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <CheckCircle2 size={16} color="#06b6d4" />
            <span>1-Click High-Speed Full Sample Pack Downloader</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="subscription-actions" style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <button
            onClick={handleOpenPricing}
            className="subscription-primary"
            style={{
              padding: '0.95rem',
              borderRadius: '9999px',
              border: 'none',
              background: 'linear-gradient(135deg, #06b6d4, #8b5cf6)',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: '1.05rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              boxShadow: '0 4px 25px rgba(6, 182, 212, 0.5)'
            }}
          >
            <span>Subscribe on wavely.lol — $4.99/mo</span>
            <ExternalLink size={18} />
          </button>

          <button
            onClick={handleRefresh}
            className="subscription-secondary"
            disabled={checking}
            style={{
              padding: '0.8rem',
              borderRadius: '9999px',
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: '#f8fafc',
              fontWeight: 600,
              fontSize: '0.95rem',
              cursor: checking ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem'
            }}
          >
            <RefreshCw size={15} className={checking ? 'spin-anim' : ''} />
            <span>{checking ? 'Verifying Account Status...' : 'I Have Subscribed (Refresh Status)'}</span>
          </button>
        </div>

        {/* Logout Switch Account */}
        <div className="subscription-footer" style={{ marginTop: '2rem', paddingTop: '1.25rem', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
          <button
            onClick={onLogout}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              fontSize: '0.85rem',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem'
            }}
          >
            <LogOut size={14} />
            <span>Sign In to Another Account</span>
          </button>
        </div>

      </div>
    </div>
  );
}
