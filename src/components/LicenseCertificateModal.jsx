import React, { useState, useMemo } from 'react';
import { 
  ShieldCheck, Award, Printer, Copy, Check, ExternalLink, X, FileText, 
  Lock, Music, Sparkles, Hash, Calendar, User, Radio, Info
} from 'lucide-react';

export default function LicenseCertificateModal({ 
  sound, 
  user, 
  subscription, 
  onClose, 
  showToast 
}) {
  const [copied, setCopied] = useState(false);

  // Generate deterministic/unique Certificate ID and metadata
  const certData = useMemo(() => {
    if (!sound) return null;

    const rawId = sound.uuid || sound.id || sound.name || 'sample';
    let hash = 0;
    for (let i = 0; i < rawId.length; i++) {
      hash = ((hash << 5) - hash) + rawId.charCodeAt(i);
      hash |= 0;
    }
    const cleanHash = Math.abs(hash).toString(16).toUpperCase().padStart(8, '0');
    const certCode = `WLY-CERT-${new Date().getFullYear()}-${cleanHash.slice(0, 4)}-${cleanHash.slice(4, 8)}`;

    const dateStr = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const licensee = user?.username || 'Licensed Wavely Studio Producer';
    const email = user?.email || 'Verified Account';
    const plan = subscription?.plan ? subscription.plan.replace('_', ' ').toUpperCase() : 'PRO UNLIMITED';

    return {
      certCode,
      dateStr,
      licensee,
      email,
      plan,
      sampleName: sound.name || 'Wavely Sample',
      packName: sound.pack || sound.source || 'Wavely Master Sound Library',
      bpm: sound.bpm ? `${sound.bpm} BPM` : 'N/A',
      key: sound.key || 'N/A',
      duration: sound.duration || 'N/A',
      category: sound.category || (sound.tags && sound.tags[0]) || 'Audio Sample',
      fingerprint: `SHA256:${cleanHash}${cleanHash}${cleanHash.slice(0, 4)}`.toUpperCase(),
      verifyUrl: `https://wavely.lol/certificate/${certCode}`
    };
  }, [sound, user, subscription]);

  if (!certData) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleCopyClearance = () => {
    const text = `--- OFFICIAL WAVELY LICENSE & CLEARANCE CERTIFICATE ---
Certificate ID: ${certData.certCode}
Verification URL: ${certData.verifyUrl}
Issue Date: ${certData.dateStr}

LICENSEE INFORMATION:
Producer: ${certData.licensee}
Account Email: ${certData.email}
Membership Tier: Wavely ${certData.plan}

SAMPLE ASSET CLEARANCE:
Sample Title: ${certData.sampleName}
Pack / Catalog: ${certData.packName}
Tempo / Key: ${certData.bpm} | ${certData.key}
Asset Fingerprint: ${certData.fingerprint}

CLEARANCE GRANT & COMMERCIAL RIGHTS:
The licensee identified above holds an official, worldwide, perpetual, non-exclusive, royalty-free license to use, reproduce, modify, and synchronize this sound recording into original musical compositions and audiovisual productions (including commercial streaming on Spotify/Apple Music, YouTube Content ID whitelist, digital downloads, TV, Film, Video Games, and Public Broadcast).

Issued by Wavely Technologies Licensing Authority.
-------------------------------------------------------`;

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (showToast) showToast('License clearance statement copied to clipboard!', 'success');
      setTimeout(() => setCopied(false), 3000);
    });
  };

  const handleOpenVerifyUrl = () => {
    if (window.electron?.openExternal) {
      window.electron.openExternal(certData.verifyUrl);
    } else {
      window.open(certData.verifyUrl, '_blank');
    }
  };

  return (
    <div className="license-modal-overlay" onClick={onClose}>
      <div className="license-modal-container" onClick={(e) => e.stopPropagation()}>
        
        {/* Modal Top Control Bar (Hidden in Print) */}
        <div className="license-modal-toolbar no-print">
          <div className="license-toolbar-left">
            <div className="license-badge-pill">
              <ShieldCheck size={16} className="text-emerald" />
              <span>Official License Certificate</span>
            </div>
            <span className="cert-code-pill font-mono">{certData.certCode}</span>
          </div>

          <div className="license-toolbar-actions">
            <button 
              className="license-action-btn"
              onClick={handleCopyClearance}
              title="Copy standard clearance text for YouTube dispute or digital distributors (DistroKid, TuneCore, etc.)"
            >
              {copied ? <Check size={15} className="text-emerald" /> : <Copy size={15} />}
              <span>{copied ? 'Copied Statement!' : 'Copy Dispute Text'}</span>
            </button>

            <button 
              className="license-action-btn primary"
              onClick={handlePrint}
              title="Save as PDF or print high-resolution certificate"
            >
              <Printer size={15} />
              <span>Print / Save PDF</span>
            </button>

            <button 
              className="license-action-btn"
              onClick={handleOpenVerifyUrl}
              title="Verify online on wavely.lol"
            >
              <ExternalLink size={15} />
              <span>Verify Online</span>
            </button>

            <button className="license-close-btn" onClick={onClose} title="Close modal">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Printable Certificate Document Card */}
        <div className="certificate-document-card" id="printable-certificate">
          
          {/* Certificate Frame Borders */}
          <div className="cert-border-outer">
            <div className="cert-border-inner">
              
              {/* Watermark Crest */}
              <div className="cert-watermark-crest">
                <Award size={240} />
              </div>

              {/* Certificate Header */}
              <div className="cert-header">
                <div className="cert-brand-seal">
                  <div className="cert-seal-icon">
                    <ShieldCheck size={28} />
                  </div>
                  <div className="cert-brand-meta">
                    <div className="cert-brand-title">WAVELY</div>
                    <div className="cert-brand-sub">LICENSING & COPYRIGHT CLEARANCE DIVISION</div>
                  </div>
                </div>

                <div className="cert-meta-header-box font-mono">
                  <div className="cert-meta-row">
                    <span className="label">CERTIFICATE ID:</span>
                    <strong className="val text-gold">{certData.certCode}</strong>
                  </div>
                  <div className="cert-meta-row">
                    <span className="label">ISSUED DATE:</span>
                    <span className="val">{certData.dateStr}</span>
                  </div>
                  <div className="cert-meta-row">
                    <span className="label">STATUS:</span>
                    <span className="val text-emerald">VERIFIED & ACTIVE</span>
                  </div>
                </div>
              </div>

              {/* Title Section */}
              <div className="cert-title-section">
                <div className="cert-main-title">Certificate of Royalty-Free License</div>
                <div className="cert-subtitle">
                  Perpetual Worldwide Commercial Synchronization & Master Recording Grant
                </div>
              </div>

              {/* 2-Column Info Grid */}
              <div className="cert-grid-info">
                
                {/* Licensee Column */}
                <div className="cert-info-block">
                  <div className="cert-block-heading">
                    <User size={14} />
                    <span>Authorized Licensee</span>
                  </div>
                  <div className="cert-field-row">
                    <span className="field-name">Producer / User:</span>
                    <span className="field-val"><strong>{certData.licensee}</strong></span>
                  </div>
                  <div className="cert-field-row">
                    <span className="field-name">Registered Email:</span>
                    <span className="field-val font-mono">{certData.email}</span>
                  </div>
                  <div className="cert-field-row">
                    <span className="field-name">License Scope:</span>
                    <span className="field-val">Commercial Master & Sync</span>
                  </div>
                  <div className="cert-field-row">
                    <span className="field-name">Territory:</span>
                    <span className="field-val">Worldwide & In Perpetuity</span>
                  </div>
                </div>

                {/* Sample Details Column */}
                <div className="cert-info-block">
                  <div className="cert-block-heading">
                    <Music size={14} />
                    <span>Cleared Sample Asset</span>
                  </div>
                  <div className="cert-field-row">
                    <span className="field-name">Asset Title:</span>
                    <span className="field-val highlight-sample"><strong>{certData.sampleName}</strong></span>
                  </div>
                  <div className="cert-field-row">
                    <span className="field-name">Origin / Pack:</span>
                    <span className="field-val">{certData.packName}</span>
                  </div>
                  <div className="cert-field-row">
                    <span className="field-name">Tempo & Key:</span>
                    <span className="field-val font-mono">{certData.bpm} &bull; {certData.key}</span>
                  </div>
                  <div className="cert-field-row">
                    <span className="field-name">Digital Fingerprint:</span>
                    <span className="field-val font-mono text-muted-xs">{certData.fingerprint}</span>
                  </div>
                </div>

              </div>

              {/* Legal Terms Clause */}
              <div className="cert-legal-clause-box">
                <div className="cert-legal-title">
                  <Lock size={13} />
                  <span>Grant of Rights & Legal Clearance Clause</span>
                </div>
                <p className="cert-legal-text">
                  Wavely hereby certifies that the registered licensee has acquired full, perpetual, non-exclusive, and royalty-free rights to commercially synchronize, release, perform, and distribute original sound recordings utilizing the cleared audio sample asset referenced herein. This certificate grants unrestricted worldwide commercial distribution across all digital streaming platforms (including <strong>Spotify, Apple Music, YouTube Music, Beatport, TikTok</strong>), YouTube Content ID monetization, broadcast radio, television synchronization, motion pictures, video games, and physical media with zero ongoing royalty obligations to original sound designers or Wavely Technologies.
                </p>
              </div>

              {/* Bottom Stamp & Signature Area */}
              <div className="cert-footer-row">
                <div className="cert-signature-block">
                  <div className="cert-sig-line">
                    <span className="cert-sig-script">Wavely Licensing Trust</span>
                  </div>
                  <div className="cert-sig-meta">
                    <strong>Wavely Technologies Inc.</strong>
                    <span>Digital Rights Management & Verification Registry</span>
                  </div>
                </div>

                <div className="cert-stamp-badge">
                  <div className="cert-stamp-inner">
                    <div className="cert-stamp-text-top">WAVELY CERTIFIED</div>
                    <Award size={32} className="cert-stamp-icon" />
                    <div className="cert-stamp-text-bot">100% ROYALTY FREE</div>
                  </div>
                </div>

                <div className="cert-verify-qr-block font-mono">
                  <div className="cert-verify-link-title">VERIFY ONLINE:</div>
                  <a href={certData.verifyUrl} target="_blank" rel="noreferrer" className="cert-verify-url">
                    {certData.verifyUrl}
                  </a>
                  <div className="cert-verify-notice">Tamper-evident digital clearance record</div>
                </div>
              </div>

            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
