import React, { useState, useEffect } from 'react';
import { Lock, User, Mail, Key, ShieldCheck, RefreshCw, AlertTriangle, ArrowRight, ExternalLink } from 'lucide-react';

export default function AuthModal({ onAuthSuccess }) {
  const [activeTab, setActiveTab] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [captchaData, setCaptchaData] = useState(null);
  const [loadingCaptcha, setLoadingCaptcha] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const loadCaptcha = async () => {
    setLoadingCaptcha(true);
    setErrorMsg('');
    try {
      if (window.electron?.getCaptcha) {
        const data = await window.electron.getCaptcha();
        if (data && data.image) {
          setCaptchaData(data);
          setCaptchaAnswer('');
        }
      }
    } catch (err) {
      console.error('Failed to load captcha:', err);
    } finally {
      setLoadingCaptcha(false);
    }
  };

  useEffect(() => {
    loadCaptcha();
  }, [activeTab]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    if (activeTab === 'register') {
      if (password.length < 6) {
        setErrorMsg('Password must be at least 6 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setErrorMsg('Passwords do not match.');
        return;
      }
    }

    if (!captchaAnswer.trim()) {
      setErrorMsg('Please solve the Anti-Bot security challenge.');
      return;
    }

    setSubmitting(true);
    try {
      if (activeTab === 'login') {
        const res = await window.electron.login(username.trim(), password);
        if (res && res.success) {
          if (onAuthSuccess) onAuthSuccess(res.user, res.subscription);
        } else {
          setErrorMsg(res?.error || 'Login failed. Please check your credentials.');
          loadCaptcha();
        }
      } else {
        const res = await window.electron.register(
          username.trim(), 
          email.trim(), 
          password, 
          captchaData?.token || '', 
          captchaAnswer.trim()
        );
        if (res && res.success) {
          if (onAuthSuccess) onAuthSuccess(res.user, res.subscription);
        } else {
          setErrorMsg(res?.error || 'Registration failed.');
          loadCaptcha();
        }
      }
    } catch (err) {
      setErrorMsg(err.message || 'Authentication network error.');
      loadCaptcha();
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenWebsite = () => {
    if (window.electron?.openFolder) {
      window.electron.openFolder('https://wavely.lol/pricing');
    }
  };

  return (
    <div className="auth-overlay" style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      background: 'rgba(5, 7, 12, 0.88)',
      backdropFilter: 'blur(16px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1.5rem'
    }}>
      <div className="auth-dialog" style={{
        width: '100%',
        maxWidth: '440px',
        background: 'linear-gradient(145deg, rgba(18, 24, 38, 0.95), rgba(10, 15, 26, 0.98))',
        border: '1px solid rgba(6, 182, 212, 0.35)',
        borderRadius: '20px',
        padding: '2.5rem',
        boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8), 0 0 35px rgba(6, 182, 212, 0.2)'
      }}>
        
        {/* Brand Header */}
        <div className="auth-brand-header" style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <div className="auth-brand-mark" style={{
            width: '48px',
            height: '48px',
            background: 'linear-gradient(135deg, #06b6d4, #8b5cf6)',
            borderRadius: '12px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '0.75rem',
            boxShadow: '0 0 20px rgba(6, 182, 212, 0.5)'
          }}>
            <span></span><span></span><span></span><span></span><span></span>
          </div>
          <h2 style={{ fontSize: '1.6rem', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.5px' }}>
            {activeTab === 'login' ? 'Sign In to Wavely' : 'Create Wavely Account'}
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            {activeTab === 'login' 
              ? 'Pick up where your last session left off.' 
              : 'Create an account for your studio.'}
          </p>
          <div className="auth-persistence-note">
            <ShieldCheck size={13} />
            <span>You’ll stay signed in securely on this device.</span>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="auth-tabs" style={{
          display: 'flex',
          background: 'rgba(0, 0, 0, 0.4)',
          borderRadius: '10px',
          padding: '4px',
          marginBottom: '1.5rem',
          border: '1px solid rgba(255, 255, 255, 0.08)'
        }}>
          <button
            type="button"
            className={activeTab === 'login' ? 'active' : ''}
            onClick={() => { setActiveTab('login'); setErrorMsg(''); }}
            style={{
              flex: 1,
              padding: '0.55rem',
              borderRadius: '8px',
              border: 'none',
              background: activeTab === 'login' ? 'rgba(6, 182, 212, 0.2)' : 'transparent',
              color: activeTab === 'login' ? '#00f2fe' : '#94a3b8',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            className={activeTab === 'register' ? 'active' : ''}
            onClick={() => { setActiveTab('register'); setErrorMsg(''); }}
            style={{
              flex: 1,
              padding: '0.55rem',
              borderRadius: '8px',
              border: 'none',
              background: activeTab === 'register' ? 'rgba(6, 182, 212, 0.2)' : 'transparent',
              color: activeTab === 'register' ? '#00f2fe' : '#94a3b8',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
          >
            Create Account
          </button>
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div className="auth-error" style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: '10px',
            padding: '0.75rem 1rem',
            color: '#f87171',
            fontSize: '0.85rem',
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.65rem'
          }}>
            <AlertTriangle size={16} flexShrink={0} />
            <span>{errorMsg}</span>
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          {/* Username */}
          <div className="auth-field" style={{ marginBottom: '1rem' }}>
            <div className="auth-input-wrap" style={{
              display: 'flex',
              alignItems: 'center',
              background: 'rgba(0, 0, 0, 0.5)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '10px',
              padding: '0 0.85rem'
            }}>
              <User size={16} color="#64748b" />
              <input
                type="text"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: '#ffffff',
                  padding: '0.75rem 0.65rem',
                  fontSize: '0.9rem'
                }}
              />
            </div>
          </div>

          {/* Email (Register Only) */}
          {activeTab === 'register' && (
            <div className="auth-field" style={{ marginBottom: '1rem' }}>
              <div className="auth-input-wrap" style={{
                display: 'flex',
                alignItems: 'center',
                background: 'rgba(0, 0, 0, 0.5)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '10px',
                padding: '0 0.85rem'
              }}>
                <Mail size={16} color="#64748b" />
                <input
                  type="email"
                  placeholder="Email Address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    color: '#ffffff',
                    padding: '0.75rem 0.65rem',
                    fontSize: '0.9rem'
                  }}
                />
              </div>
            </div>
          )}

          {/* Password */}
          <div className="auth-field" style={{ marginBottom: '1rem' }}>
            <div className="auth-input-wrap" style={{
              display: 'flex',
              alignItems: 'center',
              background: 'rgba(0, 0, 0, 0.5)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '10px',
              padding: '0 0.85rem'
            }}>
              <Key size={16} color="#64748b" />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: '#ffffff',
                  padding: '0.75rem 0.65rem',
                  fontSize: '0.9rem'
                }}
              />
            </div>
          </div>

          {/* Confirm Password (Register Only) */}
          {activeTab === 'register' && (
            <div className="auth-field" style={{ marginBottom: '1rem' }}>
              <div className="auth-input-wrap" style={{
                display: 'flex',
                alignItems: 'center',
                background: 'rgba(0, 0, 0, 0.5)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '10px',
                padding: '0 0.85rem'
              }}>
                <Key size={16} color="#64748b" />
                <input
                  type="password"
                  placeholder="Confirm Password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    color: '#ffffff',
                    padding: '0.75rem 0.65rem',
                    fontSize: '0.9rem'
                  }}
                />
              </div>
            </div>
          )}

          {/* Anti-Bot Captcha */}
          <div className="auth-captcha" style={{
            background: 'rgba(0, 0, 0, 0.35)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '0.85rem',
            marginBottom: '1.25rem'
          }}>
            <div className="auth-captcha-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#06b6d4', textTransform: 'uppercase' }}>
                Security check
              </span>
              <button
                type="button"
                onClick={loadCaptcha}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem'
                }}
              >
                <RefreshCw size={12} className={loadingCaptcha ? 'spin-anim' : ''} />
                <span>Refresh</span>
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.65rem', minHeight: '65px', alignItems: 'center' }}>
              {captchaData?.image ? (
                <img src={captchaData.image} alt="Captcha" style={{ height: '60px', borderRadius: '6px' }} />
              ) : (
                <span style={{ color: '#64748b', fontSize: '0.8rem' }}>Loading security image...</span>
              )}
            </div>

            <input
              type="text"
              placeholder={captchaData?.is_math ? "Enter math answer..." : "Enter letters/numbers..."}
              value={captchaAnswer}
              onChange={(e) => setCaptchaAnswer(e.target.value)}
              required
              style={{
                width: '100%',
                background: 'rgba(0, 0, 0, 0.5)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '8px',
                color: '#ffffff',
                padding: '0.55rem',
                textAlign: 'center',
                fontWeight: 'bold',
                fontSize: '0.9rem',
                outline: 'none'
              }}
            />
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            className="auth-submit"
            disabled={submitting}
            style={{
              width: '100%',
              padding: '0.85rem',
              borderRadius: '9999px',
              border: 'none',
              background: 'linear-gradient(135deg, #06b6d4, #8b5cf6)',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '0.95rem',
              cursor: submitting ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              boxShadow: '0 4px 20px rgba(6, 182, 212, 0.4)'
            }}
          >
            <span>{submitting ? 'Authenticating...' : (activeTab === 'login' ? 'Sign In' : 'Create Account')}</span>
            <ArrowRight size={16} />
          </button>
        </form>

        {/* Upgrade / Website Link */}
        <div className="auth-dialog-footer" style={{ textAlign: 'center', marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
          <button
            type="button"
            onClick={handleOpenWebsite}
            style={{
              background: 'none',
              border: 'none',
              color: '#06b6d4',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem'
            }}
          >
            <span>View Wavely Pro · $4.99/mo</span>
            <ExternalLink size={13} />
          </button>
        </div>

      </div>
    </div>
  );
}
