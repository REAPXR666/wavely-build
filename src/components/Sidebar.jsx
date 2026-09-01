import React from 'react';
import { Music, Search, Layers, FolderDown, Settings, Database, Activity } from 'lucide-react';

export default function Sidebar({ activeTab, setActiveTab, stats }) {
  const menuItems = [
    { id: 'sounds', label: 'Sounds', icon: Search, section: 'browse' },
    { id: 'presets', label: 'Presets', icon: Layers, section: 'browse' },
    { id: 'packs', label: 'Packs', icon: Music, section: 'browse' },
    { id: 'analyser', label: 'Analyser', icon: Activity, section: 'browse' },
    { id: 'downloads', label: 'Downloads', icon: FolderDown, section: 'library' },
    { id: 'settings', label: 'Settings', icon: Settings, section: 'system' }
  ];

  return (
    <aside className="sidebar">
      <div className="logo-container">
        <span className="brand-mark" aria-hidden="true">
          <span></span><span></span><span></span><span></span><span></span>
        </span>
        <div className="brand-copy">
          <span className="logo-text">wavely</span>
          <span className="logo-edition">studio browser</span>
        </div>
      </div>

      <div className="nav-section">
        <div className="nav-header">Browse</div>
        {menuItems
          .filter((item) => item.section === 'browse')
          .map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
                onClick={() => setActiveTab(item.id)}
                aria-pressed={activeTab === item.id}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
      </div>

      <div className="nav-section">
        <div className="nav-header">Library</div>
        {menuItems
          .filter((item) => item.section === 'library')
          .map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
                onClick={() => setActiveTab(item.id)}
                aria-pressed={activeTab === item.id}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
      </div>

      <div className="nav-section">
        <div className="nav-header">Wavely</div>
        {menuItems
          .filter((item) => item.section === 'system')
          .map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
                onClick={() => setActiveTab(item.id)}
                aria-pressed={activeTab === item.id}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
      </div>

      <div className="sidebar-footer">
        <div className="stats-card">
          <div className="stats-card-heading">
            <Database size={13} />
            <span>Local library</span>
          </div>
          <div className="library-stat"><span>Samples</span><strong>{stats.downloadedCount || 0}</strong></div>
          <div className="library-stat"><span>Presets</span><strong>{stats.presetsCount || 0}</strong></div>
          <div className="library-stat"><span>Packs</span><strong>{stats.indexedPacks?.length || 0}</strong></div>
        </div>
        <div className="desktop-version">
          <span className="status-dot"></span>
          Desktop v1.0.6
        </div>
      </div>
    </aside>
  );
}
