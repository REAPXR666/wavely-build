import React, { useState, useEffect } from 'react';
import { 
  Search, Play, Pause, Download, CheckCircle2, SlidersHorizontal, 
  HelpCircle, ChevronLeft, ChevronRight, X, Loader2, Sparkles, 
  Layers, FolderOpen, Sliders, Music, Zap
} from 'lucide-react';
import WaveformRenderer from '../components/WaveformRenderer';

const SYNTH_LIST = ['All', 'Serum', 'Vital', 'Astra', 'Massive', 'PhasePlant', 'Sylenth1', 'Spire'];
const CATEGORY_LIST = ['All', 'Bass', 'Lead', 'Pluck', 'Pad', 'Keys / Chords', 'FX', 'Arp / Seq'];

export default function PresetsPage({ 
  currentSound, 
  setCurrentSound, 
  isPlaying, 
  setIsPlaying, 
  stats,
  setStats,
  showToast,
  setIsGlobalPlaying
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [activeSynth, setActiveSynth] = useState('All');
  const [activeCategory, setActiveCategory] = useState('All');
  const [presetsList, setPresetsList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  // Pagination states
  const [loadedPages, setLoadedPages] = useState(4);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [savingPresetId, setSavingPresetId] = useState(null);

  const fetchPresets = async (pageStart = 1, pageEnd = 4, append = false) => {
    if (!append) setLoading(true);
    try {
      const filters = { 
        synth: activeSynth !== 'All' ? activeSynth : null,
        category: activeCategory !== 'All' ? activeCategory : null,
        startPage: pageStart,
        endPage: pageEnd
      };

      const queryParts = [];
      if (submittedQuery) queryParts.push(submittedQuery);
      if (activeSynth !== 'All' && !submittedQuery.toLowerCase().includes(activeSynth.toLowerCase())) {
        queryParts.push(activeSynth);
      }
      if (activeCategory !== 'All' && !submittedQuery.toLowerCase().includes(activeCategory.toLowerCase())) {
        queryParts.push(activeCategory);
      }
      const fullQuery = queryParts.join(' ').trim();

      const results = await window.electron.searchPresets(fullQuery, filters);
      
      if (append) {
        setPresetsList(prev => {
          const merged = [...prev];
          const seenIds = new Set(merged.map(p => p.id));
          (results || []).forEach(item => {
            if (!seenIds.has(item.id)) {
              merged.push(item);
            }
          });
          return merged;
        });
      } else {
        setPresetsList(results || []);
      }

      setHasMore((results || []).length >= 40);

      if (fullQuery && window.electron?.trackPage) {
        window.electron.trackPage(fullQuery).catch(() => {});
      }
    } catch (err) {
      console.error('Failed to search presets:', err);
      if (showToast) showToast('Failed to load VST presets', 'error');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  // Initial fetch and trigger on filters change
  useEffect(() => {
    setCurrentPage(1);
    setLoadedPages(4);
    fetchPresets(1, 4, false);
  }, [submittedQuery, activeSynth, activeCategory]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setSubmittedQuery(searchQuery.trim());
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setSubmittedQuery('');
  };

  const loadMorePresets = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const nextStart = loadedPages + 1;
    const nextEnd = loadedPages + 4;
    setLoadedPages(nextEnd);
    await fetchPresets(nextStart, nextEnd, true);
    if (showToast) showToast(`Loaded more presets (Pages ${nextStart}-${nextEnd})`);
  };

  const handlePlayToggle = (preset, e) => {
    e.stopPropagation();
    
    // Map preset structure to standard audio play structure
    const audioObj = {
      id: preset.id,
      name: preset.name,
      pack: `${preset.synth} Preset (${preset.category || 'Synth'})`,
      previewUrl: preset.previewUrl,
      source: 'Splice',
      uuid: preset.uuid,
      fileHash: preset.fileHash,
      packUuid: preset.packUuid,
      productType: 'preset'
    };

    if (currentSound && currentSound.id === preset.id) {
      setIsPlaying(!isPlaying);
      if (!isPlaying && window.electron?.trackPlay) {
        window.electron.trackPlay(audioObj).catch(() => {});
      }
    } else {
      setCurrentSound(audioObj);
      setIsPlaying(true);
      if (window.electron?.trackPlay) {
        window.electron.trackPlay(audioObj).catch(() => {});
      }
    }
  };

  const handleDownloadPreset = async (preset, e) => {
    e.stopPropagation();
    setSavingPresetId(preset.id);
    try {
      const result = await window.electron.downloadPreset({
        id: preset.id,
        name: preset.rawName || preset.name,
        synth: preset.synth || 'Serum',
        uuid: preset.uuid,
        previewUrl: preset.previewUrl,
        downloadUrl: preset.downloadUrl,
        presetFileName: preset.presetFileName || preset.rawName,
        category: preset.category
      });

      if (result && result.success) {
        setPresetsList(prev => prev.map(p => {
          if (p.id === preset.id) {
            return { ...p, isDownloaded: true, filePath: result.filePath };
          }
          return p;
        }));
        
        if (window.electron?.getIndexedPacks && setStats) {
          const updatedStats = await window.electron.getIndexedPacks();
          setStats(updatedStats);
        }

        if (showToast) {
          showToast(`SAVED ${preset.synth.toUpperCase()} PRESET TO VST FOLDER: ${preset.name}`);
        }
      } else {
        if (showToast) {
          showToast(`Preset save failed: ${result?.error || 'Unknown error'}`, 'error');
        }
      }
    } catch (err) {
      console.error('Preset download error:', err);
      if (showToast) {
        showToast(`Preset save failed: ${err.message}`, 'error');
      }
    } finally {
      setSavingPresetId(null);
    }
  };

  const handleOpenPresetFolder = (filePath, e) => {
    e.stopPropagation();
    if (filePath && window.electron?.openFolder) {
      window.electron.openFolder(filePath);
    }
  };

  // Helper for synth styling
  const getSynthBadgeStyle = (synth) => {
    const s = (synth || '').toLowerCase();
    if (s.includes('serum')) {
      return { background: 'rgba(124, 58, 237, 0.15)', color: '#a78bfa', border: '1px solid rgba(124, 58, 237, 0.4)' };
    }
    if (s.includes('vital')) {
      return { background: 'rgba(6, 182, 212, 0.15)', color: '#22d3ee', border: '1px solid rgba(6, 182, 212, 0.4)' };
    }
    if (s.includes('astra')) {
      return { background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', border: '1px solid rgba(59, 130, 246, 0.4)' };
    }
    if (s.includes('massive')) {
      return { background: 'rgba(249, 115, 22, 0.15)', color: '#fb923c', border: '1px solid rgba(249, 115, 22, 0.4)' };
    }
    if (s.includes('phaseplant')) {
      return { background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.4)' };
    }
    if (s.includes('sylenth')) {
      return { background: 'rgba(234, 179, 8, 0.15)', color: '#facc15', border: '1px solid rgba(234, 179, 8, 0.4)' };
    }
    if (s.includes('spire')) {
      return { background: 'rgba(236, 72, 153, 0.15)', color: '#f472b6', border: '1px solid rgba(236, 72, 153, 0.4)' };
    }
    return { background: 'rgba(255, 255, 255, 0.08)', color: '#ffffff', border: '1px solid rgba(255, 255, 255, 0.2)' };
  };

  const totalPages = Math.ceil(presetsList.length / itemsPerPage);
  const currentPresets = presetsList.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="presets-page-container">
      {/* Header Section */}
      <div className="presets-header-section">
        <div className="presets-header-title-row">
          <div>
            <div className="page-eyebrow">PRESET SHELF · 45K+</div>
            <h1 className="presets-main-title">Your synths, one shelf.</h1>
            <p className="presets-main-subtitle">
              Audition patches for Serum, Vital, Massive, PhasePlant and more, then save them where they belong.
            </p>
          </div>

          {/* Directory Status Badge */}
          <div className="presets-info-badge" title="Presets download directly into your synthesizer directory">
            <HelpCircle size={14} style={{ color: 'var(--accent-secondary, #06b6d4)', flexShrink: 0 }} />
            <span>Preset files save directly into your VST directories</span>
          </div>
        </div>

        {/* Search Bar */}
        <form onSubmit={handleSearchSubmit} className="presets-search-form">
          <div className="presets-search-input-wrapper">
            <Search size={18} className="presets-search-icon" />
            <input 
              type="text" 
              placeholder="Try ‘reese bass’, ‘choir pad’, or ‘bright pluck’" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="presets-search-input"
            />
            {searchQuery && (
              <button 
                type="button" 
                onClick={handleClearSearch}
                className="presets-search-clear-btn"
              >
                <X size={15} />
              </button>
            )}
            <button type="submit" className="presets-search-submit-btn">
              Search Presets
            </button>
          </div>
        </form>

        {/* Synthesizer Selector Pills */}
        <div className="presets-filter-group">
          <span className="presets-filter-label">Synthesizer:</span>
          <div className="presets-filter-pills-row">
            {SYNTH_LIST.map(synth => (
              <button 
                key={synth}
                className={`presets-synth-pill ${activeSynth === synth ? 'active' : ''}`}
                onClick={() => setActiveSynth(synth)}
              >
                {synth === 'All' ? 'All Synths' : synth}
              </button>
            ))}
          </div>
        </div>

        {/* Category Pills */}
        <div className="presets-filter-group" style={{ marginTop: '8px' }}>
          <span className="presets-filter-label">Category:</span>
          <div className="presets-filter-pills-row">
            {CATEGORY_LIST.map(cat => (
              <button 
                key={cat}
                className={`presets-category-pill ${activeCategory === cat ? 'active' : ''}`}
                onClick={() => setActiveCategory(cat)}
              >
                {cat === 'All' ? 'All Categories' : cat}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Results Header Count */}
      <div className="presets-results-bar">
        <div className="presets-count-badge">
          {loading ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Loader2 size={14} className="spin-animation" />
              <span>Searching VST presets...</span>
            </span>
          ) : (
            <span><strong>{presetsList.length}</strong> Presets Available</span>
          )}
        </div>
      </div>

      {/* Main Presets Table */}
      <div className="presets-table-container">
        {/* Table Header */}
        <div className="presets-table-header">
          <div className="presets-th-play">Audition</div>
          <div className="presets-th-synth">Synth</div>
          <div className="presets-th-name">Preset Name / Pack</div>
          <div className="presets-th-category">Category</div>
          <div className="presets-th-waveform">Audio Preview Waveform</div>
          <div className="presets-th-actions">Save Preset</div>
        </div>

        {/* Table Body */}
        {loading && presetsList.length === 0 ? (
          <div className="presets-loading-box">
            <Loader2 size={36} className="spin-animation" style={{ color: 'var(--accent-secondary, #06b6d4)', margin: '0 auto 14px auto' }} />
            <div style={{ fontSize: '1.05rem', fontWeight: '700', color: 'var(--text-main)' }}>
              Loading VST Presets for {activeSynth !== 'All' ? activeSynth : 'All Synths'}...
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              Fetching high quality preset files, sound previews, and creator metadata
            </div>
          </div>
        ) : presetsList.length === 0 ? (
          <div className="presets-empty-box">
            <Music size={44} style={{ color: 'var(--text-muted)', margin: '0 auto 14px auto', opacity: 0.5 }} />
            <h3>No VST Presets Found</h3>
            <p>Try searching for a different keyword (e.g. Reese Bass, Lead, Pluck, 808) or select "All Synths".</p>
          </div>
        ) : (
          <div className="presets-rows-list">
            {currentPresets.map((preset, idx) => {
              const isSelected = currentSound && currentSound.id === preset.id;
              const isPlayingThis = isSelected && isPlaying;
              const isSavingThis = savingPresetId === preset.id;
              const synthStyle = getSynthBadgeStyle(preset.synth);

              return (
                <div 
                  key={preset.id || idx}
                  className={`presets-row-card ${isSelected ? 'selected' : ''}`}
                  onClick={(e) => handlePlayToggle(preset, e)}
                >
                  {/* Play / Pause Audition Button */}
                  <div className="presets-cell-play">
                    <button 
                      className={`presets-row-play-btn ${isPlayingThis ? 'playing' : ''}`}
                      onClick={(e) => handlePlayToggle(preset, e)}
                      title={isPlayingThis ? 'Pause Preview' : 'Play Preset Preview'}
                    >
                      {isPlayingThis ? (
                        <Pause size={14} fill="currentColor" />
                      ) : (
                        <Play size={14} fill="currentColor" style={{ marginLeft: '1px' }} />
                      )}
                    </button>
                  </div>

                  {/* Synth Badge */}
                  <div className="presets-cell-synth">
                    <span 
                      className="presets-synth-chip" 
                      style={synthStyle}
                    >
                      {preset.synth || 'Synth'}
                    </span>
                  </div>

                  {/* Preset Name & Pack Title */}
                  <div className="presets-cell-name">
                    <div className="presets-name-title" title={preset.name}>
                      {preset.name}
                    </div>
                    <div className="presets-name-sub">
                      <span className="presets-creator-tag">{preset.creator || preset.pack || 'Splice Presets'}</span>
                      {preset.tags && preset.tags.slice(0, 2).map((t, tidx) => (
                        <span key={tidx} className="presets-tag-pill">{typeof t === 'string' ? t : t.label}</span>
                      ))}
                    </div>
                  </div>

                  {/* Category */}
                  <div className="presets-cell-category">
                    <span className="presets-category-chip">
                      {preset.category || 'Preset'}
                    </span>
                  </div>

                  {/* Waveform Audition */}
                  <div className="presets-cell-waveform" onClick={(e) => e.stopPropagation()}>
                    {isSelected ? (
                      <WaveformRenderer 
                        audioUrl={preset.previewUrl}
                        isPlaying={isPlaying}
                        onPlayPause={setIsPlaying}
                        active={isSelected}
                        isGlobal={false}
                        sampleName={preset.name}
                        sampleTags={preset.tags}
                      />
                    ) : (
                      <div className="presets-waveform-placeholder" onClick={(e) => handlePlayToggle(preset, e)}>
                        <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="presets-static-svg">
                          <path 
                            d="M0,10 L2,8 L4,12 L6,7 L8,13 L10,6 L12,14 L14,8 L16,11 L18,9 L20,13 L22,7 L24,15 L26,9 L28,12 L30,5 L32,16 L34,8 L36,11 L38,7 L40,14 L42,9 L44,12 L46,6 L48,15 L50,8 L52,11 L54,7 L56,13 L58,9 L60,12 L62,5 L64,16 L66,8 L68,11 L70,6 L72,14 L74,9 L76,12 L78,7 L80,13 L82,8 L84,11 L86,6 L88,14 L90,9 L92,12 L94,8 L96,11 L98,10 L100,10 L100,10 L98,10 L96,9 L94,12 L92,8 L90,11 L88,6 L86,14 L84,9 L82,12 L80,7 L78,13 L76,8 L74,11 L72,6 L70,14 L68,9 L66,12 L64,5 L62,16 L60,8 L58,11 L56,7 L54,13 L52,9 L50,12 L48,6 L46,15 L44,8 L42,11 L40,7 L38,14 L36,9 L34,12 L32,5 L30,16 L28,8 L26,11 L24,7 L22,13 L20,9 L18,12 L16,5 L14,14 L12,8 L10,11 L8,6 L6,13 L4,9 L2,12 Z" 
                            fill="currentColor" 
                          />
                        </svg>
                      </div>
                    )}
                  </div>

                  {/* Save Preset Action Button */}
                  <div className="presets-cell-actions">
                    {preset.isDownloaded ? (
                      <button 
                        className="presets-action-btn downloaded"
                        title="Preset saved to VST Folder! Click to open folder"
                        onClick={(e) => handleOpenPresetFolder(preset.filePath, e)}
                      >
                        <CheckCircle2 size={15} />
                        <span>Saved</span>
                      </button>
                    ) : (
                      <button 
                        className="presets-action-btn"
                        disabled={isSavingThis}
                        onClick={(e) => handleDownloadPreset(preset, e)}
                        title={`Save .${(preset.synth || 'serum').toLowerCase() === 'vital' ? 'vital' : 'fxp'} preset file`}
                      >
                        {isSavingThis ? (
                          <>
                            <Loader2 size={14} className="spin-animation" />
                            <span>Saving...</span>
                          </>
                        ) : (
                          <>
                            <Download size={14} />
                            <span>Save Preset</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Load More Button */}
      {hasMore && !loading && presetsList.length > 0 && (
        <div className="presets-load-more-container">
          <button 
            className="presets-load-more-btn"
            onClick={loadMorePresets} 
            disabled={loadingMore}
          >
            {loadingMore ? (
              <>
                <Loader2 size={16} className="spin-animation" />
                <span>Fetching more presets...</span>
              </>
            ) : (
              <>
                <span>Load More Presets</span>
                <ChevronRight size={16} />
              </>
            )}
          </button>
        </div>
      )}

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="presets-pagination-container">
          <button 
            className="presets-page-nav-btn"
            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
            disabled={currentPage === 1}
          >
            <ChevronLeft size={16} />
            <span>Prev</span>
          </button>
          
          <span className="presets-page-indicator">
            Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong>
          </span>
          
          <button 
            className="presets-page-nav-btn"
            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
            disabled={currentPage === totalPages}
          >
            <span>Next</span>
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
