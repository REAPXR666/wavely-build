import React, { useState, useEffect } from 'react';
import { Download, CheckCircle2, X, XCircle, ChevronDown, ChevronUp, Layers, Loader2 } from 'lucide-react';

export default function DownloadStatusIndicator() {
  const [activeDownloads, setActiveDownloads] = useState({});
  const [isExpanded, setIsExpanded] = useState(true);

  useEffect(() => {
    if (!window.electron?.onPackDownloadProgress) return;

    const cleanup = window.electron.onPackDownloadProgress((data) => {
      const key = data.packUuid || data.packName || 'pack';
      setActiveDownloads(prev => {
        const next = { ...prev };
        if (data.percent >= 100) {
          // Mark as complete and schedule removal
          next[key] = { ...data, status: 'completed' };
          setTimeout(() => {
            setActiveDownloads(curr => {
              const updated = { ...curr };
              delete updated[key];
              return updated;
            });
          }, 5000);
        } else {
          next[key] = { ...data, status: 'downloading' };
        }
        return next;
      });
    });

    // Also fetch any existing active downloads on mount
    if (window.electron.getActiveDownloads) {
      window.electron.getActiveDownloads().then(list => {
        if (Array.isArray(list) && list.length > 0) {
          const map = {};
          list.forEach(item => {
            const key = item.packUuid || item.packName;
            map[key] = item;
          });
          setActiveDownloads(map);
        }
      }).catch(() => {});
    }

    return () => {
      if (typeof cleanup === 'function') cleanup();
    };
  }, []);

  const downloadList = Object.values(activeDownloads);
  if (downloadList.length === 0) return null;

  const activeCount = downloadList.filter(d => d.status === 'downloading').length;

  const handleCancelPack = (packUuid, e) => {
    e.stopPropagation();
    if (window.electron?.cancelPackDownload) {
      window.electron.cancelPackDownload(packUuid);
    }
    setActiveDownloads(prev => {
      const next = { ...prev };
      delete next[packUuid];
      return next;
    });
  };

  const handleCancelAll = (e) => {
    e.stopPropagation();
    if (window.electron?.cancelPackDownload) {
      window.electron.cancelPackDownload();
    }
    setActiveDownloads({});
  };

  return (
    <div className="global-download-status-card">
      {/* Card Header */}
      <div 
        className="download-status-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="download-pulse-icon-wrap">
            {activeCount > 0 ? (
              <Loader2 size={15} className="spin-animation" style={{ color: '#06b6d4' }} />
            ) : (
              <CheckCircle2 size={15} style={{ color: '#10b981' }} />
            )}
          </div>
          <span style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--text-main)' }}>
            {activeCount > 0 
              ? `Downloading ${activeCount} Sample Pack${activeCount > 1 ? 's' : ''}` 
              : 'Pack Downloads Complete'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {activeCount > 1 && (
            <button 
              type="button" 
              className="download-cancel-all-btn"
              onClick={handleCancelAll}
              title="Cancel all active downloads"
            >
              Cancel All
            </button>
          )}
          <button 
            type="button" 
            className="download-expand-toggle-btn"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
          >
            {isExpanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        </div>
      </div>

      {/* Expandable Downloads List */}
      {isExpanded && (
        <div className="download-status-items-container">
          {downloadList.map((item, idx) => {
            const isDone = item.status === 'completed' || item.percent >= 100;
            return (
              <div key={item.packUuid || item.packName || idx} className="download-status-item-row">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', maxWidth: '75%' }}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '4px', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {item.coverArtUrl ? (
                        <img src={item.coverArtUrl} alt="Art" style={{ width: '100%', height: '100%', borderRadius: '4px', objectFit: 'cover' }} />
                      ) : (
                        <Layers size={14} style={{ color: 'var(--accent-color)' }} />
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                      <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.packName || 'Sample Pack'}
                      </span>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {isDone ? '✓ All files saved to disk' : (item.sampleName || 'Downloading samples...')}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: isDone ? '#10b981' : 'var(--accent-secondary)' }}>
                      {isDone ? '100%' : `${item.percent || 0}%`}
                    </span>
                    {!isDone && (
                      <button 
                        type="button" 
                        className="download-item-cancel-btn"
                        onClick={(e) => handleCancelPack(item.packUuid, e)}
                        title="Cancel this download"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="download-item-progress-track">
                  <div 
                    className={`download-item-progress-fill ${isDone ? 'completed' : ''}`}
                    style={{ width: `${item.percent || 0}%` }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  <span>{item.current || 0} / {item.total || 0} items</span>
                  <span>{isDone ? 'Ready in Library' : 'Categorizing into subfolders...'}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
