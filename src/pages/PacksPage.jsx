import { 
  Search, Download, FolderOpen, Play, Pause, Loader2, Check, AlertCircle, 
  Volume2, VolumeX, Sparkles, Music, Layers, RefreshCw, ChevronRight, X,
  Trash2, HardDrive, Compass, Clock, CheckCircle2, SlidersHorizontal, Settings as SettingsIcon,
  XCircle, Activity
} from 'lucide-react';

const GENRE_TAGS = [
  'All Genres',
  'Techno',
  'House',
  'Tech House',
  'Trap',
  'Hip Hop',
  'Drill',
  'Lo-Fi',
  'Dubstep',
  'Drum & Bass',
  'Synthwave',
  'Afrobeats',
  'Pop',
  'R&B',
  'Cinematic',
  'Ambient'
];

function formatTime(seconds) {
  if (!seconds || isNaN(seconds) || seconds === Infinity || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export default function PacksPage({ 
  currentSound, 
  setCurrentSound, 
  isPlaying, 
  setIsPlaying, 
  stats, 
  setStats, 
  settings,
  setSettings,
  setActiveTab,
  onRefreshSounds, 
  onBrowsePack, 
  showToast, 
  setIsGlobalPlaying 
}) {
  // Navigation Sub-tabs: 'browse' | 'downloaded'
  const [activeSubTab, setActiveSubTab] = useState('browse');

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('Techno');
  const [selectedGenre, setSelectedGenre] = useState('Techno');
  const [sortOption, setSortOption] = useState('popularity-desc');
  const [packs, setPacks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  // Downloaded Packs State
  const [downloadedPacksList, setDownloadedPacksList] = useState([]);
  const [downloadedPacksMap, setDownloadedPacksMap] = useState({});
  const [downloadedSearchQuery, setDownloadedSearchQuery] = useState('');

  // Audio Demo Player State
  const [loadingDemoPackId, setLoadingDemoPackId] = useState(null);
  const [demoProgress, setDemoProgress] = useState(0);
  const [audioError, setAudioError] = useState(null);

  // Pack Download States (Supporting Concurrent Multi-Pack Downloads)
  const [downloadingPacks, setDownloadingPacks] = useState({}); // { [packUuid]: true }
  const [packProgressMap, setPackProgressMap] = useState({}); // { [packUuid]: progressData }

  // Load downloaded packs from persistent database
  const loadDownloadedPacks = async () => {
    try {
      if (window.electron?.getDownloadedPacks) {
        const res = await window.electron.getDownloadedPacks();
        if (res && res.success && Array.isArray(res.packs)) {
          setDownloadedPacksList(res.packs);
          const map = {};
          res.packs.forEach(p => {
            if (p.uuid) map[p.uuid] = p.folderPath;
          });
          setDownloadedPacksMap(map);
        }
      }
    } catch (err) {
      console.warn('Failed to load downloaded packs from database:', err);
    }
  };

  useEffect(() => {
    loadDownloadedPacks();
  }, []);

  // Subscribe to pack download progress (keyed by packUuid with fallback to packName)
  useEffect(() => {
    if (!window.electron?.onPackDownloadProgress) return;
    const unsubscribe = window.electron.onPackDownloadProgress((progressData) => {
      if (progressData) {
        const key = progressData.packUuid || progressData.packName;
        if (key) {
          setPackProgressMap(prev => ({
            ...prev,
            [key]: progressData,
            ...(progressData.packUuid ? { [progressData.packUuid]: progressData } : {}),
            ...(progressData.packName ? { [progressData.packName]: progressData } : {})
          }));
        }
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Fetch packs on search or genre change with flexible sorting
  const fetchPacks = async (query, page = 1, append = false, activeSort = sortOption) => {
    setLoading(true);
    setAudioError(null);
    try {
      const q = query === 'All Genres' ? '' : query;
      const res = await window.electron.searchPacks(q, page, 24, activeSort);
      if (res && res.success && res.packs) {
        if (append) {
          setPacks(prev => [...prev, ...res.packs]);
        } else {
          setPacks(res.packs);
        }
        setHasMore(res.packs.length >= 24);
      } else {
        if (!append) setPacks([]);
        setHasMore(false);
      }
    } catch (err) {
      console.error('Error fetching sample packs:', err);
      if (showToast) showToast('Failed to load sample packs', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Initial load and sort change
  useEffect(() => {
    fetchPacks(submittedQuery, 1, false, sortOption);
  }, [submittedQuery, sortOption]);

  // Handle search submission
  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setSelectedGenre(null);
      setSubmittedQuery(searchQuery.trim());
      setSortOption('relevance-desc');
      setCurrentPage(1);
    }
  };

  // Handle genre click
  const handleGenreClick = (genre) => {
    setSelectedGenre(genre);
    setSearchQuery('');
    setSubmittedQuery(genre);
    setSortOption('popularity-desc');
    setCurrentPage(1);
  };

  // Handle sort change
  const handleSortChange = (newSort) => {
    setSortOption(newSort);
    setCurrentPage(1);
    fetchPacks(submittedQuery, 1, false, newSort);
  };

  // Load more pagination
  const handleLoadMore = () => {
    const nextPage = currentPage + 1;
    setCurrentPage(nextPage);
    fetchPacks(submittedQuery, nextPage, true, sortOption);
  };

  // Handle Demo Play / Pause via unified global audio engine
  const handleToggleDemoPlay = async (pack, e) => {
    e.stopPropagation();
    if (!pack.demoUrl) {
      if (showToast) showToast('No demo preview track available for this pack', 'info');
      return;
    }

    const demoId = 'pack-demo-' + (pack.uuid || pack.id);
    const isThisActive = currentSound && (currentSound.id === demoId || currentSound.uuid === pack.uuid);

    if (isThisActive) {
      if (setIsPlaying) {
        setIsPlaying(!isPlaying);
      }
      return;
    }

    setLoadingDemoPackId(pack.id);

    try {
      let audioSrc = pack._mediaUrl;

      if (!audioSrc && window.electron?.getPackDemoAudio) {
        try {
          const res = await window.electron.getPackDemoAudio({
            demoUrl: pack.demoUrl,
            packUuid: pack.uuid
          });
          if (res && res.success && res.mediaUrl) {
            audioSrc = res.mediaUrl;
            pack._mediaUrl = audioSrc;
          }
        } catch (ipcErr) {
          console.warn('[PacksPage] getPackDemoAudio IPC error:', ipcErr.message);
        }
      }

      if (!audioSrc) {
        if (showToast) showToast('No preview stream available for this pack', 'info');
        return;
      }

      if (setCurrentSound) {
        setCurrentSound({
          id: demoId,
          name: `${pack.name} (Full Demo Track)`,
          pack: pack.name,
          coverArtUrl: pack.coverArtUrl,
          previewUrl: audioSrc,
          source: 'Splice',
          uuid: pack.uuid,
          productType: 'pack-demo'
        });
      }
      if (setIsPlaying) {
        setIsPlaying(true);
      }
    } catch (err) {
      console.warn('Pack demo play request error:', err.message);
    } finally {
      setLoadingDemoPackId(null);
    }
  };

  // Handle Demo Scrubbing
  const handleSeek = (e, pack) => {
    e.stopPropagation();
    const demoId = 'pack-demo-' + (pack.uuid || pack.id);
    const isThisActive = currentSound && (currentSound.id === demoId || currentSound.uuid === pack.uuid);
    
    if (isThisActive && demoAudioRef.current && demoAudioRef.current.duration) {
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, clickX / rect.width));
      demoAudioRef.current.currentTime = percentage * demoAudioRef.current.duration;
      setDemoProgress(percentage * 100);
      setDemoCurrentTime(demoAudioRef.current.currentTime);
    }
  };

  // Handle 1-Click Whole Pack Download (with permanent folder setting and multi-pack concurrency)
  const handleDownloadEntirePack = async (pack, e) => {
    e.stopPropagation();
    const packUuid = pack.uuid || pack.id;
    if (downloadingPacks[packUuid]) return;

    try {
      let targetDir = settings?.packDownloadDir;
      const isAutoPermanent = settings?.alwaysUseDefaultPackDir !== false && !!targetDir;

      if (!isAutoPermanent) {
        targetDir = await window.electron.selectFolder();
        if (!targetDir) return;
      }

      setDownloadingPacks(prev => ({ ...prev, [packUuid]: true }));
      if (showToast) {
        showToast(`Preparing download for "${pack.name}"...`);
      }

      const result = await window.electron.downloadEntirePack({
        packUuid: pack.uuid,
        name: pack.name,
        coverArtUrl: pack.coverArtUrl,
        targetFolder: targetDir,
        sounds: []
      });

      if (result && result.success) {
        setDownloadedPacksMap(prev => ({
          ...prev,
          [pack.uuid]: result.packFolderPath
        }));
        await loadDownloadedPacks();
        if (showToast) {
          showToast(`PACK DOWNLOADED! (${result.count} Samples Organized in Subfolders)`);
        }
      } else if (result && result.cancelled) {
        if (showToast) showToast(`Download for "${pack.name}" was cancelled`, 'info');
      } else {
        if (showToast) showToast(`Pack download failed: ${result?.error || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      console.error('Pack bulk download error:', err);
      if (showToast) showToast(`Download failed: ${err.message}`, 'error');
    } finally {
      setDownloadingPacks(prev => {
        const next = { ...prev };
        delete next[packUuid];
        return next;
      });
    }
  };

  const handleCancelDownload = async (pack, e) => {
    e.stopPropagation();
    const packUuid = pack.uuid || pack.id;
    if (window.electron?.cancelPackDownload) {
      await window.electron.cancelPackDownload(packUuid);
      if (showToast) showToast(`Cancelling download for "${pack.name}"...`, 'info');
    }
  };

  const handleOpenFolder = (folderPath, e) => {
    e.stopPropagation();
    if (folderPath && window.electron?.openPackFolder) {
      window.electron.openPackFolder(folderPath);
    } else if (folderPath && window.electron?.openFolder) {
      window.electron.openFolder(folderPath);
    }
  };

  const handleRemoveDownloadedPack = async (packUuid, e) => {
    e.stopPropagation();
    if (window.electron?.removeDownloadedPack) {
      await window.electron.removeDownloadedPack(packUuid);
      setDownloadedPacksList(prev => prev.filter(p => p.uuid !== packUuid));
      setDownloadedPacksMap(prev => {
        const next = { ...prev };
        delete next[packUuid];
        return next;
      });
      if (showToast) showToast('Pack removed from download history', 'info');
    }
  };

  const formatTime = (secs) => {
    if (!secs || isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // Filter downloaded packs list
  const filteredDownloadedPacks = downloadedPacksList.filter(p => {
    if (!downloadedSearchQuery.trim()) return true;
    const q = downloadedSearchQuery.toLowerCase();
    const nameMatch = (p.name || '').toLowerCase().includes(q);
    const tagMatch = (p.tags || []).some(t => (typeof t === 'string' ? t : t.label || '').toLowerCase().includes(q));
    return nameMatch || tagMatch;
  });

  return (
    <div className="download-packs-page">
      {/* Top Header Section */}
      <div className="packs-header-section">
        <div className="packs-header-title-row">
          <div>
            <div className="page-eyebrow">FULL PACKS · NO CHECKOUT MAZE</div>
            <h1 className="packs-main-title">Take the whole pack.</h1>
            <p className="packs-main-subtitle">
              Preview the release, browse what is inside, then save it with its folders intact.
            </p>
          </div>

          {/* Sub-Tabs: Online Catalog vs Downloaded Packs */}
          <div className="packs-subnav-toggle">
            <button 
              className={`packs-subnav-btn ${activeSubTab === 'browse' ? 'active' : ''}`}
              onClick={() => setActiveSubTab('browse')}
            >
              <Compass size={16} />
              <span>Browse Catalog</span>
            </button>
            <button 
              className={`packs-subnav-btn ${activeSubTab === 'downloaded' ? 'active' : ''}`}
              onClick={() => setActiveSubTab('downloaded')}
            >
              <HardDrive size={16} />
              <span>Downloaded Packs</span>
              {downloadedPacksList.length > 0 && (
                <span className="packs-badge-count">{downloadedPacksList.length}</span>
              )}
            </button>
          </div>
        </div>

        {/* Permanent Download Location Bar */}
        <div className="packs-destination-bar">
          <div className="packs-dest-left">
            <FolderOpen size={16} className="packs-dest-icon" />
            <span className="packs-dest-label">Pack Save Folder:</span>
            <span className="packs-dest-path" title={settings?.packDownloadDir || 'Music/WavelyPacks'}>
              {settings?.packDownloadDir || 'Default (Music/WavelyPacks)'}
            </span>
            {settings?.alwaysUseDefaultPackDir !== false && (
              <span className="packs-dest-tag">1-Click Auto-Save Active</span>
            )}
          </div>
          <div className="packs-dest-actions">
            <button 
              type="button"
              className="packs-dest-change-btn" 
              onClick={() => setActiveTab && setActiveTab('settings')}
              title="Configure permanent pack download directory in Settings"
            >
              <SlidersHorizontal size={13} />
              <span>Change in Settings</span>
            </button>
            {settings?.packDownloadDir && (
              <button 
                type="button"
                className="packs-dest-open-btn" 
                onClick={(e) => handleOpenFolder(settings.packDownloadDir, e)}
                title="Open sample packs download folder in Explorer"
              >
                <FolderOpen size={13} />
                <span>Open Folder</span>
              </button>
            )}
          </div>
        </div>

        {/* Search & Filter Controls based on Sub-Tab */}
        {activeSubTab === 'browse' ? (
          <>
            {/* Search Bar */}
            <form onSubmit={handleSearchSubmit} className="packs-search-form">
              <div className="packs-search-input-wrapper">
                <Search size={18} className="packs-search-icon" />
                <input
                  type="text"
                  placeholder="Search by genre, artist, or mood"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="packs-search-input"
                />
                {searchQuery && (
                  <button 
                    type="button" 
                    onClick={() => setSearchQuery('')}
                    className="packs-search-clear-btn"
                  >
                    <X size={15} />
                  </button>
                )}
                <button type="submit" className="packs-search-submit-btn">
                  Search Packs
                </button>
              </div>
            </form>

            {/* Quick Genre Filter Pills & Sorting Filter Dropdown */}
            <div className="packs-filter-bar-row">
              <div className="packs-genre-pills-row">
                {GENRE_TAGS.map((genre) => (
                  <button
                    key={genre}
                    className={`packs-genre-pill ${selectedGenre === genre ? 'active' : ''}`}
                    onClick={() => handleGenreClick(genre)}
                  >
                    {genre}
                  </button>
                ))}
              </div>

              {/* Sorting Filter Selector */}
              <div className="packs-sort-dropdown-wrap">
                <SlidersHorizontal size={14} className="packs-sort-icon" />
                <label htmlFor="pack-sort-select" className="packs-sort-label">Sort:</label>
                <select
                  id="pack-sort-select"
                  value={sortOption}
                  onChange={(e) => handleSortChange(e.target.value)}
                  className="packs-sort-select"
                >
                  <option value="popularity-desc">🔥 Popularity: High to Low</option>
                  <option value="popularity-asc">📉 Popularity: Low to High</option>
                  <option value="date-desc">📅 Release Date: Newest First</option>
                  <option value="date-asc">⏳ Release Date: Oldest First</option>
                  <option value="samples-desc">📊 Sample Count: High to Low</option>
                  <option value="samples-asc">📉 Sample Count: Low to High</option>
                  <option value="alpha-asc">🔤 Name: A → Z</option>
                  <option value="alpha-desc">🔠 Name: Z → A</option>
                  <option value="relevance-desc">🎯 Best Match (Relevance)</option>
                </select>
              </div>
            </div>
          </>
        ) : (
          /* Downloaded Packs Search Bar */
          <div className="packs-search-form">
            <div className="packs-search-input-wrapper">
              <Search size={18} className="packs-search-icon" />
              <input
                type="text"
                placeholder="Filter your downloaded sample packs..."
                value={downloadedSearchQuery}
                onChange={(e) => setDownloadedSearchQuery(e.target.value)}
                className="packs-search-input"
              />
              {downloadedSearchQuery && (
                <button 
                  type="button" 
                  onClick={() => setDownloadedSearchQuery('')}
                  className="packs-search-clear-btn"
                >
                  <X size={15} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* VIEW 1: BROWSE ONLINE CATALOG */}
      {activeSubTab === 'browse' && (
        <div className="packs-catalog-container">
          {loading && packs.length === 0 ? (
            <div className="packs-loading-state">
              <Loader2 size={36} className="spin-animation" style={{ color: 'var(--accent-secondary, #06b6d4)', margin: '0 auto 16px auto' }} />
              <div style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-main)' }}>
                Searching sample packs for "{submittedQuery || 'All'}"...
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Fetching high-resolution artwork, full audio preview tracks, and catalog metadata
              </div>
            </div>
          ) : packs.length === 0 ? (
            <div className="packs-empty-state">
              <Music size={48} style={{ color: 'var(--text-muted)', margin: '0 auto 16px auto', opacity: 0.5 }} />
              <h3>No Sample Packs Found</h3>
              <p>Try searching for a different genre or keyword (e.g., Techno, House, Lo-Fi, Trap, Synthwave).</p>
            </div>
          ) : (
            <div className="packs-cards-grid">
              {packs.map(pack => {
                const demoId = 'pack-demo-' + (pack.uuid || pack.id);
                const isPlayingThis = currentSound && (currentSound.id === demoId || currentSound.uuid === pack.uuid) && isPlaying;
                const isDownloadingThis = !!downloadingPacks[pack.uuid] || !!downloadingPacks[pack.id];
                const downloadedFolder = downloadedPacksMap[pack.uuid];
                const isAlreadyDownloaded = !!downloadedFolder || downloadedPacksList.some(dp => dp.uuid === pack.uuid || dp.name === pack.name);
                const liveProgress = packProgressMap[pack.uuid] || packProgressMap[pack.name];

                return (
                  <div key={pack.id} className="live-pack-card">
                    {/* Artwork Container */}
                    <div className="live-pack-art-container" onClick={() => onBrowsePack && onBrowsePack(pack)}>
                      {pack.coverArtUrl ? (
                        <img src={pack.coverArtUrl} alt={pack.name} className="live-pack-img" />
                      ) : (
                        <div className="live-pack-placeholder-art">
                          <Music size={40} />
                        </div>
                      )}

                      {/* Source & Downloaded Badges */}
                      <div className="live-pack-badge-top-row">
                        {isAlreadyDownloaded && (
                          <div className="live-pack-downloaded-badge">
                            <CheckCircle2 size={11} />
                            <span>Downloaded</span>
                          </div>
                        )}
                        <div className="live-pack-source-badge">
                          <Sparkles size={11} />
                          <span>{pack.source}</span>
                        </div>
                      </div>

                      {/* Play Demo Button Overlay */}
                      {pack.demoUrl && (
                        <button 
                          className={`live-pack-demo-btn ${isPlayingThis ? 'playing' : ''}`}
                          disabled={loadingDemoPackId === pack.id}
                          onClick={(e) => handleToggleDemoPlay(pack, e)}
                          title={isPlayingThis ? 'Pause Demo Preview' : 'Play Full Pack Demo'}
                        >
                          {loadingDemoPackId === pack.id ? (
                            <Loader2 size={18} className="spin-animation" />
                          ) : isPlayingThis ? (
                            <Pause size={18} fill="currentColor" />
                          ) : (
                            <Play size={18} fill="currentColor" style={{ marginLeft: '2px' }} />
                          )}
                        </button>
                      )}
                    </div>

                    {/* Pack Details */}
                    <div className="live-pack-info-area">
                      <h3 className="live-pack-name" title={pack.name} onClick={() => onBrowsePack && onBrowsePack(pack)}>
                        {pack.name}
                      </h3>

                      {/* Storage & Sample Count Estimate */}
                      <div className="live-pack-storage-row">
                        <div className={`live-pack-storage-chip ${isAlreadyDownloaded ? 'downloaded' : ''}`} title="Estimated disk space requirement">
                          <HardDrive size={11} />
                          <span>~{pack.estimatedStorage?.replace(/^~/, '') || '280 MB'}</span>
                        </div>
                        <div className="live-pack-samples-chip" title="Total sample & preset count">
                          <Layers size={11} />
                          <span>{pack.itemCount || pack.estimatedSamples || 0} items</span>
                        </div>
                      </div>

                      {/* Tags */}
                      <div className="live-pack-tags-row">
                        {pack.tags && pack.tags.slice(0, 3).map((tag, idx) => (
                          <span key={idx} className="live-pack-tag-chip">
                            {tag}
                          </span>
                        ))}
                      </div>

                      {/* Full Preview Playbar on the Card */}
                      {pack.demoUrl && (
                        <div 
                          className={`live-pack-playbar ${isPlayingThis ? 'active' : ''}`}
                          onClick={(e) => handleToggleDemoPlay(pack, e)}
                          style={{ cursor: 'pointer' }}
                        >
                          <div className="playbar-controls">
                            <button 
                              className="playbar-play-icon"
                              disabled={loadingDemoPackId === pack.id}
                              onClick={(e) => handleToggleDemoPlay(pack, e)}
                            >
                              {loadingDemoPackId === pack.id ? (
                                <Loader2 size={13} className="spin-animation" />
                              ) : isPlayingThis ? (
                                <Pause size={13} fill="currentColor" />
                              ) : (
                                <Play size={13} fill="currentColor" />
                              )}
                            </button>
                            <span className="playbar-label">
                              {loadingDemoPackId === pack.id ? 'Loading Demo Audio...' : isPlayingThis ? 'Playing Full Demo' : 'Full Pack Preview'}
                            </span>
                            <span className="playbar-time">
                              {isPlayingThis ? 'Auditioning in PlayerBar' : 'Demo Track'}
                            </span>
                          </div>

                          {/* Scrubbable Audio Track */}
                          <div 
                            className="playbar-track-bg"
                            onClick={(e) => handleSeek(e, pack)}
                            title="Click to seek demo audio"
                          >
                            <div 
                              className="playbar-track-fill"
                              style={{ width: isPlayingThis ? `${demoProgress}%` : '0%' }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Live Download Progress Indicator */}
                      {isDownloadingThis && liveProgress && (
                        <div className="pack-downloading-progress-box">
                          <div className="pack-downloading-text-row">
                            <span>Downloading ({liveProgress.current || 0} / {liveProgress.total || 0})</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span>{liveProgress.percent || 0}%</span>
                              <button 
                                type="button"
                                className="pack-download-cancel-icon-btn"
                                onClick={(e) => handleCancelDownload(pack, e)}
                                title="Cancel pack download"
                              >
                                <XCircle size={13} />
                              </button>
                            </div>
                          </div>
                          <div className="pack-downloading-progress-bar">
                            <div 
                              className="pack-downloading-progress-fill" 
                              style={{ width: `${liveProgress.percent || 0}%` }}
                            />
                          </div>
                          <span className="pack-downloading-filename">{liveProgress.sampleName}</span>
                        </div>
                      )}

                      {/* Action Buttons Row */}
                      <div className="live-pack-actions-row">
                        <button 
                          className="live-pack-browse-btn"
                          onClick={() => onBrowsePack && onBrowsePack(pack)}
                          title="Browse individual sounds in this pack"
                        >
                          <Layers size={14} />
                          <span>Browse Pack</span>
                        </button>

                        {/* Analyse Pack Demo Button */}
                        <button 
                          className="live-pack-browse-btn"
                          onClick={() => {
                            if (setCurrentSound) {
                              setCurrentSound({
                                productType: 'pack-demo',
                                name: pack.name,
                                packName: pack.name,
                                uuid: pack.uuid || pack.id,
                                previewUrl: pack.demoUrl,
                                artworkUrl: pack.coverArtUrl,
                                coverArtUrl: pack.coverArtUrl
                              });
                            }
                            if (setIsPlaying) setIsPlaying(true);
                            if (setActiveTab) setActiveTab('analyser');
                          }}
                          title="Open pack demo in Wavely Analyser to pinpoint & isolate samples"
                          style={{
                            background: 'rgba(6, 182, 212, 0.12)',
                            borderColor: 'rgba(6, 182, 212, 0.35)',
                            color: '#38bdf8'
                          }}
                        >
                          <Activity size={14} />
                          <span>Analyse Demo</span>
                        </button>

                        {isAlreadyDownloaded ? (
                          <button 
                            className="live-pack-download-btn downloaded"
                            onClick={(e) => handleOpenFolder(downloadedFolder, e)}
                            title="Open downloaded pack directory"
                          >
                            <FolderOpen size={14} />
                            <span>Open Folder</span>
                          </button>
                        ) : (
                          <button 
                            className="live-pack-download-btn"
                            disabled={isDownloadingThis}
                            onClick={(e) => handleDownloadEntirePack(pack, e)}
                            title="Download and organize entire pack into subfolders"
                          >
                            {isDownloadingThis ? (
                              <>
                                <Loader2 size={14} className="spin-animation" />
                                <span>Downloading...</span>
                              </>
                            ) : (
                              <>
                                <Download size={14} />
                                <span>Download All</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Load More Pagination */}
          {hasMore && !loading && packs.length > 0 && (
            <div style={{ textAlign: 'center', marginTop: '36px' }}>
              <button className="packs-load-more-btn" onClick={handleLoadMore}>
                <span>Load More Packs</span>
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* VIEW 2: DOWNLOADED PACKS MANAGER */}
      {activeSubTab === 'downloaded' && (
        <div className="packs-catalog-container">
          {downloadedPacksList.length === 0 ? (
            <div className="packs-empty-state">
              <HardDrive size={52} style={{ color: 'var(--accent-secondary, #06b6d4)', margin: '0 auto 16px auto', opacity: 0.8 }} />
              <h3>No Downloaded Packs Yet</h3>
              <p>Explore the online catalog to download complete sample packs into your library with organized subfolders.</p>
              <button 
                className="packs-browse-cta-btn"
                onClick={() => setActiveSubTab('browse')}
              >
                <Compass size={16} />
                <span>Explore Online Catalog</span>
              </button>
            </div>
          ) : filteredDownloadedPacks.length === 0 ? (
            <div className="packs-empty-state">
              <Search size={44} style={{ color: 'var(--text-muted)', margin: '0 auto 16px auto', opacity: 0.5 }} />
              <h3>No matching downloaded packs</h3>
              <p>Try searching with another keyword or clear the search filter.</p>
            </div>
          ) : (
            <div className="packs-cards-grid">
              {filteredDownloadedPacks.map((pack) => {
                const dateStr = pack.downloadedAt ? new Date(pack.downloadedAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric'
                }) : 'Downloaded';

                return (
                  <div key={pack.uuid || pack.name} className="live-pack-card downloaded-card">
                    {/* Artwork */}
                    <div className="live-pack-art-container" onClick={() => onBrowsePack && onBrowsePack(pack)}>
                      {pack.coverArtUrl ? (
                        <img src={pack.coverArtUrl} alt={pack.name} className="live-pack-img" />
                      ) : (
                        <div className="live-pack-placeholder-art">
                          <Music size={40} />
                        </div>
                      )}

                      <div className="live-pack-badge-top-row">
                        <div className="live-pack-downloaded-badge">
                          <CheckCircle2 size={11} />
                          <span>On Disk</span>
                        </div>
                      </div>
                    </div>

                    {/* Information */}
                    <div className="live-pack-info-area">
                      <h3 className="live-pack-name" title={pack.name} onClick={() => onBrowsePack && onBrowsePack(pack)}>
                        {pack.name}
                      </h3>

                      <div className="downloaded-pack-meta-row">
                        <span className="downloaded-meta-item">
                          <HardDrive size={12} style={{ color: '#10b981' }} />
                          <span>{pack.sampleCount ? `${Math.round(pack.sampleCount * 2.4)} MB` : '~240 MB'}</span>
                        </span>
                        <span className="downloaded-meta-item">
                          <Music size={12} />
                          <span>{pack.sampleCount || 'All'} samples</span>
                        </span>
                        <span className="downloaded-meta-item">
                          <Clock size={12} />
                          <span>{dateStr}</span>
                        </span>
                      </div>

                      {pack.folderPath && (
                        <div className="downloaded-pack-path-box" title={pack.folderPath}>
                          <FolderOpen size={12} style={{ flexShrink: 0 }} />
                          <span className="downloaded-pack-path-text">{pack.folderPath}</span>
                        </div>
                      )}

                      {/* Action Buttons Row */}
                      <div className="live-pack-actions-row">
                        <button 
                          className="live-pack-browse-btn"
                          onClick={() => onBrowsePack && onBrowsePack(pack)}
                          title="View all samples from this pack in Wavely"
                        >
                          <Layers size={14} />
                          <span>Browse Sounds</span>
                        </button>

                        <button 
                          className="live-pack-download-btn downloaded"
                          onClick={(e) => handleOpenFolder(pack.folderPath, e)}
                          title="Open folder in File Explorer"
                        >
                          <FolderOpen size={14} />
                          <span>Open Folder</span>
                        </button>

                        <button
                          className="downloaded-pack-delete-btn"
                          onClick={(e) => handleRemoveDownloadedPack(pack.uuid, e)}
                          title="Remove from downloaded history"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
