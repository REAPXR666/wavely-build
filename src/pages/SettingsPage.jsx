import React, { useState } from 'react';
import { FolderOpen, RefreshCw, Sun, Moon, Trash2, Check } from 'lucide-react';

export default function SettingsPage({ settings, setSettings, setStats, onRefreshSounds }) {
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState('');

  const handleSelectDownloadDir = async () => {
    try {
      const selectedPath = await window.electron.selectFolder();
      if (selectedPath) {
        const newSettings = await window.electron.saveSettings({ downloadDir: selectedPath });
        setSettings(newSettings);
      }
    } catch (err) {
      console.error('Folder dialog error:', err);
    }
  };

  const handleSelectPresetDir = async () => {
    try {
      const selectedPath = await window.electron.selectFolder();
      if (selectedPath) {
        const newSettings = await window.electron.saveSettings({ presetDir: selectedPath });
        setSettings(newSettings);
      }
    } catch (err) {
      console.error('Folder dialog error:', err);
    }
  };

  const handleSelectPackDownloadDir = async () => {
    try {
      const selectedPath = await window.electron.selectFolder();
      if (selectedPath) {
        const newSettings = await window.electron.saveSettings({ packDownloadDir: selectedPath });
        setSettings(newSettings);
      }
    } catch (err) {
      console.error('Pack folder dialog error:', err);
    }
  };

  const handleToggleAutoPackDir = async (alwaysUse) => {
    try {
      const newSettings = await window.electron.saveSettings({ alwaysUseDefaultPackDir: alwaysUse });
      setSettings(newSettings);
    } catch (err) {
      console.error('Setting save error:', err);
    }
  };

  const handleOpenFolder = (folderPath) => {
    if (folderPath && window.electron?.openFolder) {
      window.electron.openFolder(folderPath);
    }
  };

  const handleThemeChange = async (theme) => {
    try {
      const newSettings = await window.electron.saveSettings({ theme });
      setSettings(newSettings);
      document.documentElement.setAttribute('data-theme', theme);
    } catch (err) {
      console.error('Theme save error:', err);
    }
  };

  const handleScanLibrary = async () => {
    setScanning(true);
    setScanResult('Scanning folders...');
    try {
      const result = await window.electron.scanLibrary();
      setScanResult(`Scan complete! Added ${result.count} new files. Total indexed: ${result.totalIndexed}.`);
      
      // Update global sound lists & stats
      if (onRefreshSounds) onRefreshSounds();
      const updatedStats = await window.electron.getIndexedPacks();
      setStats(updatedStats);
    } catch (err) {
      setScanResult(`Scan failed: ${err.message}`);
    }
    setScanning(false);
  };

  return (
    <div className="settings-container">
      <div className="top-bar">
        <div>
          <div className="page-eyebrow">DESKTOP PREFERENCES</div>
          <h2 style={{ fontSize: '2.15rem', fontWeight: '800', letterSpacing: '-0.055em' }}>
            Make Wavely yours.
          </h2>
        </div>
      </div>

      {/* Visual Themes Card */}
      <div className="settings-card">
        <h3 className="settings-title">Visual Theme</h3>
        <div className="setting-group">
          <label className="setting-label">Select Interface Style</label>
          <div className="theme-toggle-row">
            <button 
              className={`theme-btn ${settings.theme === 'dark' ? 'active' : ''}`}
              onClick={() => handleThemeChange('dark')}
            >
              <Moon size={16} />
              <span>Wavely Dark</span>
            </button>
            <button 
              className={`theme-btn ${settings.theme === 'light' ? 'active' : ''}`}
              onClick={() => handleThemeChange('light')}
            >
              <Sun size={16} />
              <span>Modern Light</span>
            </button>
          </div>
        </div>
      </div>

      {/* File System Library paths Card */}
      <div className="settings-card">
        <h3 className="settings-title">Library & Download Folders</h3>
        
        {/* Sample Packs Dedicated Download Directory */}
        <div className="setting-group featured-setting-group">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <label className="setting-label" style={{ color: 'var(--accent-color, #7c3aed)', fontWeight: '700', margin: 0 }}>
              Default sample pack folder
            </label>
            {settings.packDownloadDir && (
              <button 
                className="settings-btn" 
                style={{ padding: '4px 10px', fontSize: '0.75rem', height: 'auto' }}
                onClick={() => handleOpenFolder(settings.packDownloadDir)}
                title="Open packs directory in File Explorer"
              >
                <FolderOpen size={13} />
                <span>Open Folder</span>
              </button>
            )}
          </div>
          <div className="setting-row">
            <input 
              type="text" 
              readOnly 
              value={settings.packDownloadDir || ''} 
              className="setting-input"
              placeholder="e.g. C:\Users\YourName\Music\WavelyPacks"
            />
            <button className="settings-btn primary" onClick={handleSelectPackDownloadDir}>
              <FolderOpen size={16} />
              <span>Browse Folder</span>
            </button>
          </div>
          
          {/* 1-Click Auto Save Checkbox Toggle */}
          <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }} onClick={() => handleToggleAutoPackDir(!settings.alwaysUseDefaultPackDir)}>
            <input 
              type="checkbox" 
              id="alwaysUseDefaultPackDir"
              checked={settings.alwaysUseDefaultPackDir !== false}
              onChange={(e) => handleToggleAutoPackDir(e.target.checked)}
              style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: 'var(--accent-color, #7c3aed)' }}
            />
            <label htmlFor="alwaysUseDefaultPackDir" style={{ fontSize: '0.82rem', fontWeight: '600', color: 'var(--text-main, #ffffff)', cursor: 'pointer' }}>
              Always 1-click download packs directly to this folder (skip folder selection popup every time)
            </label>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px' }}>
            When enabled, clicking "Download All" on any sample pack card will automatically organize and save all samples into structured subfolders inside this directory without asking you to choose a folder each time.
          </p>
        </div>

        {/* Audio single sample downloads folder selector */}
        <div className="setting-group" style={{ marginTop: '20px' }}>
          <label className="setting-label">Single Sample Previews Directory</label>
          <div className="setting-row">
            <input 
              type="text" 
              readOnly 
              value={settings.downloadDir || ''} 
              className="setting-input"
            />
            <button className="settings-btn" onClick={handleSelectDownloadDir}>
              <FolderOpen size={16} />
              <span>Browse</span>
            </button>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Individual sound previews downloaded from the Sounds page will be saved inside this directory.
          </p>
        </div>

        {/* VST Preset downloads folder selector */}
        <div className="setting-group" style={{ marginTop: '20px' }}>
          <label className="setting-label">VST Synthesizer Presets Directory</label>
          <div className="setting-row">
            <input 
              type="text" 
              readOnly 
              value={settings.presetDir || ''} 
              className="setting-input"
            />
            <button className="settings-btn" onClick={handleSelectPresetDir}>
              <FolderOpen size={16} />
              <span>Browse</span>
            </button>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Serum (.fxp) and Vital (.vital) VST preset files will be downloaded directly here.
          </p>
        </div>
      </div>

      {/* Manual library scanner & utility Card */}
      <div className="settings-card">
        <h3 className="settings-title">Library Indexer</h3>
        <div className="setting-group">
          <label className="setting-label">Manual Folder Scan</label>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
            If you have manually copied new WAV or MP3 files directly into your Wavely Library folder using Windows Explorer, trigger a scan below to instantly add them to your app search results.
          </p>
          <div className="setting-row" style={{ alignItems: 'center', gap: '16px' }}>
            <button 
              className="settings-btn primary"
              disabled={scanning}
              onClick={handleScanLibrary}
            >
              <RefreshCw size={16} className={scanning ? 'pulse-playing' : ''} />
              <span>{scanning ? 'Scanning Files...' : 'Scan Library Folder Now'}</span>
            </button>
            
            {scanResult && (
              <span style={{ fontSize: '0.85rem', fontWeight: '500', color: 'var(--accent-secondary)' }}>
                {scanResult}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Device Security & Machine License Card */}
      <DeviceLicenseCard />
    </div>
  );
}

function DeviceLicenseCard() {
  const [hwidInfo, setHwidInfo] = useState(null);
  const [copied, setCopied] = useState(false);

  React.useEffect(() => {
    if (window.electron.getLicensingState) {
      window.electron.getLicensingState().then(res => {
        if (res && res.hwidInfo) {
          setHwidInfo(res.hwidInfo);
        }
      }).catch(() => {});
    }
  }, []);

  const [authState, setAuthState] = React.useState(null);
  React.useEffect(() => {
    if (window.electron?.getAuthState) {
      window.electron.getAuthState().then(state => setAuthState(state)).catch(() => {});
    }
  }, []);

  const handleCopyHwid = () => {
    if (hwidInfo && hwidInfo.hwid) {
      navigator.clipboard.writeText(hwidInfo.hwid);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleLogout = async () => {
    if (window.electron?.logout) {
      await window.electron.logout();
      window.location.reload();
    }
  };

  return (
    <>
      {/* Wavely User Account & Subscription Card */}
      <div className="settings-card" style={{ border: '1px solid rgba(6, 182, 212, 0.35)', background: 'rgba(6, 182, 212, 0.03)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <h3 className="settings-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: 'var(--accent-cyan, #06b6d4)' }}>👤</span>
            <span>Wavely Account & Membership</span>
          </h3>
          {authState?.subscription?.isSubscribed ? (
            <span style={{ fontSize: '0.72rem', fontWeight: '700', textTransform: 'uppercase', color: '#10b981', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.4)', padding: '2px 8px', borderRadius: '9999px' }}>
              PRO SUBSCRIBER
            </span>
          ) : (
            <span style={{ fontSize: '0.72rem', fontWeight: '700', textTransform: 'uppercase', color: '#ef4444', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.4)', padding: '2px 8px', borderRadius: '9999px' }}>
              UNPAID / INACTIVE
            </span>
          )}
        </div>

        <div style={{ background: 'rgba(0, 0, 0, 0.3)', padding: '14px 16px', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.85rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-muted)' }}>Logged-in User:</span>
            <strong style={{ color: '#fff' }}>{authState?.user?.username || 'Authenticated User'} ({authState?.user?.email || 'wavely.lol'})</strong>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-muted)' }}>Membership Plan:</span>
            <strong style={{ color: 'var(--accent-cyan, #06b6d4)' }}>
              {authState?.subscription?.plan === 'monthly_499' ? 'Monthly Pro ($4.99/mo)' : 
               authState?.subscription?.plan === 'annual_45' ? 'Annual Pro ($45/yr)' : 
               authState?.subscription?.plan === 'lifetime_vip' ? 'Lifetime VIP' : 'No Active Plan'}
            </strong>
          </div>

          {authState?.subscription?.expiresAt && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-muted)' }}>Valid Until / Renews:</span>
              <span style={{ color: 'var(--text-main)' }}>{authState.subscription.expiresAt}</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', marginTop: '6px', paddingTop: '10px', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <button 
              className="settings-btn"
              style={{ flex: 1, background: 'rgba(6, 182, 212, 0.15)', borderColor: 'rgba(6, 182, 212, 0.4)', color: '#00f2fe' }}
              onClick={() => window.electron?.openFolder?.('https://wavely.lol/dashboard')}
            >
              Manage on wavely.lol
            </button>
            <button 
              className="settings-btn"
              style={{ background: 'rgba(239, 68, 68, 0.15)', borderColor: 'rgba(239, 68, 68, 0.4)', color: '#f87171' }}
              onClick={handleLogout}
            >
              Log Out
            </button>
          </div>
        </div>
      </div>

      {/* DAW Plugin & VST3 Bridge Management Card */}
      <div className="settings-card" style={{ border: '1px solid rgba(16, 185, 129, 0.3)', background: 'rgba(16, 185, 129, 0.03)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <h3 className="settings-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: '#10b981' }}>🔌</span>
            <span>DAW Companion Plugin (VST3 Bridge)</span>
          </h3>
          <span style={{ fontSize: '0.72rem', fontWeight: '700', textTransform: 'uppercase', color: '#10b981', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.4)', padding: '2px 8px', borderRadius: '9999px' }}>
            FL Studio • Ableton • Logic • Reaper
          </span>
        </div>

        <div style={{ background: 'rgba(0, 0, 0, 0.25)', padding: '14px 16px', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '0.85rem' }}>
          <p style={{ margin: 0, color: '#cbd5e1', lineHeight: '1.5' }}>
            Install the <strong>Wavely VST3 plugin</strong> into your DAW to unlock real-time project tempo sync, direct mixer monitoring, and 0-latency sample drag-and-drop into your arrangement playlist.
          </p>

          <div style={{ display: 'flex', gap: '10px', marginTop: '4px', flexWrap: 'wrap' }}>
            <button
              className="settings-btn"
              style={{ flex: 1, minWidth: '200px', background: 'rgba(16, 185, 129, 0.2)', borderColor: 'rgba(16, 185, 129, 0.5)', color: '#34d399', fontWeight: '700' }}
              onClick={async () => {
                if (window.electron?.installVstPlugin) {
                  const res = await window.electron.installVstPlugin();
                  if (res?.success) {
                    alert(`✅ Wavely VST3 Plugin successfully installed to:\n${res.path}\n\nOpen your DAW (FL Studio / Ableton / Logic) and run a plugin scan!`);
                  } else {
                    alert(`⚠️ Installation notice: ${res?.error || 'Could not copy to system folder. Try running as administrator.'}`);
                  }
                }
              }}
            >
              ⚡ Install to Default VST3 Folder
            </button>
            <button
              className="settings-btn"
              style={{ background: 'rgba(56, 189, 248, 0.15)', borderColor: 'rgba(56, 189, 248, 0.4)', color: '#38bdf8' }}
              onClick={async () => {
                try {
                  const customDir = await window.electron?.selectFolder?.();
                  if (customDir) {
                    const res = await window.electron.installVstPlugin(customDir);
                    if (res?.success) {
                      alert(`✅ Wavely VST3 Plugin installed to custom path:\n${res.path}\n\nPoint your DAW to this directory and scan!`);
                    } else {
                      alert(`⚠️ Custom installation failed: ${res?.error}`);
                    }
                  }
                } catch (e) {
                  console.error('Custom VST install error:', e);
                }
              }}
            >
              📁 Choose Custom Folder & Install
            </button>
            <button
              className="settings-btn"
              style={{ background: 'rgba(255, 255, 255, 0.08)', borderColor: 'rgba(255, 255, 255, 0.15)', color: '#f8fafc' }}
              onClick={() => window.electron?.openVstFolder?.()}
            >
              📂 Open VST3 Folder
            </button>
          </div>
        </div>
      </div>

      {/* Ableton Live 12 Native Sidebar Integration Card */}
      <div className="settings-card" style={{ border: '1px solid rgba(139, 92, 246, 0.35)', background: 'rgba(139, 92, 246, 0.03)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <h3 className="settings-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: '#a78bfa' }}>🎹</span>
            <span>Ableton Live 12 Native Sidebar Integration</span>
          </h3>
          <span style={{ fontSize: '0.72rem', fontWeight: '700', textTransform: 'uppercase', color: '#a78bfa', background: 'rgba(139, 92, 246, 0.15)', border: '1px solid rgba(139, 92, 246, 0.4)', padding: '2px 8px', borderRadius: '9999px' }}>
            PLACES EXTENSION
          </span>
        </div>

        <div style={{ background: 'rgba(0, 0, 0, 0.25)', padding: '14px 16px', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '0.85rem' }}>
          <p style={{ margin: 0, color: '#cbd5e1', lineHeight: '1.5' }}>
            Embeds <strong>Wavely</strong> directly into Ableton Live 12's left sidebar (under <em>Places</em>) with automatic account synchronization, full sample searching, and instant drag-and-drop into Audio Tracks, MIDI Tracks, and Drum Racks.
          </p>

          <div style={{ display: 'flex', gap: '10px', marginTop: '4px', flexWrap: 'wrap' }}>
            <button
              className="settings-btn"
              style={{ flex: 1, minWidth: '220px', background: 'rgba(139, 92, 246, 0.2)', borderColor: 'rgba(139, 92, 246, 0.5)', color: '#c4b5fd', fontWeight: '700' }}
              onClick={async () => {
                if (window.electron?.injectAbletonLive) {
                  const res = await window.electron.injectAbletonLive();
                  if (res?.success) {
                    alert(`✅ Wavely successfully synced with Ableton Live 12!\n\nInjected into ${res.injectedCount} target location(s).\nOpen Ableton Live 12 and click "Wavely" (or "Splice") under Places in the browser sidebar!`);
                  } else {
                    alert(`⚠️ Ableton sync notice: ${res?.error || 'No active Ableton Live 12 installation detected on this system.'}`);
                  }
                }
              }}
            >
              ⚡ Auto-Sync / Repair Ableton Sidebar
            </button>
          </div>
        </div>
      </div>

      {/* Device Security Card */}
      <div className="settings-card" style={{ border: '1px solid rgba(124, 58, 237, 0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <h3 className="settings-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: 'var(--accent-color, #7c3aed)' }}>🛡️</span>
            <span>Device Security & Machine License</span>
          </h3>
          <span style={{ fontSize: '0.72rem', fontWeight: '700', textTransform: 'uppercase', color: '#10b981', background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '2px 8px', borderRadius: '9999px' }}>
            Hardware Verified
          </span>
        </div>

        <div style={{ background: 'rgba(0, 0, 0, 0.25)', padding: '14px 16px', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.82rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <span style={{ color: 'var(--text-muted)' }}>Hardware ID (HWID):</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <code style={{ background: 'rgba(124, 58, 237, 0.15)', color: '#c4b5fd', border: '1px solid rgba(124, 58, 237, 0.3)', padding: '3px 8px', borderRadius: '6px', fontFamily: 'monospace', fontWeight: '700' }}>
                {hwidInfo?.hwid || 'Loading HWID...'}
              </code>
              <button 
                className="settings-btn" 
                style={{ padding: '3px 8px', fontSize: '0.74rem', height: 'auto' }}
                onClick={handleCopyHwid}
                title="Copy HWID to clipboard"
              >
                {copied ? '✓ Copied' : 'Copy HWID'}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-muted)' }}>Machine Hostname:</span>
            <strong style={{ color: 'var(--text-main)' }}>{hwidInfo?.pcName || 'Loading...'}</strong>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-muted)' }}>Processor & Architecture:</span>
            <span style={{ color: 'var(--text-main)' }}>{hwidInfo?.cpuModel || 'x64'} ({hwidInfo?.totalMemoryGB || 16} GB RAM)</span>
          </div>
        </div>
      </div>
    </>
  );
}
