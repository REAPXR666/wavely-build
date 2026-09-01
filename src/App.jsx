import React, { useState, useEffect } from 'react';
import { ShieldAlert, ChevronRight, Minimize2 } from 'lucide-react';
import Sidebar from './components/Sidebar';
import PlayerBar from './components/PlayerBar';
import DownloadStatusIndicator from './components/DownloadStatusIndicator';
import MiniDockPlayer from './components/MiniDockPlayer';
import AuthModal from './components/AuthModal';
import SubscriptionGate from './components/SubscriptionGate';
import SoundsPage from './pages/SoundsPage';
import PresetsPage from './pages/PresetsPage';
import PacksPage from './pages/PacksPage';
import AnalyserPage from './pages/AnalyserPage';
import SettingsPage from './pages/SettingsPage';
import UpdateCelebrationModal from './components/UpdateCelebrationModal';

export default function App() {
  const [activeTab, setActiveTab] = useState('sounds');
  
  // User Authentication & Subscription Licensing State
  const [authState, setAuthState] = useState({
    isLoggedIn: false,
    user: null,
    subscription: { isSubscribed: false, plan: 'none' }
  });
  const [authChecked, setAuthChecked] = useState(false);
  
  // Custom Toast State
  const [toasts, setToasts] = useState([]);
  
  // Device Banned Lockout State
  const [bannedInfo, setBannedInfo] = useState(null);

  // Global Audio Playback State
  const [currentSound, setCurrentSound] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [isLooping, setIsLooping] = useState(false);
  
  // Sounds list sharing for player row skipping
  const [soundsList, setSoundsList] = useState([]);
  const [downloadsList, setDownloadsList] = useState([]);

  // Settings & Library Stats State
  const [settings, setSettings] = useState({
    downloadDir: '',
    presetDir: '',
    theme: 'dark'
  });
  const [stats, setStats] = useState({
    downloadedCount: 0,
    presetsCount: 0,
    indexedPacks: []
  });

  // Pack browsing state shared between tabs
  const [activePack, setActivePack] = useState(null);

  // Floating Always-on-Top Mini DAW Dock State
  const [isMiniDock, setIsMiniDock] = useState(false);

  // New Release Update Celebration State
  const [availableUpdate, setAvailableUpdate] = useState(null);

  const handleBrowsePack = (pack) => {
    setActivePack({
      uuid: pack.uuid,
      name: pack.name,
      coverArtUrl: pack.coverArtUrl
    });
    setActiveTab('sounds');
  };

  // Custom slide-up toast handler in bottom center
  const showToast = (message, type = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    
    // Auto remove after 4 seconds
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  const removeToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  // Initial load & Licensing Telemetry Listener
  useEffect(() => {
    const bootstrapApp = async () => {
      try {
        // Fetch settings from Electron main
        const loadedSettings = await window.electron.getSettings();
        setSettings(loadedSettings);
        
        // Apply visual theme to DOM
        document.documentElement.setAttribute('data-theme', loadedSettings.theme || 'dark');
        
        // Fetch library stats
        const loadedStats = await window.electron.getIndexedPacks();
        setStats(loadedStats);

        // Check if device is banned on startup
        if (window.electron.getLicensingState) {
          const lic = await window.electron.getLicensingState();
          if (lic && (lic.isBanned || lic.status === 'banned' || lic.status === 'tampered')) {
            setBannedInfo({
              hwid: lic.hwidInfo?.hwid || 'UNKNOWN',
              pcName: lic.hwidInfo?.pcName || 'UNKNOWN',
              banReason: lic.banReason || 'Access revoked by administrator.',
              timestamp: lic.lastChecked || new Date().toISOString()
            });
          }
        }
        // Check Authentication & Subscription State
        if (window.electron.getAuthState) {
          const auth = await window.electron.getAuthState();
          if (auth && auth.isLoggedIn) {
            setAuthState(auth);
            // Verify active subscription
            const verifyRes = await window.electron.verifySubscription();
            if (verifyRes && verifyRes.isSubscribed !== undefined) {
              setAuthState(prev => ({
                ...prev,
                subscription: {
                  isSubscribed: verifyRes.isSubscribed,
                  plan: verifyRes.plan || 'none'
                }
              }));
            }
          } else {
            setAuthState({ isLoggedIn: false, user: null, subscription: { isSubscribed: false, plan: 'none' } });
          }
          setAuthChecked(true);
        }
      } catch (err) {
        console.error('Failed to bootstrap app:', err);
      }
    };
    bootstrapApp();

    // Listen for live ban events pushed from admin
    if (window.electron.onDeviceBanned) {
      const unsubscribe = window.electron.onDeviceBanned((data) => {
        setIsPlaying(false);
        setBannedInfo(data);
      });
      return () => {
        if (unsubscribe) unsubscribe();
      };
    }

    // Listen for subscription status updates
    if (window.electron.onSubscriptionStatus) {
      const unsubSub = window.electron.onSubscriptionStatus((subData) => {
        setAuthState(prev => ({ ...prev, subscription: subData }));
      });
      return () => {
        if (unsubSub) unsubSub();
      };
    }

    // Listen for Mini Dock toggle updates
    if (window.electron.onMiniDockStateChanged) {
      const unsubDock = window.electron.onMiniDockStateChanged((dockState) => {
        setIsMiniDock(dockState);
      });
      return () => {
        if (unsubDock) unsubDock();
      };
    }

    // Listen for New Release Update available
    if (window.electron.onUpdateAvailable) {
      const unsubUpdate = window.electron.onUpdateAvailable((updateInfo) => {
        setAvailableUpdate(updateInfo);
      });
      return () => {
        if (unsubUpdate) unsubUpdate();
      };
    }
  }, []);

  // Fetch all downloads when downloads tab is selected
  useEffect(() => {
    if (activeTab === 'downloads') {
      const loadDownloads = async () => {
        try {
          const results = await window.electron.searchSounds('');
          setDownloadsList(results.filter(s => s.isDownloaded));
        } catch (err) {
          console.error('Failed to load downloads:', err);
        }
      };
      loadDownloads();
    }
  }, [activeTab]);

  // Sync active play volume when volume slider moves
  useEffect(() => {
    // If wavesurfer has a global audio context or if we have active nodes, volume is synced.
    // Our WaveformRenderer listens to parent volume state and updates its wavesurfer instance!
  }, [volume]);

  // Refresh current sound list results
  const handleRefreshSounds = async () => {
    try {
      const results = await window.electron.searchSounds('', { sortBy: 'recent' });
      setSoundsList(results);
    } catch (err) {
      console.error('Refresh sounds failed:', err);
    }
  };

  // Keyboard/Playbar navigation: Skip to next sample in the search list
  const handleNextSound = () => {
    if (!currentSound || soundsList.length === 0) return;
    const currentIndex = soundsList.findIndex(sound => sound.id === currentSound.id);
    if (currentIndex === -1) return;
    
    const nextIndex = (currentIndex + 1) % soundsList.length;
    setCurrentSound(soundsList[nextIndex]);
    setIsPlaying(true);
  };

  // Keyboard/Playbar navigation: Skip to previous sample in the search list
  const handlePreviousSound = () => {
    if (!currentSound || soundsList.length === 0) return;
    const currentIndex = soundsList.findIndex(sound => sound.id === currentSound.id);
    if (currentIndex === -1) return;
    
    const prevIndex = (currentIndex - 1 + soundsList.length) % soundsList.length;
    setCurrentSound(soundsList[prevIndex]);
    setIsPlaying(true);
  };

  // Render active router page page component
  const renderPageContent = () => {
    switch (activeTab) {
      case 'sounds':
        return (
          <SoundsPage 
            currentSound={currentSound}
            setCurrentSound={setCurrentSound}
            isPlaying={isPlaying}
            setIsPlaying={setIsPlaying}
            volume={volume}
            isLooping={isLooping}
            setSoundsList={setSoundsList}
            soundsList={soundsList}
            showToast={showToast}
            isDownloadsPage={false}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            activePack={activePack}
            setActivePack={setActivePack}
            user={authState.user}
            subscription={authState.subscription}
          />
        );
      case 'presets':
        return (
          <PresetsPage 
            currentSound={currentSound}
            setCurrentSound={setCurrentSound}
            isPlaying={isPlaying}
            setIsPlaying={setIsPlaying}
            stats={stats}
            setStats={setStats}
            showToast={showToast}
          />
        );
      case 'packs':
        return (
          <PacksPage 
            currentSound={currentSound}
            setCurrentSound={setCurrentSound}
            isPlaying={isPlaying}
            setIsPlaying={setIsPlaying}
            stats={stats}
            setStats={setStats}
            settings={settings}
            setSettings={setSettings}
            setActiveTab={setActiveTab}
            onRefreshSounds={handleRefreshSounds}
            onBrowsePack={handleBrowsePack}
            showToast={showToast}
            setIsGlobalPlaying={setIsPlaying}
          />
        );
      case 'downloads':
        return (
          <SoundsPage 
            currentSound={currentSound}
            setCurrentSound={setCurrentSound}
            isPlaying={isPlaying}
            setIsPlaying={setIsPlaying}
            volume={volume}
            isLooping={isLooping}
            setSoundsList={setDownloadsList}
            soundsList={downloadsList}
            showToast={showToast}
            isDownloadsPage={true}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            user={authState.user}
            subscription={authState.subscription}
          />
        );
      case 'analyser':
        return (
          <AnalyserPage 
            user={authState.user}
            subscription={authState.subscription}
            showToast={showToast}
            volume={volume}
            currentSound={currentSound}
            setCurrentSound={setCurrentSound}
            isPlaying={isPlaying}
            setIsPlaying={setIsPlaying}
            setActiveTab={setActiveTab}
          />
        );
      case 'settings':
        return (
          <SettingsPage 
            settings={settings}
            setSettings={setSettings}
            setStats={setStats}
            onRefreshSounds={handleRefreshSounds}
          />
        );
      default:
        return <div style={{ color: 'var(--text-muted)' }}>Page not found</div>;
    }
  };

  const pageLabels = {
    sounds: 'Sounds',
    presets: 'Presets',
    packs: 'Packs',
    analyser: 'Analyser',
    downloads: 'Downloads',
    settings: 'Settings'
  };
  const activePageLabel = pageLabels[activeTab] || 'Library';
  const displayName = authState.user?.username || 'Producer';
  const displayInitial = displayName.charAt(0).toUpperCase();

  // If in Mini DAW Dock Mode, render floating player directly
  if (isMiniDock) {
    return (
      <MiniDockPlayer 
        currentSound={currentSound}
        isPlaying={isPlaying}
        setIsPlaying={setIsPlaying}
        onExitMiniDock={() => {
          if (window.electron?.setMiniDockMode) {
            window.electron.setMiniDockMode(false);
          }
        }}
        onSearch={(q) => {
          if (window.electron?.setMiniDockMode) {
            window.electron.setMiniDockMode(false);
          }
          setActiveTab('sounds');
        }}
        pitchSemitones={0}
        setPitchSemitones={() => {}}
        speedMultiplier={1.0}
        setSpeedMultiplier={() => {}}
      />
    );
  }

  return (
    <div className="app-container">
      {/* Sidebar navigation */}
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        stats={stats}
      />

      <div className="main-layout">
        <header className="app-topbar">
          <div className="topbar-breadcrumb" aria-label="Current section">
            <span>Library</span>
            <ChevronRight size={12} />
            <strong>{activePageLabel}</strong>
          </div>
          <div className="topbar-actions">
            {/* Floating Mini DAW Dock Mode Trigger */}
            <button
              type="button"
              className="topbar-action-btn"
              title="Switch to Floating Always-On-Top Mini DAW Dock"
              onClick={() => {
                if (window.electron?.setMiniDockMode) {
                  window.electron.setMiniDockMode(true);
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 10px',
                background: 'rgba(56, 189, 248, 0.12)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                borderRadius: '6px',
                color: '#38bdf8',
                fontSize: '0.78rem',
                fontWeight: '700',
                cursor: 'pointer'
              }}
            >
              <Minimize2 size={13} />
              <span>Mini Dock</span>
            </button>

            <span className="topbar-ready"><span></span>Ready</span>
            <button type="button" className="account-button" onClick={() => setActiveTab('settings')}>
              <span className="account-avatar">{displayInitial}</span>
              <span className="account-name">{displayName}</span>
              {authState.subscription?.isSubscribed && <span className="account-plan">Pro</span>}
            </button>
          </div>
        </header>

        {/* Scrollable primary content */}
        <main className="content-area">
          {renderPageContent()}
        </main>

        {/* Custom Popup Toast Container in the bottom center */}
        <div className="toast-container">
          {toasts.map(t => (
            <div key={t.id} className={`toast-popup ${t.type}`}>
              <span className="toast-icon">{t.type === 'success' ? '✓' : '✕'}</span>
              <span className="toast-message">{t.message}</span>
              <button 
                className="toast-close-btn" 
                onClick={() => removeToast(t.id)}
                title="Dismiss popup"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        {/* Global Bottom Playback control bar */}
        <PlayerBar 
          currentSound={currentSound}
          isPlaying={isPlaying}
          setIsPlaying={setIsPlaying}
          volume={volume}
          setVolume={setVolume}
          isLooping={isLooping}
          setIsLooping={setIsLooping}
          onNext={handleNextSound}
          onPrevious={handlePreviousSound}
          onOpenAnalyser={(sound) => {
            setActiveTab('analyser');
          }}
        />

        {/* Global Floating Download Status Indicator */}
        <DownloadStatusIndicator />
      </div>

      {/* Full-Screen Unclosable Banned Lockout Screen */}
      {bannedInfo && (
        <div className="banned-lockout-backdrop">
          <div className="banned-lockout-card">
            <div className="banned-lockout-header">
              <div className="banned-lockout-icon-wrap">
                <ShieldAlert size={42} color="#ef4444" />
              </div>
              <h2 className="banned-lockout-title">Application Access Suspended</h2>
              <p className="banned-lockout-subtitle">
                This device has been locked out by the system administrator.
              </p>
            </div>

            <div className="banned-lockout-body">
              <div className="banned-info-row">
                <span className="banned-info-label">Hardware ID (HWID):</span>
                <code className="banned-info-code">{bannedInfo.hwid || 'N/A'}</code>
              </div>
              <div className="banned-info-row">
                <span className="banned-info-label">Machine Name:</span>
                <span className="banned-info-val">{bannedInfo.pcName || 'Unknown PC'}</span>
              </div>
              <div className="banned-info-row">
                <span className="banned-info-label">Reason:</span>
                <span className="banned-info-val ban-reason-text">{bannedInfo.banReason || 'Access revoked by administrator.'}</span>
              </div>
              <div className="banned-info-row">
                <span className="banned-info-label">Lock Timestamp:</span>
                <span className="banned-info-val">{new Date(bannedInfo.timestamp || Date.now()).toLocaleString()}</span>
              </div>
            </div>

            <div className="banned-lockout-footer">
              <p className="banned-footer-text">
                If you believe this suspension is in error or wish to appeal, please contact the administrator providing your Hardware ID above.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 1. Auth Modal (If user is not signed in) */}
      {!bannedInfo && authChecked && !authState.isLoggedIn && (
        <AuthModal 
          onAuthSuccess={(user, subscription) => {
            setAuthState({ 
              isLoggedIn: true, 
              user, 
              subscription: subscription || { isSubscribed: false, plan: 'none' } 
            });
            showToast(`Welcome to Wavely, ${user.username}!`);
          }}
        />
      )}

      {/* 2. Subscription Paywall Gate (If user is logged in but has no active subscription) */}
      {!bannedInfo && authChecked && authState.isLoggedIn && !authState.subscription?.isSubscribed && (
        <SubscriptionGate 
          user={authState.user}
          onRefreshStatus={async () => {
            const res = await window.electron.verifySubscription();
            if (res && res.isSubscribed) {
              setAuthState(prev => ({ 
                ...prev, 
                subscription: { isSubscribed: true, plan: res.plan, expiresAt: res.expiresAt } 
              }));
              showToast("Subscription verified! All features unlocked.", "success");
            } else {
              showToast("No active subscription found on wavely.lol yet.", "error");
            }
          }}
          onLogout={async () => {
            await window.electron.logout();
            setAuthState({ isLoggedIn: false, user: null, subscription: { isSubscribed: false, plan: 'none' } });
          }}
        />
      )}

      {!bannedInfo && !authChecked && (
        <div className="session-loading-overlay" aria-live="polite">
          <div className="session-loading-content">
            <span className="brand-mark session-loading-mark" aria-hidden="true">
              <span></span><span></span><span></span><span></span><span></span>
            </span>
            <span>Opening your studio…</span>
          </div>
        </div>
      )}

      {/* New Release Celebration Confetti Modal */}
      {availableUpdate && (
        <UpdateCelebrationModal
          updateData={availableUpdate}
          onClose={() => setAvailableUpdate(null)}
        />
      )}
    </div>
  );
}
