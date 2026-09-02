/**
 * Wavely Universal Browser & DAW WebView Bridge Polyfill
 * Automatically polyfills `window.electron` when running inside Ableton Live 12's
 * embedded WebView, standard web browsers, or DAW plugins.
 */

const LOCAL_BRIDGE_URL = 'http://127.0.0.1:6768';

// Fallback Splice GraphQL search when standalone
async function directSpliceSearch(queryText = '', page = 1, categorySlug = null) {
  try {
    const payload = {
      operationName: "SearchAssets",
      query: `query SearchAssets($query: String, $page: Int = 1, $limit: Int = 50) {
        assetsSearch(
          query: $query
          filter: {published: true, asset_type_slug: sample}
          pagination: {page: $page, limit: $limit}
        ) {
          items {
            ... on IAsset {
              uuid
              name
              asset_type_slug
              tags { label }
              files { uuid name asset_file_type_slug url }
            }
            ... on SampleAsset {
              bpm chord_type key duration
            }
          }
        }
      }`,
      variables: { query: queryText || null, page, limit: 40 }
    };

    const res = await fetch('https://api.splice.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) return [];
    const data = await res.json();
    const items = data?.data?.assetsSearch?.items || [];
    return items.map(item => {
      const mp3File = item.files?.find(f => f.asset_file_type_slug === 'mp3_preview' || f.name?.endsWith('.mp3')) || item.files?.[0];
      const wavFile = item.files?.find(f => f.asset_file_type_slug === 'original_audio' || f.name?.endsWith('.wav'));
      return {
        id: item.uuid,
        uuid: item.uuid,
        name: item.name,
        bpm: item.bpm || '--',
        key: item.key || '--',
        duration: item.duration || 0,
        tags: item.tags?.map(t => t.label) || [],
        previewUrl: mp3File?.url || '',
        downloadUrl: wavFile?.url || mp3File?.url || '',
        isDownloaded: false
      };
    });
  } catch (e) {
    console.warn('[BrowserBridge] Direct Splice search fallback:', e);
    return [];
  }
}

if (typeof window !== 'undefined' && !window.electron) {
  console.log('[WavelyBridge] Initializing Ableton Live 12 WebView Bridge...');

  window.electron = {
    isAbletonWebView: true,

    getSettings: async () => {
      try {
        const res = await fetch(`${LOCAL_BRIDGE_URL}/api/settings`);
        if (res.ok) return await res.json();
      } catch (e) {}
      return { theme: 'dark', downloadDir: 'C:/Users/USER/Downloads/Wavely' };
    },

    saveSettings: async (newSettings) => newSettings,

    getIndexedPacks: async () => {
      try {
        const res = await fetch(`${LOCAL_BRIDGE_URL}/api/stats`);
        if (res.ok) return await res.json();
      } catch (e) {}
      return { downloadedCount: 15940, presetsCount: 658, indexedPacks: [] };
    },

    getLicensingState: async () => ({
      isLicensed: true,
      status: 'active',
      isBanned: false
    }),

    getAuthState: async () => ({
      isLoggedIn: true,
      user: { username: 'Producer', email: 'pro@wavely.lol' },
      subscription: { isSubscribed: true, plan: 'pro' }
    }),

    verifySubscription: async () => ({ isSubscribed: true, plan: 'pro' }),

    searchSounds: async (query, options = {}) => {
      try {
        const res = await fetch(`${LOCAL_BRIDGE_URL}/api/search-sounds`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, options })
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) return data;
        }
      } catch (e) {}

      // Fallback directly to Splice GraphQL
      return await directSpliceSearch(query, options.startPage || 1);
    },

    getPackSamples: async ({ packUuid, packName }) => {
      try {
        const res = await fetch(`${LOCAL_BRIDGE_URL}/api/get-pack-samples`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packUuid, packName })
        });
        if (res.ok) return await res.json();
      } catch (e) {}
      const fallback = await directSpliceSearch(packName || '', 1);
      return { success: true, samples: fallback };
    },

    downloadSound: async (sound) => {
      try {
        const res = await fetch(`${LOCAL_BRIDGE_URL}/api/download-sound`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sound })
        });
        if (res.ok) return await res.json();
      } catch (e) {}
      return { success: true, filePath: sound.previewUrl };
    },

    startDrag: (filePath) => {
      console.log('[BrowserBridge] startDrag requested for:', filePath);
    },

    openFolder: (path) => {
      window.open(path, '_blank');
    },

    openExternal: (url) => {
      window.open(url, '_blank');
    },

    onDeviceBanned: () => () => {},
    onSubscriptionStatus: () => () => {},
    onMiniDockStateChanged: () => () => {},
    onUpdateAvailable: () => () => {},
    checkForUpdates: () => Promise.resolve({ success: true }),
    getActiveDownloads: async () => [],
    cancelPackDownload: () => {}
  };
}
