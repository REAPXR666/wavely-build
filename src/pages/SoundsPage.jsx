import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, Play, Pause, CloudDownload, Download, FolderOpen, Loader2, CheckCircle2, SlidersHorizontal, 
  HelpCircle, ChevronLeft, ChevronRight, ChevronDown, Check, X, Sparkles, Gem, Sliders,
  Zap, RefreshCw, Music2, Disc3, Volume2, Layers, Award, FileCheck, ShieldCheck, Scissors, Cpu
} from 'lucide-react';
import WaveformRenderer from '../components/WaveformRenderer';
import LicenseCertificateModal from '../components/LicenseCertificateModal';
import SampleSlicerModal from '../components/SampleSlicerModal';
import StemSeparatorModal from '../components/StemSeparatorModal';
import { findSimilarSounds } from '../utils/acousticSimilarity';
import { getHarmonicMatches } from '../utils/harmonicTheory';

export default function SoundsPage({ 
  currentSound, 
  setCurrentSound, 
  isPlaying, 
  setIsPlaying, 
  volume, 
  isLooping, 
  setSoundsList, 
  soundsList, 
  showToast, 
  isDownloadsPage = false, 
  activeTab = 'sounds', 
  setActiveTab, 
  activePack: propActivePack, 
  setActivePack: propSetActivePack,
  user,
  subscription
}) {
  const activeSearchIdRef = useRef(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [activeTags, setActiveTags] = useState([]);
  const [sortBy, setSortBy] = useState('recent');
  const [categoryFilter, setCategoryFilter] = useState(null); // null = all, 'loop', 'oneshot'
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  // Real-Time DSP Audio States (Pitch shifting & Time-stretching)
  const [pitchSemitones, setPitchSemitones] = useState(0);
  const [speedMultiplier, setSpeedMultiplier] = useState(1.0);

  // Pagination states
  const [loadedPages, setLoadedPages] = useState(4);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Pack and Context Menu states
  const [internalActivePack, setInternalActivePack] = useState(null);
  const activePack = propActivePack !== undefined ? propActivePack : internalActivePack;
  const setActivePack = propSetActivePack || setInternalActivePack;

  const [contextMenu, setContextMenu] = useState(null); // { x: 0, y: 0, sound: soundObj }
  const [packDownloading, setPackDownloading] = useState(false);
  const [packDownloadProgress, setPackDownloadProgress] = useState(null);
  const [packLastDownloadedFolder, setPackLastDownloadedFolder] = useState(null);

  // Song Starter Studio states
  const [songStarterModal, setSongStarterModal] = useState(null); // { open: true, seedSound: sound }
  const [songStarterLoading, setSongStarterLoading] = useState(false);
  const [songStarterData, setSongStarterData] = useState(null);
  const [selectedStemIndices, setSelectedStemIndices] = useState({ drums: 0, bass: 0, melody: 0, vocals: 0, fx: 0 });
  const [songStarterDownloading, setSongStarterDownloading] = useState(false);
  const [songStarterDownloadedFolder, setSongStarterDownloadedFolder] = useState(null);

  // License Certificate Modal state
  const [certificateModalSound, setCertificateModalSound] = useState(null);

  // Pro Transient Slicer Modal state
  const [slicerSound, setSlicerSound] = useState(null);

  // Demucs AI Stem Separator Modal state
  const [stemModalSound, setStemModalSound] = useState(null);


  // Subscribe to pack download progress from Electron
  useEffect(() => {
    if (!window.electron?.onPackDownloadProgress) return;
    const unsubscribe = window.electron.onPackDownloadProgress((progressData) => {
      setPackDownloadProgress(progressData);
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);


  // New Redesign States
  const [openDropdown, setOpenDropdown] = useState(null);
  const [localLibraryOnly, setLocalLibraryOnly] = useState(isDownloadsPage);
  const [keyNote, setKeyNote] = useState(null);
  const [keyScale, setKeyScale] = useState(null);
  const [keyAccidentalType, setKeyAccidentalType] = useState('flat');
  const [describeSoundActive, setDescribeSoundActive] = useState(false);

  // BPM Search States: Exact BPM, Range, and Presets
  const [bpmMode, setBpmMode] = useState('exact'); // 'exact' | 'range' | 'preset'
  const [exactBpmInput, setExactBpmInput] = useState('');
  const [minBpmInput, setMinBpmInput] = useState('');
  const [maxBpmInput, setMaxBpmInput] = useState('');
  const [appliedBpmFilter, setAppliedBpmFilter] = useState(null); // { type: 'exact'|'range'|'preset', exact: '174', min: 170, max: 175, label: '174 BPM' }

  const bpmPillLabel = appliedBpmFilter 
    ? (appliedBpmFilter.label || `${appliedBpmFilter.exact ? `${appliedBpmFilter.exact} BPM` : `${appliedBpmFilter.min}-${appliedBpmFilter.max} BPM`}`)
    : 'BPM';

  const handleApplyExactBpm = (valToApply = exactBpmInput) => {
    const parsed = parseInt(valToApply, 10);
    if (!isNaN(parsed) && parsed >= 30 && parsed <= 300) {
      setAppliedBpmFilter({ type: 'exact', exact: String(parsed), label: `${parsed} BPM` });
      setOpenDropdown(null);
    } else {
      if (showToast) showToast('Please enter a valid BPM between 30 and 300', 'error');
    }
  };

  const handleApplyBpmRange = (minVal = minBpmInput, maxVal = maxBpmInput) => {
    const min = parseInt(minVal, 10);
    const max = parseInt(maxVal, 10);
    if (!isNaN(min) && !isNaN(max) && min > 0 && max >= min) {
      setAppliedBpmFilter({ type: 'range', min: min, max: max, label: `${min} - ${max} BPM` });
      setOpenDropdown(null);
    } else {
      if (showToast) showToast('Please enter a valid Min and Max BPM', 'error');
    }
  };

  const handleApplyBpmPreset = (opt) => {
    if (!opt.value) {
      setAppliedBpmFilter(null);
    } else {
      setAppliedBpmFilter({ type: 'preset', presetCode: opt.value, min: opt.min, max: opt.max, label: opt.label });
    }
    setOpenDropdown(null);
  };

  const handleClearBpmFilter = () => {
    setAppliedBpmFilter(null);
    setExactBpmInput('');
    setMinBpmInput('');
    setMaxBpmInput('');
    setOpenDropdown(null);
  };

  const selectedKey = (keyNote || keyScale)
    ? `${keyNote || ''}${keyScale ? ' ' + (keyScale === 'Minor' ? 'Min' : 'Maj') : ''}`.trim()
    : null;

  const handleNoteToggle = (note) => {
    if (keyNote === note) {
      setKeyNote(null);
    } else {
      setKeyNote(note);
    }
  };

  const handleScaleToggle = (scale) => {
    if (keyScale === scale) {
      setKeyScale(null);
    } else {
      setKeyScale(scale);
    }
  };

  const handleClearKeyFilters = () => {
    setKeyNote(null);
    setKeyScale(null);
  };

  const handleAccidentalTypeChange = (type) => {
    setKeyAccidentalType(type);
    if (type === 'flat' && keyNote && sharpToFlat[keyNote]) {
      setKeyNote(sharpToFlat[keyNote]);
    } else if (type === 'sharp' && keyNote && flatToSharp[keyNote]) {
      setKeyNote(flatToSharp[keyNote]);
    }
  };

  const instrumentsList = [
    { label: 'Vocals', query: 'vocal' },
    { label: 'Vocal Chops', query: 'vocal chop' },
    { label: 'Acapellas', query: 'acapella' },
    { label: 'Drums', query: 'drum' },
    { label: 'Kicks', query: 'kick' },
    { label: 'Snares', query: 'snare' },
    { label: 'Claps & Snaps', query: 'clap' },
    { label: 'Hi-Hats', query: 'hihat' },
    { label: 'Percussion', query: 'percussion' },
    { label: 'Bass & 808s', query: 'bass' },
    { label: 'Synths & Leads', query: 'synth' },
    { label: 'Keys & Piano', query: 'piano' },
    { label: 'Guitars', query: 'guitar' },
    { label: 'Brass & Horns', query: 'brass' },
    { label: 'Strings', query: 'strings' },
    { label: 'FX & Risers', query: 'fx' }
  ];

  const genresList = [
    { label: 'Techno', query: 'techno' },
    { label: 'Drum & Bass', query: 'drum and bass' },
    { label: 'House', query: 'house' },
    { label: 'Tech House', query: 'tech house' },
    { label: 'Trap', query: 'trap' },
    { label: 'Hip Hop', query: 'hip hop' },
    { label: 'Lo-Fi', query: 'lo-fi' },
    { label: 'Jungle', query: 'jungle' },
    { label: 'Dubstep', query: 'dubstep' },
    { label: 'Phonk', query: 'phonk' },
    { label: 'Ambient', query: 'ambient' },
    { label: 'Pop & RnB', query: 'rnb pop' },
    { label: 'Cyberpunk / Midtempo', query: 'midtempo' }
  ];

  const bpmOptions = [
    { label: 'All BPM', value: null },
    { label: '< 100 BPM (Hip Hop / Lo-Fi)', value: '<100', min: 40, max: 99 },
    { label: '100 - 120 BPM (Midtempo / R&B)', value: '100-120', min: 100, max: 120 },
    { label: '120 - 130 BPM (House / Tech House)', value: '120-130', min: 120, max: 130 },
    { label: '130 - 145 BPM (Techno / Hard Dance)', value: '130-145', min: 130, max: 145 },
    { label: '140 - 160 BPM (Dubstep / Trap / Drill)', value: '140-160', min: 140, max: 160 },
    { label: '165 - 180 BPM (Drum & Bass / Jungle)', value: '165-180', min: 165, max: 180 },
    { label: '> 180 BPM (Speedcore / Hardcore)', value: '>180', min: 181, max: 300 }
  ];

  // Auto-close dropdowns when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (
        e.target.closest('.filter-pill') || 
        e.target.closest('.pill-dropdown-menu') || 
        e.target.closest('.key-selector-dropdown') ||
        e.target.closest('.bpm-selector-dropdown')
      ) {
        return;
      }
      setOpenDropdown(null);
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, []);

  // Close context menu on global click
  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  // Sync localLibraryOnly when tab switches
  useEffect(() => {
    setLocalLibraryOnly(isDownloadsPage);
  }, [isDownloadsPage]);

  // Fetch sounds — only triggered on Enter key, tag click, sort change, or category change
  const fetchSounds = async (queryOverride) => {
    const currentSearchId = ++activeSearchIdRef.current;
    const queryToUse = queryOverride !== undefined ? queryOverride : submittedQuery;
    setLoading(true);
    setLoadedPages(2);
    setHasMore(true);
    try {
      const filters = { 
        tags: activeTags, 
        sortBy, 
        category: categoryFilter,
        key: keyNote || null,
        chordType: keyScale ? keyScale.toLowerCase() : null,
        exactBpm: appliedBpmFilter?.type === 'exact' ? appliedBpmFilter.exact : null,
        minBpm: appliedBpmFilter?.type === 'range' ? appliedBpmFilter.min : (appliedBpmFilter?.type === 'preset' ? appliedBpmFilter.min : null),
        maxBpm: appliedBpmFilter?.type === 'range' ? appliedBpmFilter.max : (appliedBpmFilter?.type === 'preset' ? appliedBpmFilter.max : null),
        bpm: appliedBpmFilter?.type === 'preset' ? appliedBpmFilter.presetCode : (appliedBpmFilter?.type === 'exact' ? appliedBpmFilter.exact : null),
        startPage: 1,
        endPage: 2,
        packUuid: activePack ? activePack.uuid : null
      };

      const queryTokens = [queryToUse];
      activeTags.forEach(tagLabel => {
        const inst = instrumentsList.find(i => i.label === tagLabel);
        const gen = genresList.find(g => g.label === tagLabel);
        if (inst) queryTokens.push(inst.query);
        else if (gen) queryTokens.push(gen.query);
        else queryTokens.push(tagLabel);
      });
      const query = queryTokens.filter(Boolean).join(' ').trim();

      const results = await window.electron.searchSounds(query, filters);
      if (currentSearchId !== activeSearchIdRef.current) {
        return; // Discard stale request
      }

      setSoundsList(results);

      const spliceCount = results.filter(s => s.source === 'Splice').length;
      if (spliceCount < 90) {
        setHasMore(false);
      }

      if (query) {
        window.electron.trackPage(query).catch(err => console.warn('Telemetry page view failed:', err));
      }
    } catch (err) {
      console.error('Failed to search sounds:', err);
    } finally {
      if (currentSearchId === activeSearchIdRef.current) {
        setLoading(false);
      }
    }
  };

  const loadMoreSounds = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const nextStart = loadedPages + 1;
      const nextEnd = loadedPages + 4;
      const filters = { 
        tags: activeTags, 
        sortBy, 
        category: categoryFilter,
        key: keyNote || null,
        chordType: keyScale ? keyScale.toLowerCase() : null,
        exactBpm: appliedBpmFilter?.type === 'exact' ? appliedBpmFilter.exact : null,
        minBpm: appliedBpmFilter?.type === 'range' ? appliedBpmFilter.min : (appliedBpmFilter?.type === 'preset' ? appliedBpmFilter.min : null),
        maxBpm: appliedBpmFilter?.type === 'range' ? appliedBpmFilter.max : (appliedBpmFilter?.type === 'preset' ? appliedBpmFilter.max : null),
        bpm: appliedBpmFilter?.type === 'preset' ? appliedBpmFilter.presetCode : (appliedBpmFilter?.type === 'exact' ? appliedBpmFilter.exact : null),
        startPage: nextStart,
        endPage: nextEnd,
        packUuid: activePack ? activePack.uuid : null
      };
      const queryTokens = [submittedQuery];
      activeTags.forEach(tagLabel => {
        const inst = instrumentsList.find(i => i.label === tagLabel);
        const gen = genresList.find(g => g.label === tagLabel);
        if (inst) queryTokens.push(inst.query);
        else if (gen) queryTokens.push(gen.query);
        else queryTokens.push(tagLabel);
      });
      const query = queryTokens.filter(Boolean).join(' ').trim();
      const newResults = await window.electron.searchSounds(query, filters);
      
      const newSpliceItems = newResults.filter(s => s.source === 'Splice');
      if (newSpliceItems.length < 180) {
        setHasMore(false);
      }
      
      // Merge and deduplicate
      setSoundsList(prev => {
        const merged = [...prev];
        const seenIds = new Set(merged.map(s => s.id));
        newResults.forEach(item => {
          if (!seenIds.has(item.id)) {
            merged.push(item);
          }
        });
        return merged;
      });
      
      setLoadedPages(nextEnd);
      showToast(`Loaded more results from Wavely (Pages ${nextStart}-${nextEnd})`);
    } catch (err) {
      console.error('Failed to load more sounds:', err);
      showToast('Failed to load more results', 'error');
    }
    setLoadingMore(false);
  };

  // Find Acoustically Similar Sounds
  const handleFindSimilar = (targetSound) => {
    if (!targetSound || !soundsList || soundsList.length === 0) return;
    const similar = findSimilarSounds(targetSound, soundsList, 25);
    if (similar.length > 0) {
      setSoundsList([targetSound, ...similar]);
      setCurrentPage(1);
      if (showToast) showToast(`✨ Ranked ${similar.length} acoustically similar sounds for "${targetSound.name}"`, 'success');
    } else {
      if (showToast) showToast('Searching broader catalog for similar sounds...', 'info');
      const cleanName = (targetSound.name || '').split('_')[0] || '';
      if (cleanName) fetchSounds(cleanName);
    }
  };

  // Submit search on Enter key
  const handleSearchSubmit = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      setSubmittedQuery(searchQuery);
      setCurrentPage(1);
      fetchSounds(searchQuery);
    }
  };

  // Re-fetch when filters/sort/category/key/bpm/activePack change
  useEffect(() => {
    setCurrentPage(1);
    fetchSounds();
  }, [activeTags, sortBy, categoryFilter, activePack, keyNote, keyScale, appliedBpmFilter]);

  const handleTagToggle = (tag) => {
    if (activeTags.includes(tag)) {
      setActiveTags(activeTags.filter(t => t !== tag));
    } else {
      setActiveTags([...activeTags, tag]);
    }
  };

  const toggleDropdown = (dropdownName, e) => {
    e.stopPropagation();
    setOpenDropdown(prev => prev === dropdownName ? null : dropdownName);
  };

  // Check if this is a Splice sample that needs capture
  const isSpliceSample = (sound) => {
    return sound && sound.source === 'Splice' && sound.uuid;
  };

  const getLocalPlaybackUrl = (filePath) => {
    if (!filePath) return '';
    return `wavely-media://local/${encodeURI(String(filePath).replace(/\\/g, '/'))}`;
  };

  // Capture clean audio from Splice via hidden browser decode, returns local file path
  const captureSpliceAudio = async (sound) => {
    if (sound._capturedFilePath) return sound._capturedFilePath;

    try {
      console.log(`[SpliceCapture] Requesting capture for: ${sound.name}`);
      const result = await window.electron.captureSpliceAudio(sound.previewUrl, sound.uuid);
      if (result && result.success && result.filePath) {
        sound._capturedFilePath = result.filePath;
        return result.filePath;
      }
    } catch (err) {
      console.warn('[SpliceCapture] Failed, falling back to raw URL:', err);
    }
    // Fallback: return the raw preview URL
    return sound.previewUrl;
  };

  // Play/pause trigger for individual row
  const handlePlayToggle = async (sound, e) => {
    e.stopPropagation();
    let localPlaybackUrl = getLocalPlaybackUrl(sound.filePath);
    if (sound.filePath && window.electron?.prepareLocalAudio) {
      const prepared = await window.electron.prepareLocalAudio(sound.filePath);
      if (prepared?.success) {
        localPlaybackUrl = prepared.mediaUrl || getLocalPlaybackUrl(prepared.filePath || sound.filePath);
      }
    }
    if (currentSound && currentSound.id === sound.id) {
      if (localPlaybackUrl && currentSound.previewUrl !== localPlaybackUrl) {
        setCurrentSound({ ...sound, previewUrl: localPlaybackUrl });
        setIsPlaying(true);
        return;
      }
      setIsPlaying(!isPlaying);
      if (!isPlaying && sound.source === 'Splice') {
        window.electron.trackPlay(sound).catch(err => console.warn('Telemetry play track failed:', err));
      }
    } else if (localPlaybackUrl) {
      // Downloaded samples always audition from the exact local file that is
      // dragged into the DAW. This keeps playback, copying and drag-and-drop
      // available after a result has been marked as downloaded.
      setCurrentSound({ ...sound, previewUrl: localPlaybackUrl });
      setIsPlaying(true);
    } else {
      // For Splice samples: capture clean audio via hidden browser
      if (isSpliceSample(sound) && !sound._capturedFilePath) {
        setCurrentSound({ ...sound, _descrambling: true });
        setIsPlaying(false);

        const cleanPath = await captureSpliceAudio(sound);

        // Update the sound in the list with the captured file path
        setSoundsList(prev => prev.map(s => {
          if (s.id === sound.id) return { ...s, _capturedFilePath: cleanPath };
          return s;
        }));

        // Set current sound with local file URL for WaveSurfer
        const fileUrl = cleanPath.startsWith('http') || cleanPath.startsWith('data:') 
          ? cleanPath 
          : `file:///${cleanPath.replace(/\\/g, '/')}`;
        setCurrentSound({ ...sound, previewUrl: fileUrl, _capturedFilePath: cleanPath, _descrambling: false });
        setIsPlaying(true);
      } else {
        // Use cached captured path or original URL
        const playUrl = sound._capturedFilePath 
          ? `file:///${sound._capturedFilePath.replace(/\\/g, '/')}` 
          : sound.previewUrl;
        setCurrentSound({ ...sound, previewUrl: playUrl });
        setIsPlaying(true);
      }

      if (sound.source === 'Splice') {
        window.electron.trackPlay(sound).catch(err => console.warn('Telemetry play track failed:', err));
      }
    }
  };

  // Download a single preview sound
  const handleDownload = async (sound, e) => {
    e.stopPropagation();
    try {
      const result = await window.electron.downloadSample(sound);
      if (result.success) {
        // Update local list state
        setSoundsList(prev => prev.map(s => {
          if (s.id === sound.id) {
            return {
              ...s,
              isDownloaded: true,
              filePath: result.filePath,
              previewUrl: getLocalPlaybackUrl(result.filePath)
            };
          }
          return s;
        }));
        
        // Sync active playing sound path if it was downloaded
        if (currentSound && currentSound.id === sound.id) {
          setCurrentSound(prev => ({
            ...prev,
            isDownloaded: true,
            filePath: result.filePath,
            previewUrl: getLocalPlaybackUrl(result.filePath)
          }));
        }

        // Custom bottom-center alert
        if (showToast) {
          showToast(`SUCCESSFULLY SAVED: ${sound.name}`);
        }
      } else {
        if (showToast) {
          showToast(`Download failed: ${result.error}`, 'error');
        }
      }
    } catch (err) {
      console.error('Download error:', err);
      if (showToast) {
        showToast(`Download exception: ${err.message}`, 'error');
      }
    }
  };

  // Triggered when a user drags a sound row
  const handleDragStart = (e, sound) => {
    if (window.electron && !window.electron.isAbletonWebView && sound.filePath) {
      e.preventDefault();
      window.electron.startDrag(sound.filePath);
      return;
    }

    // HTML5 native drag for Ableton Live 12 embedded WebView pane
    if (e.dataTransfer) {
      const fileName = sound.name ? (sound.name.endsWith('.wav') ? sound.name : `${sound.name}.wav`) : 'sample.wav';
      const targetUrl = sound.downloadUrl || sound.previewUrl || sound.filePath;
      if (targetUrl) {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('DownloadURL', `audio/wav:${fileName}:${targetUrl}`);
        e.dataTransfer.setData('text/plain', targetUrl);
        e.dataTransfer.setData('text/uri-list', targetUrl);
      }
    }
  };

  // Download entire pack organized into subfolders with details file
  const handleDownloadEntirePack = async () => {
    if (!activePack || packDownloading) return;
    try {
      // 1. Ask what folder to download all sounds to
      const targetDir = await window.electron.selectFolder();
      if (!targetDir) {
        return; // User cancelled folder selection
      }

      setPackDownloading(true);
      setPackDownloadProgress({
        current: 0,
        total: filteredSounds.length || soundsList.length,
        percent: 0,
        sampleName: 'Initializing pack catalog...',
        packName: activePack.name
      });
      if (showToast) {
        showToast(`Preparing download for "${activePack.name}"...`);
      }

      const result = await window.electron.downloadEntirePack({
        packUuid: activePack.uuid,
        packName: activePack.name,
        coverArtUrl: activePack.coverArtUrl,
        targetFolder: targetDir,
        clientSamples: soundsList
      });

      if (result.success) {
        setPackLastDownloadedFolder(result.packFolderPath);
        // Attach the real saved path to each successfully downloaded sample so
        // it can be auditioned and dragged immediately without a refresh.
        setSoundsList(prev => prev.map(sound => {
          const filePath = result.downloadedFilePaths?.[sound.id];
          if (!filePath) return sound;
          return {
            ...sound,
            isDownloaded: true,
            filePath,
            previewUrl: getLocalPlaybackUrl(filePath)
          };
        }));
        if (showToast) {
          showToast(`SUCCESSFULLY SAVED PACK: ${result.count} sounds downloaded!`);
        }
      } else if (result.cancelled) {
        if (showToast) {
          showToast(`Pack download cancelled. ${result.count} sounds saved.`, 'error');
        }
      } else {
        if (showToast) {
          showToast(`Pack download error: ${result.error}`, 'error');
        }
      }
    } catch (err) {
      console.error('Download entire pack error:', err);
      if (showToast) {
        showToast(`Download failed: ${err.message}`, 'error');
      }
    } finally {
      setPackDownloading(false);
      setPackDownloadProgress(null);
    }
  };

  const handleCancelPackDownload = async () => {
    try {
      await window.electron.cancelPackDownload();
      if (showToast) {
        showToast('Cancelling pack download...');
      }
    } catch (err) {
      console.error('Cancel pack download error:', err);
    }
  };

  const handleOpenPackFolder = (folderPath) => {
    if (folderPath) {
      window.electron.openFolder(folderPath);
    }
  };

  // Open Song Starter Studio
  const handleOpenSongStarter = async (sound) => {
    setContextMenu(null);
    setSongStarterModal({ open: true, seedSound: sound });
    setSongStarterLoading(true);
    setSongStarterDownloadedFolder(null);
    setSelectedStemIndices({ drums: 0, bass: 0, melody: 0, vocals: 0, fx: 0 });

    try {
      const data = await window.electron.buildSongStarterStems(sound);
      setSongStarterData(data);
    } catch (err) {
      console.error('Song starter error:', err);
      if (showToast) {
        showToast('Failed to assemble song starter stems', 'error');
      }
    } finally {
      setSongStarterLoading(false);
    }
  };

  const handleShuffleStem = (cat) => {
    if (!songStarterData?.stems?.[cat]?.length) return;
    const len = songStarterData.stems[cat].length;
    setSelectedStemIndices(prev => ({
      ...prev,
      [cat]: (prev[cat] + 1) % len
    }));
  };

  const handleDownloadSongStarter = async () => {
    if (!songStarterData || songStarterDownloading) return;
    try {
      const targetDir = await window.electron.selectFolder();
      if (!targetDir) return;

      setSongStarterDownloading(true);
      if (showToast) {
        showToast(`Exporting Song Starter Kit to "${targetDir}"...`);
      }

      const selectedStems = {
        drums: songStarterData.stems.drums?.[selectedStemIndices.drums] || null,
        bass: songStarterData.stems.bass?.[selectedStemIndices.bass] || null,
        melody: songStarterData.stems.melody?.[selectedStemIndices.melody] || null,
        vocals: songStarterData.stems.vocals?.[selectedStemIndices.vocals] || null,
        fx: songStarterData.stems.fx?.[selectedStemIndices.fx] || null
      };

      const res = await window.electron.downloadSongStarter({
        starterTitle: songStarterData.starterTitle,
        bpm: songStarterData.bpm,
        key: songStarterData.key,
        selectedStems: selectedStems,
        targetFolder: targetDir
      });

      if (res.success) {
        setSongStarterDownloadedFolder(res.folderPath);
        if (showToast) {
          showToast(`SONG STARTER KIT SAVED! (${res.count} Stems Ready)`);
        }
      } else {
        if (showToast) {
          showToast(`Song starter export error: ${res.error}`, 'error');
        }
      }
    } catch (err) {
      console.error('Song starter download error:', err);
      if (showToast) {
        showToast(`Download failed: ${err.message}`, 'error');
      }
    } finally {
      setSongStarterDownloading(false);
    }
  };



  // Apply client-side key, bpm, and library filters
  let filteredSounds = soundsList;

  const sharpToFlat = {
    'C#': 'Db',
    'D#': 'Eb',
    'F#': 'Gb',
    'G#': 'Ab',
    'A#': 'Bb'
  };
  
  const flatToSharp = {
    'Db': 'C#',
    'Eb': 'D#',
    'Gb': 'F#',
    'Ab': 'G#',
    'Bb': 'A#'
  };

  if (keyNote || keyScale) {
    filteredSounds = filteredSounds.filter(sound => {
      if (!sound.key) return false;
      const soundKeyLower = sound.key.toLowerCase();
      
      // 1. Note matching (if keyNote is selected)
      if (keyNote) {
        const noteNorms = [keyNote.toLowerCase()];
        if (sharpToFlat[keyNote]) noteNorms.push(sharpToFlat[keyNote].toLowerCase());
        if (flatToSharp[keyNote]) noteNorms.push(flatToSharp[keyNote].toLowerCase());
        
        const hasNoteMatch = noteNorms.some(norm => {
          if (soundKeyLower.startsWith(norm)) {
            const nextChar = soundKeyLower[norm.length];
            return !nextChar || nextChar === ' ' || nextChar === 'm';
          }
          return false;
        });
        if (!hasNoteMatch) return false;
      }
      
      // 2. Scale/Mode matching (if keyScale is selected)
      if (keyScale) {
        const isMinor = keyScale.toLowerCase() === 'minor';
        const isMajor = keyScale.toLowerCase() === 'major';
        
        const hasMinorWord = soundKeyLower.includes('min') || soundKeyLower.includes('m') && !soundKeyLower.includes('maj');
        const hasMajorWord = !hasMinorWord && soundKeyLower.length > 0 || soundKeyLower.includes('maj') || soundKeyLower.includes('major');
        
        if (isMinor && !hasMinorWord) return false;
        if (isMajor && hasMinorWord) return false;
      }
      
      return true;
    });
  }

  if (appliedBpmFilter) {
    filteredSounds = filteredSounds.filter(sound => {
      const bpmVal = parseInt(sound.bpm);
      if (isNaN(bpmVal)) return false;
      if (appliedBpmFilter.type === 'exact' && appliedBpmFilter.exact) {
        return bpmVal === parseInt(appliedBpmFilter.exact);
      }
      if (appliedBpmFilter.min && bpmVal < parseInt(appliedBpmFilter.min)) return false;
      if (appliedBpmFilter.max && bpmVal > parseInt(appliedBpmFilter.max)) return false;
      return true;
    });
  }

  // Strict Client-Side Instrument & Genre Filter Enforcement
  const INSTRUMENT_KEYWORDS = {
    'vocals': ['vocal', 'vocals', 'vox', 'acapella', 'acappella', 'chop', 'chant', 'phrase', 'hook', 'speech', 'spoken', 'singer', 'voice', 'adlib', 'talk'],
    'vocal chops': ['vocal chop', 'chop', 'vox chop', 'chopped'],
    'acapellas': ['acapella', 'acappella', 'full vocal', 'vocal hook', 'lead vocal', 'dry vocal'],
    'drums': ['drum', 'drums', 'beat', 'break', 'groove', 'percussion', 'perc', 'kick', 'snare', 'clap', 'hihat', 'hat', 'cymbal', 'tom'],
    'kicks': ['kick', 'kicks', 'bd', 'bassdrum'],
    'snares': ['snare', 'snares', 'sd', 'rimshot'],
    'claps & snaps': ['clap', 'claps', 'snap', 'snaps'],
    'hi-hats': ['hat', 'hats', 'hihat', 'hi-hat', 'closed hat', 'open hat', 'cymbal', 'ride', 'crash'],
    'percussion': ['perc', 'percussion', 'conga', 'bongo', 'shaker', 'tambourine', 'woodblock', 'cowbell'],
    'bass & 808s': ['bass', '808', 'sub', 'reese', 'acid bass', 'bassline', 'low end', 'synth bass'],
    'synths & leads': ['synth', 'lead', 'pluck', 'arp', 'pad', 'chord', 'stab', 'saw', 'supersaw', 'melody', 'melodic'],
    'keys & piano': ['piano', 'keys', 'keyboard', 'rhodes', 'electric piano', 'organ', 'clav'],
    'guitars': ['guitar', 'electric guitar', 'acoustic guitar', 'strum', 'riff', 'nylon'],
    'brass & horns': ['brass', 'horn', 'trumpet', 'saxophone', 'trombone', 'tuba', 'flute', 'wind'],
    'strings': ['string', 'strings', 'violin', 'cello', 'viola', 'orchestral', 'ensemble'],
    'fx & risers': ['fx', 'sfx', 'riser', 'sweep', 'downlifter', 'uplifter', 'impact', 'foley', 'laser', 'drop', 'noise']
  };

  const activeInstrumentTags = activeTags.filter(t => INSTRUMENT_KEYWORDS[String(t).toLowerCase()]);
  if (activeInstrumentTags.length > 0) {
    const requiredKeywords = [];
    activeInstrumentTags.forEach(t => {
      const kws = INSTRUMENT_KEYWORDS[String(t).toLowerCase()];
      if (kws) requiredKeywords.push(...kws);
    });

    filteredSounds = filteredSounds.filter(item => {
      const lowerName = (item.name || '').toLowerCase();
      const tagsLower = (item.tags || []).map(t => (typeof t === 'string' ? t : t.label || '').toLowerCase()).join(' ');
      return requiredKeywords.some(kw => lowerName.includes(kw) || tagsLower.includes(kw));
    });
  }

  if (localLibraryOnly) {
    filteredSounds = filteredSounds.filter(sound => sound.isDownloaded);
  }

  const handleShuffle = () => {
    setSoundsList(prev => [...prev].sort(() => Math.random() - 0.5));
    showToast("Shuffled list results");
  };

  return (
    <div>
      {/* Header title & search bar container */}
      <div className="search-header-container">
        <div className="page-eyebrow">
          {isDownloadsPage ? 'YOUR LOCAL LIBRARY' : 'WAVELY SOUND LIBRARY'}
        </div>
        <h1 className="sounds-header-title">
          {isDownloadsPage ? 'Your sounds, ready.' : 'Find the sound.'}
        </h1>
        <p className="sounds-header-subtitle">
          {submittedQuery
            ? `Showing the closest matches for “${submittedQuery}”.`
            : isDownloadsPage
              ? 'Everything you have saved, in one place.'
              : 'Search, audition, and drop it straight into your session.'}
        </p>

        {/* Splice-style search bar with clear, submit & audio drop-to-search */}
        <form 
          className="splice-search-bar"
          onDragOver={(e) => {
            e.preventDefault();
            e.currentTarget.style.borderColor = '#10b981';
          }}
          onDragLeave={(e) => {
            e.currentTarget.style.borderColor = '';
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.currentTarget.style.borderColor = '';
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              const file = e.dataTransfer.files[0];
              const cleanFileName = file.name.replace(/\.wav$|\.mp3$|\.aif$|\.flac$/i, '').replace(/[^a-zA-Z0-9_\-\s]/g, ' ').trim();
              setSearchQuery(cleanFileName);
              setSubmittedQuery(cleanFileName);
              setCurrentPage(1);
              fetchSounds(cleanFileName);
              if (showToast) showToast(`🎯 Dropped "${file.name}" - Searching catalog for matches!`, 'success');
            }
          }}
          onSubmit={(e) => {
            e.preventDefault();
            setSubmittedQuery(searchQuery);
            setCurrentPage(1);
            fetchSounds(searchQuery);
          }}
        >
          <Search size={18} className="splice-search-icon" />
          <div className="splice-search-input-area">
            <input 
              type="text" 
              placeholder={isDownloadsPage ? "Search your downloaded sounds" : "Search sounds, or drop an audio file here to reverse match"} 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="splice-search-input"
            />
            {searchQuery && (
              <button 
                type="button" 
                onClick={() => {
                  setSearchQuery('');
                  setSubmittedQuery('');
                  setCurrentPage(1);
                  fetchSounds('');
                }}
                className="packs-search-clear-btn"
                title="Clear search"
              >
                <X size={15} />
              </button>
            )}
            <button 
              type="submit"
              className="splice-search-action-btn"
            >
              Search <span aria-hidden="true">↗</span>
            </button>
          </div>
          <div className="splice-search-divider"></div>
          <div 
            className="splice-search-describe"
            onClick={() => setDescribeSoundActive(prev => !prev)}
          >
            <span>Describe a sound</span>
            <span className="beta-badge">BETA</span>
            <div className={`beta-toggle ${describeSoundActive ? 'active' : ''}`}>
              <div className="beta-toggle-thumb"></div>
            </div>
          </div>
        </form>
      </div>

      {/* Navigation tabs & Pro Real-Time DSP Audio Bar */}
      <div className="nav-tabs-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button 
            className={`nav-tab-btn ${activeTab === 'sounds' ? 'active' : ''}`}
            onClick={() => setActiveTab('sounds')}
          >
            Samples
          </button>
          <button 
            className={`nav-tab-btn ${activeTab === 'presets' ? 'active' : ''}`}
            onClick={() => setActiveTab('presets')}
          >
            Presets
          </button>
          <button 
            className={`nav-tab-btn ${activeTab === 'packs' ? 'active' : ''}`}
            onClick={() => setActiveTab('packs')}
          >
            Packs
          </button>
        </div>

        {/* Real-Time Studio DSP Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '4px 10px' }}>
          {/* Pitch Shifter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            <span style={{ fontWeight: '600' }}>Pitch:</span>
            <button 
              onClick={() => setPitchSemitones(p => Math.max(-12, p - 1))}
              style={{ padding: '2px 6px', background: 'var(--bg-hover)', border: '1px solid var(--border-color)', borderRadius: '4px', color: '#f8fafc', cursor: 'pointer', fontSize: '0.75rem' }}
            >
              -
            </button>
            <span 
              onClick={() => setPitchSemitones(0)}
              title="Click to reset pitch to 0"
              style={{ minWidth: '32px', textAlign: 'center', fontWeight: '800', color: pitchSemitones !== 0 ? '#38bdf8' : '#cbd5e1', cursor: 'pointer' }}
            >
              {pitchSemitones > 0 ? `+${pitchSemitones}` : pitchSemitones} st
            </span>
            <button 
              onClick={() => setPitchSemitones(p => Math.min(12, p + 1))}
              style={{ padding: '2px 6px', background: 'var(--bg-hover)', border: '1px solid var(--border-color)', borderRadius: '4px', color: '#f8fafc', cursor: 'pointer', fontSize: '0.75rem' }}
            >
              +
            </button>
          </div>

          <div style={{ width: '1px', height: '16px', background: 'var(--border-color)' }} />

          {/* Speed / Time-Stretch */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            <span style={{ fontWeight: '600' }}>Speed:</span>
            {[0.5, 1.0, 2.0].map(s => (
              <button
                key={s}
                onClick={() => setSpeedMultiplier(s)}
                style={{
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  fontWeight: '700',
                  border: '1px solid',
                  borderColor: speedMultiplier === s ? '#10b981' : 'var(--border-color)',
                  background: speedMultiplier === s ? 'rgba(16, 185, 129, 0.2)' : 'transparent',
                  color: speedMultiplier === s ? '#10b981' : 'var(--text-muted)',
                  cursor: 'pointer'
                }}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Filter pills row */}
      <div className="filter-pills-row">
        {/* Your Library Pill */}
        <button 
          className={`filter-pill ${localLibraryOnly ? 'active' : ''}`}
          onClick={() => {
            if (!isDownloadsPage) {
              setLocalLibraryOnly(!localLibraryOnly);
            }
          }}
          disabled={isDownloadsPage}
        >
          <CheckCircle2 size={14} fill={localLibraryOnly ? "currentColor" : "none"} />
          <span>Your Library</span>
        </button>

        {/* Rare Finds Pill */}
        <button 
          className="filter-pill"
          onClick={() => {
            setSoundsList(prev => [...prev].reverse());
            showToast("Showing rare sample matches first");
          }}
        >
          <Gem size={14} />
          <span>Rare Finds</span>
        </button>

        {/* Instruments Dropdown */}
        <div className="filter-pill-container">
          <button 
            className={`filter-pill ${openDropdown === 'instruments' ? 'open' : ''} ${activeTags.some(t => instrumentsList.some(i => i.label === t)) ? 'active' : ''}`}
            onClick={(e) => toggleDropdown('instruments', e)}
          >
            <span>Instruments {activeTags.filter(t => instrumentsList.some(i => i.label === t)).length > 0 ? `(${activeTags.filter(t => instrumentsList.some(i => i.label === t)).length})` : ''}</span>
            <ChevronDown size={14} />
          </button>
          {openDropdown === 'instruments' && (
            <div className="pill-dropdown-menu" onClick={(e) => e.stopPropagation()}>
              {instrumentsList.map(inst => {
                const isActive = activeTags.includes(inst.label);
                return (
                  <div 
                    key={inst.label} 
                    className={`dropdown-item ${isActive ? 'active' : ''}`}
                    onClick={() => handleTagToggle(inst.label)}
                  >
                    <input type="checkbox" checked={isActive} readOnly />
                    <span>{inst.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Genres Dropdown */}
        <div className="filter-pill-container">
          <button 
            className={`filter-pill ${openDropdown === 'genres' ? 'open' : ''} ${activeTags.some(t => genresList.some(g => g.label === t)) ? 'active' : ''}`}
            onClick={(e) => toggleDropdown('genres', e)}
          >
            <span>Genres {activeTags.filter(t => genresList.some(g => g.label === t)).length > 0 ? `(${activeTags.filter(t => genresList.some(g => g.label === t)).length})` : ''}</span>
            <ChevronDown size={14} />
          </button>
          {openDropdown === 'genres' && (
            <div className="pill-dropdown-menu" onClick={(e) => e.stopPropagation()}>
              {genresList.map(genre => {
                const isActive = activeTags.includes(genre.label);
                return (
                  <div 
                    key={genre.label} 
                    className={`dropdown-item ${isActive ? 'active' : ''}`}
                    onClick={() => handleTagToggle(genre.label)}
                  >
                    <input type="checkbox" checked={isActive} readOnly />
                    <span>{genre.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Key Dropdown */}
        <div className="filter-pill-container">
          <button 
            className={`filter-pill ${selectedKey ? 'active' : ''}`}
            onClick={(e) => toggleDropdown('key', e)}
          >
            <span>{selectedKey ? `Key: ${selectedKey}` : 'Key'}</span>
            <ChevronDown size={14} />
          </button>
          {openDropdown === 'key' && (
            <div className="key-selector-dropdown" onClick={(e) => e.stopPropagation()}>
              {/* Tabs */}
              <div className="key-tabs">
                <button 
                  className={`key-tab ${keyAccidentalType === 'flat' ? 'active' : ''}`}
                  onClick={() => handleAccidentalTypeChange('flat')}
                >
                  Flat keys
                </button>
                <button 
                  className={`key-tab ${keyAccidentalType === 'sharp' ? 'active' : ''}`}
                  onClick={() => handleAccidentalTypeChange('sharp')}
                >
                  Sharp keys
                </button>
              </div>

              {/* Piano keys selector container */}
              <div className="key-keyboard">
                {/* Black Keys (accidentals) */}
                <div className="black-keys-grid">
                  {keyAccidentalType === 'flat' ? (
                    <>
                      <button 
                        className={`key-btn black-key ${keyNote === 'Db' ? 'active' : ''}`}
                        onClick={() => handleNoteToggle('Db')}
                        style={{ gridColumn: '2 / span 2' }}
                      >Db</button>
                      <button 
                        className={`key-btn black-key ${keyNote === 'Eb' ? 'active' : ''}`}
                        onClick={() => handleNoteToggle('Eb')}
                        style={{ gridColumn: '4 / span 2' }}
                      >Eb</button>
                      <button 
                        className={`key-btn black-key ${keyNote === 'Gb' ? 'active' : ''}`}
                        onClick={() => handleNoteToggle('Gb')}
                        style={{ gridColumn: '8 / span 2' }}
                      >Gb</button>
                      <button 
                        className={`key-btn black-key ${keyNote === 'Ab' ? 'active' : ''}`}
                        onClick={() => handleNoteToggle('Ab')}
                        style={{ gridColumn: '10 / span 2' }}
                      >Ab</button>
                      <button 
                        className={`key-btn black-key ${keyNote === 'Bb' ? 'active' : ''}`}
                        onClick={() => handleNoteToggle('Bb')}
                        style={{ gridColumn: '12 / span 2' }}
                      >Bb</button>
                    </>
                  ) : (
                    <>
                      <button 
                        className={`key-btn black-key ${keyNote === 'C#' ? 'active' : ''}`}
                        onClick={() => handleNoteToggle('C#')}
                        style={{ gridColumn: '2 / span 2' }}
                      >C#</button>
                      <button 
                        className={`key-btn black-key ${keyNote === 'D#' ? 'active' : ''}`}
                        onClick={() => handleNoteToggle('D#')}
                        style={{ gridColumn: '4 / span 2' }}
                      >D#</button>
                      <button 
                        className={`key-btn black-key ${keyNote === 'F#' ? 'active' : ''}`}
                        onClick={() => handleNoteToggle('F#')}
                        style={{ gridColumn: '8 / span 2' }}
                      >F#</button>
                      <button 
                        className={`key-btn black-key ${keyNote === 'G#' ? 'active' : ''}`}
                        onClick={() => handleNoteToggle('G#')}
                        style={{ gridColumn: '10 / span 2' }}
                      >G#</button>
                      <button 
                        className={`key-btn black-key ${keyNote === 'A#' ? 'active' : ''}`}
                        onClick={() => handleNoteToggle('A#')}
                        style={{ gridColumn: '12 / span 2' }}
                      >A#</button>
                    </>
                  )}
                </div>

                {/* White Keys */}
                <div className="white-keys-grid">
                  {[
                    { note: 'C', col: '1 / span 2' },
                    { note: 'D', col: '3 / span 2' },
                    { note: 'E', col: '5 / span 2' },
                    { note: 'F', col: '7 / span 2' },
                    { note: 'G', col: '9 / span 2' },
                    { note: 'A', col: '11 / span 2' },
                    { note: 'B', col: '13 / span 2' }
                  ].map(item => (
                    <button 
                      key={item.note}
                      className={`key-btn white-key ${keyNote === item.note ? 'active' : ''}`}
                      onClick={() => handleNoteToggle(item.note)}
                      style={{ gridColumn: item.col }}
                    >
                      {item.note}
                    </button>
                  ))}
                </div>
              </div>

              {/* Mode Buttons */}
              <div className="key-modes-row">
                <button 
                  className={`mode-btn ${keyScale === 'Major' ? 'active' : ''}`}
                  onClick={() => handleScaleToggle('Major')}
                >
                  Major
                </button>
                <button 
                  className={`mode-btn ${keyScale === 'Minor' ? 'active' : ''}`}
                  onClick={() => handleScaleToggle('Minor')}
                >
                  Minor
                </button>
              </div>

              {/* Footer */}
              <div className="key-selector-footer">
                <button className="clear-btn" onClick={handleClearKeyFilters}>
                  Clear
                </button>
                <button className="close-btn" onClick={() => setOpenDropdown(null)}>
                  Close
                </button>
              </div>
            </div>
          )}
        </div>

        {/* BPM Dropdown / Selector Modal */}
        <div className="filter-pill-container">
          <button 
            className={`filter-pill ${appliedBpmFilter ? 'active' : ''} ${openDropdown === 'bpm' ? 'open' : ''}`}
            onClick={(e) => toggleDropdown('bpm', e)}
          >
            <span>{bpmPillLabel}</span>
            <ChevronDown size={14} />
          </button>
          {openDropdown === 'bpm' && (
            <div className="bpm-selector-dropdown" onClick={(e) => e.stopPropagation()}>
              {/* Mode Selector Tabs */}
              <div className="bpm-tabs-row">
                <button 
                  className={`bpm-tab-btn ${bpmMode === 'exact' ? 'active' : ''}`}
                  onClick={() => setBpmMode('exact')}
                >
                  Exact BPM
                </button>
                <button 
                  className={`bpm-tab-btn ${bpmMode === 'range' ? 'active' : ''}`}
                  onClick={() => setBpmMode('range')}
                >
                  BPM Range
                </button>
                <button 
                  className={`bpm-tab-btn ${bpmMode === 'preset' ? 'active' : ''}`}
                  onClick={() => setBpmMode('preset')}
                >
                  Presets
                </button>
              </div>

              {/* Exact BPM Mode */}
              {bpmMode === 'exact' && (
                <div className="bpm-section-content">
                  <div className="bpm-input-wrapper">
                    <button 
                      className="bpm-quick-btn"
                      onClick={() => setExactBpmInput(prev => String(Math.max(30, (parseInt(prev, 10) || 120) - 1)))}
                    >
                      -1
                    </button>
                    <input 
                      type="number" 
                      placeholder="e.g. 174" 
                      value={exactBpmInput}
                      onChange={(e) => setExactBpmInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleApplyExactBpm();
                      }}
                      className="bpm-number-input"
                      autoFocus
                    />
                    <button 
                      className="bpm-quick-btn"
                      onClick={() => setExactBpmInput(prev => String(Math.min(300, (parseInt(prev, 10) || 120) + 1)))}
                    >
                      +1
                    </button>
                  </div>

                  {/* Popular BPM Quick Buttons */}
                  <div className="bpm-quick-buttons-row">
                    {['80', '110', '120', '124', '128', '140', '150', '170', '174', '175'].map(val => (
                      <button 
                        key={val}
                        className={`bpm-quick-btn ${exactBpmInput === val ? 'active' : ''}`}
                        onClick={() => {
                          setExactBpmInput(val);
                          handleApplyExactBpm(val);
                        }}
                      >
                        {val}
                      </button>
                    ))}
                  </div>

                  <button 
                    className="bpm-apply-btn"
                    onClick={() => handleApplyExactBpm()}
                  >
                    Apply Exact BPM
                  </button>
                </div>
              )}

              {/* BPM Range Mode */}
              {bpmMode === 'range' && (
                <div className="bpm-section-content">
                  <div className="bpm-range-row">
                    <span className="bpm-range-label">From:</span>
                    <input 
                      type="number" 
                      placeholder="Min (e.g. 170)" 
                      value={minBpmInput}
                      onChange={(e) => setMinBpmInput(e.target.value)}
                      className="bpm-number-input"
                    />
                    <span className="bpm-range-label">To:</span>
                    <input 
                      type="number" 
                      placeholder="Max (e.g. 175)" 
                      value={maxBpmInput}
                      onChange={(e) => setMaxBpmInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleApplyBpmRange();
                      }}
                      className="bpm-number-input"
                    />
                  </div>

                  {/* Quick Range Chips */}
                  <div className="bpm-quick-buttons-row">
                    {[
                      { min: '70', max: '95', label: '70-95 (Hip Hop)' },
                      { min: '120', max: '128', label: '120-128 (House)' },
                      { min: '128', max: '138', label: '128-138 (Techno)' },
                      { min: '140', max: '150', label: '140-150 (Trap/Dubstep)' },
                      { min: '170', max: '175', label: '170-175 (DnB)' }
                    ].map(r => (
                      <button 
                        key={r.label}
                        className={`bpm-quick-btn ${minBpmInput === r.min && maxBpmInput === r.max ? 'active' : ''}`}
                        onClick={() => {
                          setMinBpmInput(r.min);
                          setMaxBpmInput(r.max);
                          handleApplyBpmRange(r.min, r.max);
                        }}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>

                  <button 
                    className="bpm-apply-btn"
                    onClick={() => handleApplyBpmRange()}
                  >
                    Apply BPM Range
                  </button>
                </div>
              )}

              {/* Presets Mode */}
              {bpmMode === 'preset' && (
                <div className="bpm-section-content">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '200px', overflowY: 'auto' }}>
                    {bpmOptions.map(opt => {
                      const isActive = appliedBpmFilter?.type === 'preset' && appliedBpmFilter.presetCode === opt.value;
                      return (
                        <div 
                          key={opt.label} 
                          className={`dropdown-item ${isActive ? 'active' : ''}`}
                          onClick={() => handleApplyBpmPreset(opt)}
                          style={{ padding: '7px 10px', borderRadius: '6px' }}
                        >
                          <span>{opt.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Footer */}
              <div className="bpm-footer-row">
                <button className="bpm-clear-btn" onClick={handleClearBpmFilter}>
                  Clear BPM
                </button>
                <button className="bpm-close-btn" onClick={() => setOpenDropdown(null)}>
                  Close
                </button>
              </div>
            </div>
          )}
        </div>

        {/* One-Shots & Loops Dropdown */}
        <div className="filter-pill-container">
          <button 
            className={`filter-pill ${categoryFilter ? 'active' : ''}`}
            onClick={(e) => toggleDropdown('type', e)}
          >
            <span>{categoryFilter === 'loop' ? 'Loops' : categoryFilter === 'oneshot' ? 'One-Shots' : 'One-Shots & Loops'}</span>
            <ChevronDown size={14} />
          </button>
          {openDropdown === 'type' && (
            <div className="pill-dropdown-menu" onClick={(e) => e.stopPropagation()}>
              {[
                { label: 'All Types', value: null },
                { label: 'Loops', value: 'loop' },
                { label: 'One-Shots', value: 'oneshot' }
              ].map(opt => {
                const isActive = categoryFilter === opt.value;
                return (
                  <div 
                    key={opt.label} 
                    className={`dropdown-item ${isActive ? 'active' : ''}`}
                    onClick={() => setCategoryFilter(opt.value)}
                  >
                    <span>{opt.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Reset Filters Pill */}
        {(activeTags.length > 0 || categoryFilter !== null || selectedKey !== null || appliedBpmFilter !== null) && (
          <button 
            className="filter-pill active" 
            onClick={() => {
              setActiveTags([]);
              setCategoryFilter(null);
              setKeyNote(null);
              setKeyScale(null);
              setAppliedBpmFilter(null);
              setExactBpmInput('');
              setMinBpmInput('');
              setMaxBpmInput('');
              showToast("Filters reset successfully");
            }}
            title="Reset Filters"
            style={{ 
              backgroundColor: 'rgba(239, 68, 68, 0.1)', 
              borderColor: 'rgba(239, 68, 68, 0.25)', 
              color: '#ef4444' 
            }}
          >
            <Sliders size={14} />
            <span>Reset Filters</span>
          </button>
        )}
      </div>

      {/* Active Filter Chips */}
      {activeTags.length > 0 && (
        <div className="active-filter-chips-row" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px', marginBottom: '8px' }}>
          {activeTags.map(tag => (
            <span 
              key={tag} 
              className="active-filter-chip"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: 'rgba(124, 58, 237, 0.15)',
                border: '1px solid rgba(124, 58, 237, 0.35)',
                color: '#a78bfa',
                padding: '4px 10px',
                borderRadius: '20px',
                fontSize: '0.78rem',
                fontWeight: '600',
                cursor: 'pointer'
              }}
              onClick={() => handleTagToggle(tag)}
              title="Click to remove"
            >
              <span>{tag}</span>
              <X size={12} />
            </span>
          ))}
          <button
            onClick={() => setActiveTags([])}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '0.75rem',
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: '4px 8px'
            }}
          >
            Clear tags
          </button>
        </div>
      )}

      {/* Active Pack Banner */}
      {activePack && (
        <div className="active-pack-banner" style={{ 
          display: 'flex', 
          flexDirection: 'column',
          gap: '16px',
          padding: '20px 24px', 
          background: 'var(--bg-lighter, #121214)', 
          borderRadius: '12px', 
          border: '1px solid var(--border-color, #232326)', 
          marginBottom: '20px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.25)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            {activePack.coverArtUrl ? (
              <img 
                src={activePack.coverArtUrl} 
                alt={activePack.name} 
                style={{ width: '80px', height: '80px', borderRadius: '8px', objectFit: 'cover', border: '1px solid rgba(255,255,255,0.05)' }} 
              />
            ) : (
              <div style={{ width: '80px', height: '80px', borderRadius: '8px', background: 'var(--accent-gradient)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '0.8rem', color: '#fff' }}>
                PACK
              </div>
            )}
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--accent-color)', fontWeight: 'bold', letterSpacing: '1.2px' }}>
                  Viewing Pack Catalog
                </span>
                <span style={{ fontSize: '0.75rem', backgroundColor: 'rgba(124, 58, 237, 0.15)', color: 'var(--accent-color)', padding: '2px 8px', borderRadius: '4px', fontWeight: '700' }}>
                  {filteredSounds.length} Samples
                </span>
              </div>
              <h2 style={{ fontSize: '1.4rem', margin: 0, color: 'var(--text-main, #ffffff)', fontWeight: '800' }}>
                {activePack.name}
              </h2>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Showing samples from this library pack. Download all sounds organized into subfolders with one click.
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {/* DOWNLOAD ALL PACK BUTTON */}
              <button 
                className="pack-download-all-btn"
                disabled={packDownloading}
                onClick={handleDownloadEntirePack}
                title="Download all sounds in this pack organized into subfolders"
              >
                {packDownloading ? (
                  <>
                    <Loader2 size={16} className="spin-animation" />
                    <span>Downloading...</span>
                  </>
                ) : (
                  <>
                    <Download size={16} />
                    <span>DOWNLOAD ALL</span>
                  </>
                )}
              </button>

              {/* OPEN FOLDER BUTTON (If previously downloaded) */}
              {packLastDownloadedFolder && (
                <button
                  onClick={() => handleOpenPackFolder(packLastDownloadedFolder)}
                  title="Open downloaded pack folder in File Explorer"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '10px 16px',
                    fontSize: '0.85rem',
                    backgroundColor: 'rgba(6, 182, 212, 0.12)',
                    color: 'var(--accent-secondary, #06b6d4)',
                    border: '1px solid rgba(6, 182, 212, 0.25)',
                    borderRadius: '8px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    height: 'auto',
                    width: 'auto'
                  }}
                >
                  <FolderOpen size={16} />
                  <span>Open Folder</span>
                </button>
              )}

              {/* CLEAR PACK FILTER BUTTON */}
              <button 
                onClick={() => {
                  setActivePack(null);
                  showToast("Cleared pack view filter");
                }}
                style={{ 
                  padding: '10px 20px', 
                  fontSize: '0.85rem', 
                  backgroundColor: 'rgba(239, 68, 68, 0.1)', 
                  color: '#ef4444', 
                  border: '1px solid rgba(239, 68, 68, 0.2)', 
                  borderRadius: '8px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  height: 'auto',
                  width: 'auto'
                }}
              >
                Clear Pack Filter
              </button>
            </div>
          </div>

          {/* Pack Download Progress Bar */}
          {packDownloading && (
            <div style={{
              background: 'var(--bg-tertiary, #1b1b22)',
              padding: '12px 16px',
              borderRadius: '8px',
              border: '1px solid var(--border-color, #262630)',
              marginTop: '4px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', fontSize: '0.8rem' }}>
                <span style={{ color: 'var(--text-main)', fontWeight: '600', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {packDownloadProgress?.sampleName || 'Downloading samples...'}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ color: 'var(--accent-secondary, #06b6d4)', fontWeight: '700' }}>
                    {packDownloadProgress?.current || 0} / {packDownloadProgress?.total || filteredSounds.length} ({packDownloadProgress?.percent || 0}%)
                  </span>
                  <button
                    onClick={handleCancelPackDownload}
                    style={{
                      background: 'rgba(239, 68, 68, 0.15)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      color: '#ef4444',
                      padding: '3px 10px',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
              <div style={{
                width: '100%',
                height: '6px',
                background: 'rgba(255, 255, 255, 0.08)',
                borderRadius: '3px',
                overflow: 'hidden'
              }}>
                <div style={{
                  height: '100%',
                  width: `${packDownloadProgress?.percent || 0}%`,
                  background: '#dfff00',
                  borderRadius: '3px',
                  transition: 'width 0.2s ease-out'
                }}></div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Results and active filter status row */}
      <div className="results-status-row">
        <div className="results-count-text">
          {loading ? 'Searching...' : `${filteredSounds.length} results`}
        </div>

        <div className="status-right-side">
          {submittedQuery && (
            <div className="active-query-chip">
              <span>{submittedQuery}</span>
              <button 
                onClick={() => {
                  setSearchQuery('');
                  setSubmittedQuery('');
                  fetchSounds('');
                }}
                className="clear-query-btn"
              >
                ✕
              </button>
            </div>
          )}

          <button 
            className="shuffle-btn" 
            onClick={handleShuffle}
            title="Shuffle Results"
          >
            <Sparkles size={14} />
          </button>

          <select 
            value={sortBy} 
            onChange={(e) => setSortBy(e.target.value)}
            className="custom-sort-select"
          >
            <option value="recent">Most popular ↕</option>
            <option value="bpm-high">BPM: High to Low ↕</option>
            <option value="bpm-low">BPM: Low to High ↕</option>
          </select>
        </div>
      </div>

      {/* Main sounds audio table list */}
      <div className="audio-list">
        <div className="audio-row-header">
          <div>Play</div>
          <div>Filename / Tags</div>
          <div>Audition Waveform</div>
          <div>Time</div>
          <div>Key</div>
          <div>BPM</div>
          <div style={{ textAlign: 'right' }}>Download / Drag</div>
        </div>

        {loading && filteredSounds.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
            Loading premium samples library...
          </div>
        ) : filteredSounds.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
            No samples found. Try adjusting filters or query.
          </div>
        ) : (
          (() => {
            const totalPages = Math.ceil(filteredSounds.length / itemsPerPage);
            const currentSounds = filteredSounds.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
            
            return currentSounds.map(sound => {
              const isSelected = currentSound && currentSound.id === sound.id;
            return (
              <div 
                key={sound.id}
                className={`audio-row ${isSelected ? 'playing' : ''}`}
                onClick={(e) => handlePlayToggle(sound, e)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({
                    x: e.clientX,
                    y: e.clientY,
                    sound: sound
                  });
                }}
              >
                {/* Play/Pause Button Cell */}
                <div className="play-cell">
                  <button 
                    className={`row-play-btn ${isSelected && isPlaying ? 'active' : ''}`}
                    onClick={(e) => handlePlayToggle(sound, e)}
                  >
                    {isSelected && currentSound?._descrambling ? (
                      <span style={{ fontSize: '10px', color: '#06b6d4', fontWeight: 700, letterSpacing: '0.05em' }}>...</span>
                    ) : isSelected && isPlaying ? (
                      <Pause size={14} fill="currentColor" />
                    ) : (
                      <Play size={14} fill="currentColor" style={{ marginLeft: '1px' }} />
                    )}
                  </button>
                </div>

                {/* Filename & Tag badges Cell */}
                <div className="name-cell">
                  <span className="sample-name" title={sound.name}>{sound.name}</span>
                  <div className="sample-tags">
                    <span className="tag-badge" style={{ backgroundColor: 'rgba(124, 58, 237, 0.1)', color: 'var(--accent-color)', borderColor: 'transparent' }}>
                      {sound.source}
                    </span>
                    {sound.tags?.slice(0, 4).map(tag => (
                      <span key={tag} className="tag-badge">{tag}</span>
                    ))}
                  </div>
                </div>

                {/* Waveform Renderer Cell (Optimized) */}
                <div className="waveform-cell">
                  {isSelected ? (
                    currentSound?._descrambling ? (
                      <div className="descrambling-loader" style={{
                        color: 'var(--accent-secondary)',
                        fontSize: '0.7rem',
                        fontWeight: '700',
                        letterSpacing: '1px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        animation: 'pulse 1.5s infinite ease-in-out',
                        paddingLeft: '12px'
                      }}>
                        <span style={{ fontSize: '0.9rem', color: 'var(--accent-color)' }}>●</span> DESCRAMBLING AUDIO PREVIEW...
                      </div>
                    ) : (
                      <WaveformRenderer 
                        audioUrl={currentSound?.previewUrl || sound.previewUrl}
                        isPlaying={isPlaying && !currentSound?._descrambling}
                        onPlayPause={setIsPlaying}
                        active={isSelected && !currentSound?._descrambling}
                        isGlobal={false}
                        sampleName={sound.name}
                        sampleTags={sound.tags}
                        volume={volume}
                        pitchSemitones={pitchSemitones}
                        speedMultiplier={speedMultiplier}
                        onError={(msg) => showToast(msg, 'error')}
                      />
                    )
                  ) : (
                    /* Beautiful custom static SVG waveform placeholder */
                    <svg viewBox="0 0 100 20" preserveAspectRatio="none" style={{ width: '100%', height: '100%', opacity: 0.2 }}>
                      <path 
                        d="M0,10 L2,8 L4,12 L6,7 L8,13 L10,6 L12,14 L14,8 L16,11 L18,9 L20,13 L22,7 L24,15 L26,9 L28,12 L30,5 L32,16 L34,8 L36,11 L38,7 L40,14 L42,9 L44,12 L46,6 L48,15 L50,8 L52,11 L54,7 L56,13 L58,9 L60,12 L62,5 L64,16 L66,8 L68,11 L70,6 L72,14 L74,9 L76,12 L78,7 L80,13 L82,8 L84,11 L86,6 L88,14 L90,9 L92,12 L94,8 L96,11 L98,10 L100,10 L100,10 L98,10 L96,9 L94,12 L92,8 L90,11 L88,6 L86,14 L84,9 L82,12 L80,7 L78,13 L76,8 L74,11 L72,6 L70,14 L68,9 L66,12 L64,5 L62,16 L60,8 L58,11 L56,7 L54,13 L52,9 L50,12 L48,6 L46,15 L44,8 L42,11 L40,7 L38,14 L36,9 L34,12 L32,5 L30,16 L28,8 L26,11 L24,7 L22,13 L20,9 L18,12 L16,5 L14,14 L12,8 L10,11 L8,6 L6,13 L4,9 L2,12 Z" 
                        fill="currentColor" 
                        stroke="none"
                      />
                    </svg>
                  )}
                </div>

                {/* File Metadata Cells */}
                <div className="time-cell">{sound.duration}</div>
                <div className="key-cell">{sound.key}</div>
                <div className="bpm-cell">{sound.bpm}</div>

                {/* Action button: Certificate + Download / DAW Drag-and-Drop Cell */}
                <div className="action-cell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                  {/* Local AI Demucs Stem Separator Button */}
                  <button 
                    className="action-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setStemModalSound(sound);
                    }}
                    title="Separate into 4 isolated audio stems with local AI Demucs"
                    style={{
                      opacity: 0.7,
                      transition: 'all 0.15s ease',
                      color: 'var(--text-muted)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = '1';
                      e.currentTarget.style.color = '#a855f7';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = '0.7';
                      e.currentTarget.style.color = 'var(--text-muted)';
                    }}
                  >
                    <Cpu size={14} />
                  </button>

                  {/* Pro Transient Slicer Button */}
                  <button 
                    className="action-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSlicerSound(sound);
                    }}
                    title="Chop and slice loop in Transient Slicer"
                    style={{
                      opacity: 0.7,
                      transition: 'all 0.15s ease',
                      color: 'var(--text-muted)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = '1';
                      e.currentTarget.style.color = '#38bdf8';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = '0.7';
                      e.currentTarget.style.color = 'var(--text-muted)';
                    }}
                  >
                    <Scissors size={14} />
                  </button>

                  {/* AI Acoustic Similarity Button */}
                  <button 
                    className="action-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleFindSimilar(sound);
                    }}
                    title="Find Acoustically Similar Sounds"
                    style={{
                      opacity: 0.7,
                      transition: 'all 0.15s ease',
                      color: 'var(--text-muted)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = '1';
                      e.currentTarget.style.color = '#10b981';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = '0.7';
                      e.currentTarget.style.color = 'var(--text-muted)';
                    }}
                  >
                    <Sparkles size={14} />
                  </button>

                  <button 
                    className="action-btn cert-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCertificateModalSound(sound);
                    }}
                    title="Generate Royalty-Free License Certificate"
                    style={{
                      opacity: 0.7,
                      transition: 'all 0.15s ease',
                      color: 'var(--text-muted)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = '1';
                      e.currentTarget.style.color = '#fbbf24';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = '0.7';
                      e.currentTarget.style.color = 'var(--text-muted)';
                    }}
                  >
                    <Award size={15} />
                  </button>

                  {sound.isDownloaded ? (
                    <button 
                      className="action-btn downloaded pulse-playing"
                      draggable="true"
                      onDragStart={(e) => handleDragStart(e, sound)}
                      title="DRAG ME INTO YOUR DAW!"
                      onClick={(e) => e.stopPropagation()} // block row play trigger
                    >
                      <CheckCircle2 size={16} />
                    </button>
                  ) : (
                    <button 
                      className="action-btn"
                      onClick={(e) => handleDownload(sound, e)}
                      title="Download sample to DAW library"
                    >
                      <CloudDownload size={16} />
                    </button>
                  )}
                </div>
              </div>
            );
          })
          })()
        )}
      </div>
      
      {/* Load More Button */}
      {!localLibraryOnly && hasMore && (
        <div className="load-more-container" style={{ display: 'flex', justifyContent: 'center', padding: '20px 0 10px 0' }}>
          <button 
            onClick={loadMoreSounds} 
            disabled={loadingMore}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px', 
              padding: '10px 24px', 
              borderRadius: '8px', 
              backgroundColor: 'var(--accent-color)', 
              color: '#ffffff', 
              border: 'none', 
              cursor: loadingMore ? 'not-allowed' : 'pointer',
              fontSize: '0.9rem',
              fontWeight: '600',
              opacity: loadingMore ? 0.7 : 1,
              transition: 'all 0.2s',
              height: 'auto',
              width: 'auto',
              boxShadow: '0 4px 12px rgba(124, 58, 237, 0.3)'
            }}
          >
            {loadingMore ? 'Fetching next 200 samples...' : `Load More Results (Pages 1-${loadedPages} loaded)`}
          </button>
        </div>
      )}

      {/* Pagination Controls */}
      {soundsList.length > itemsPerPage && (
        <div className="pagination-controls" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '15px', padding: '20px 0', color: 'var(--text-color)', marginBottom: '80px' }}>
          <button 
            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
            disabled={currentPage === 1}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '8px 12px', background: 'var(--bg-lighter)', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', opacity: currentPage === 1 ? 0.5 : 1, color: 'inherit' }}
          >
            <ChevronLeft size={16} /> Prev
          </button>
          
          <span style={{ fontSize: '0.9rem' }}>
            Page <strong style={{ color: 'var(--accent-color)' }}>{currentPage}</strong> of <strong>{Math.ceil(soundsList.length / itemsPerPage)}</strong>
          </span>
          
          <button 
            onClick={() => setCurrentPage(prev => Math.min(prev + 1, Math.ceil(soundsList.length / itemsPerPage)))}
            disabled={currentPage === Math.ceil(soundsList.length / itemsPerPage)}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '8px 12px', background: 'var(--bg-lighter)', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: currentPage === Math.ceil(soundsList.length / itemsPerPage) ? 'not-allowed' : 'pointer', opacity: currentPage === Math.ceil(soundsList.length / itemsPerPage) ? 0.5 : 1, color: 'inherit' }}
          >
            Next <ChevronRight size={16} />
          </button>
        </div>
      )}

      {/* Right-click Context Menu */}
      {contextMenu && (
        <div 
          className="custom-context-menu" 
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            backgroundColor: 'var(--bg-lighter, #121214)',
            border: '1px solid var(--border-color, #232326)',
            borderRadius: '8px',
            padding: '6px 0',
            zIndex: 10000,
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
            minWidth: '220px'
          }}
        >
          {/* Generate License Certificate */}
          <div 
            className="context-menu-item"
            onClick={() => {
              setCertificateModalSound(contextMenu.sound);
              setContextMenu(null);
            }}
            style={{
              padding: '10px 16px',
              fontSize: '0.85rem',
              color: '#fbbf24',
              fontWeight: '700',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              transition: 'background-color 0.2s',
              borderBottom: '1px solid rgba(255, 255, 255, 0.05)'
            }}
            onMouseEnter={(e) => e.target.style.backgroundColor = 'var(--bg-dark, #1c1c1f)'}
            onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
          >
            <Award size={15} color="#fbbf24" />
            <span>Generate License Certificate</span>
          </div>

          {/* Song Starter Creator */}
          <div 
            className="context-menu-item"
            onClick={() => handleOpenSongStarter(contextMenu.sound)}
            style={{
              padding: '10px 16px',
              fontSize: '0.85rem',
              color: 'var(--accent-secondary, #06b6d4)',
              fontWeight: '700',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              transition: 'background-color 0.2s',
              borderBottom: '1px solid rgba(255, 255, 255, 0.05)'
            }}
            onMouseEnter={(e) => e.target.style.backgroundColor = 'var(--bg-dark, #1c1c1f)'}
            onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
          >
            <Zap size={15} fill="#06b6d4" />
            <span>Create Song Starter Kit</span>
          </div>

          {/* View Pack option if available */}
          {contextMenu.sound.packUuid && (
            <div 
              className="context-menu-item"
              onClick={() => {
                setActivePack({
                  uuid: contextMenu.sound.packUuid,
                  name: contextMenu.sound.pack,
                  coverArtUrl: contextMenu.sound.coverArtUrl
                });
                setContextMenu(null);
              }}
              style={{
                padding: '10px 16px',
                fontSize: '0.85rem',
                color: 'var(--text-main)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                transition: 'background-color 0.2s'
              }}
              onMouseEnter={(e) => e.target.style.backgroundColor = 'var(--bg-dark, #1c1c1f)'}
              onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
            >
              <FolderOpen size={15} />
              <span>View Pack Catalog</span>
            </div>
          )}

          {/* Single Download */}
          <div 
            className="context-menu-item"
            onClick={(e) => {
              handleDownload(contextMenu.sound, e);
              setContextMenu(null);
            }}
            style={{
              padding: '10px 16px',
              fontSize: '0.85rem',
              color: 'var(--text-main)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => e.target.style.backgroundColor = 'var(--bg-dark, #1c1c1f)'}
            onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
          >
            <Download size={15} />
            <span>Download Sample</span>
          </div>
        </div>
      )}

      {/* Song Starter Studio Modal */}
      {songStarterModal && (
        <div className="song-starter-modal-overlay" onClick={() => !songStarterDownloading && setSongStarterModal(null)}>
          <div className="song-starter-modal-card" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="song-starter-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div className="song-starter-icon-badge">
                  <Zap size={22} fill="#06b6d4" color="#06b6d4" />
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--accent-secondary, #06b6d4)', fontWeight: '800', letterSpacing: '1.2px' }}>
                    Song Starter Studio
                  </div>
                  <h2 style={{ fontSize: '1.25rem', margin: '2px 0 0 0', color: 'var(--text-main)', fontWeight: '800' }}>
                    {songStarterData?.starterTitle || `${songStarterModal?.seedSound?.name || 'Custom'} Kit`}
                  </h2>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span className="starter-badge">
                  {songStarterData?.bpm || songStarterModal?.seedSound?.bpm || '124'} BPM
                </span>
                <span className="starter-badge">
                  Key: {songStarterData?.key || songStarterModal?.seedSound?.key || 'C min'}
                </span>
                <button 
                  className="song-starter-close-btn"
                  onClick={() => !songStarterDownloading && setSongStarterModal(null)}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="song-starter-modal-body">
              {songStarterLoading ? (
                <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  <Loader2 size={36} className="spin-animation" style={{ color: 'var(--accent-secondary, #06b6d4)', margin: '0 auto 16px auto' }} />
                  <div style={{ fontSize: '1.05rem', fontWeight: '700', color: 'var(--text-main)', marginBottom: '4px' }}>
                    Assembling In-Key Stem Pack...
                  </div>
                  <div style={{ fontSize: '0.85rem' }}>
                    Harmonically matching drum grooves, basslines, melodic progressions & vocal hooks
                  </div>
                </div>
              ) : songStarterData?.stems ? (
                <div className="song-starter-stems-grid">
                  {[
                    { key: 'drums', label: 'Drums / Beat', icon: Disc3, color: '#f59e0b' },
                    { key: 'bass', label: 'Bass / 808', icon: Music2, color: '#8b5cf6' },
                    { key: 'melody', label: 'Melody / Chords', icon: Layers, color: '#06b6d4' },
                    { key: 'vocals', label: 'Vocals / Chops', icon: Volume2, color: '#ec4899' },
                    { key: 'fx', label: 'FX / Drum Hits', icon: Sparkles, color: '#10b981' }
                  ].map(slot => {
                    const candidates = songStarterData?.stems?.[slot.key] || [];
                    const currentIdx = selectedStemIndices[slot.key] || 0;
                    const sound = candidates[currentIdx];
                    const Icon = slot.icon;
                    const isStemPlaying = currentSound && sound && currentSound.id === sound.id && isPlaying;

                    return (
                      <div key={slot.key} className="stem-slot-card">
                        <div className="stem-slot-header">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Icon size={16} style={{ color: slot.color }} />
                            <span style={{ fontSize: '0.75rem', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: slot.color }}>
                              {slot.label}
                            </span>
                          </div>

                          {candidates.length > 1 && (
                            <button 
                              className="stem-swap-btn"
                              onClick={() => handleShuffleStem(slot.key)}
                              title="Swap with next in-key candidate"
                            >
                              <RefreshCw size={12} />
                              <span>Swap ({currentIdx + 1}/{candidates.length})</span>
                            </button>
                          )}
                        </div>

                        {sound ? (
                          <div className="stem-sound-row">
                            <button 
                              className={`stem-play-btn ${isStemPlaying ? 'active' : ''}`}
                              onClick={(e) => handlePlayToggle(sound, e)}
                            >
                              {isStemPlaying ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
                            </button>
                            <div className="stem-sound-info">
                              <span className="stem-sound-name" title={sound.name}>{sound.name}</span>
                              <div className="stem-sound-meta">
                                <span>{sound.bpm || songStarterData.bpm} BPM</span>
                                <span>•</span>
                                <span>{sound.key || songStarterData.key}</span>
                                <span>•</span>
                                <span>{sound.duration}</span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', padding: '12px 0' }}>
                            No stem found in this category
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>

            {/* Modal Footer */}
            <div className="song-starter-modal-footer">
              <div>
                {songStarterDownloadedFolder && (
                  <button 
                    onClick={() => handleOpenPackFolder(songStarterDownloadedFolder)}
                    className="song-starter-open-btn"
                  >
                    <FolderOpen size={16} />
                    <span>Open Stem Pack Folder</span>
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button 
                  className="song-starter-cancel-btn"
                  disabled={songStarterDownloading}
                  onClick={() => setSongStarterModal(null)}
                >
                  Close
                </button>
                <button 
                  className="song-starter-download-btn"
                  disabled={songStarterLoading || songStarterDownloading}
                  onClick={handleDownloadSongStarter}
                >
                  {songStarterDownloading ? (
                    <>
                      <Loader2 size={16} className="spin-animation" />
                      <span>Downloading Stems...</span>
                    </>
                  ) : (
                    <>
                      <Download size={16} />
                      <span>DOWNLOAD SONG STARTER PACK</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Official License Certificate Modal */}
      {certificateModalSound && (
        <LicenseCertificateModal
          sound={certificateModalSound}
          user={user}
          subscription={subscription}
          onClose={() => setCertificateModalSound(null)}
          showToast={showToast}
        />
      )}

      {/* Pro Transient Slicer Modal */}
      {slicerSound && (
        <SampleSlicerModal
          sound={slicerSound}
          onClose={() => setSlicerSound(null)}
          showToast={showToast}
        />
      )}

      {/* Local AI Demucs Stem Separator Modal */}
      {stemModalSound && (
        <StemSeparatorModal
          sound={stemModalSound}
          onClose={() => setStemModalSound(null)}
          showToast={showToast}
        />
      )}
    </div>
  );
}
