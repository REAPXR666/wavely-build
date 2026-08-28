import React, { useState, useMemo, useEffect } from 'react';
import { Printer, Copy, Check, ExternalLink, X, User, Mail, ShieldCheck } from 'lucide-react';

export default function LicenseCertificateModal({ 
  sound, 
  user, 
  subscription, 
  onClose, 
  showToast 
}) {
  const [copied, setCopied] = useState(false);

  // Full Name and Email State (Saved in LocalStorage for automatic reuse across all samples)
  const [fullName, setFullName] = useState(() => {
    return localStorage.getItem('wavely_licensee_fullname') || user?.fullName || user?.username || '';
  });

  const [email, setEmail] = useState(() => {
    return localStorage.getItem('wavely_licensee_email') || user?.email || '';
  });

  // Save changes to localStorage
  useEffect(() => {
    if (fullName) {
      localStorage.setItem('wavely_licensee_fullname', fullName);
    }
  }, [fullName]);

  useEffect(() => {
    if (email) {
      localStorage.setItem('wavely_licensee_email', email);
    }
  }, [email]);

  // Compute display licensee name: entered full name, or fallback to 'WAVELY'
  const displayName = useMemo(() => {
    return fullName.trim() ? fullName.trim() : 'WAVELY';
  }, [fullName]);

  // Format date, sample filename, and exact Splice sample URL
  const certData = useMemo(() => {
    if (!sound) return null;

    const dateObj = new Date();
    const formattedDate = dateObj.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const shortDate = dateObj.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });

    // Clean sample filename (e.g. BOS_GTC_128_Vocal_Adlib_Loop_OhWoah_Wet_A#m.wav)
    let sampleFilename = sound.name || 'sample_asset.wav';
    if (!sampleFilename.toLowerCase().endsWith('.wav') && !sampleFilename.toLowerCase().endsWith('.mp3')) {
      sampleFilename = `${sampleFilename.replace(/\s+/g, '_')}.wav`;
    }

    // Build exact Splice Sample URL: https://splice.com/sounds/sample/<uuid>/<slug>
    const uuid = sound.uuid || sound.id || '';
    const slug = (sound.name || 'sample')
      .toLowerCase()
      .replace(/\.wav$|\.mp3$/i, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    let sampleUrl = 'https://splice.com/sounds';
    if (uuid && slug) {
      sampleUrl = `https://splice.com/sounds/sample/${uuid}/${slug}`;
    } else if (uuid) {
      sampleUrl = `https://splice.com/sounds/sample/${uuid}`;
    } else {
      sampleUrl = `https://splice.com/sounds/search?q=${encodeURIComponent(sound.name || '')}`;
    }

    return {
      formattedDate,
      shortDate,
      sampleFilename,
      sampleUrl,
      termsUrl: 'https://splice.com/terms',
      copyrightEmail: 'copyright@splice.com'
    };
  }, [sound]);

  if (!certData) return null;

  const handleLinkClick = (url, e) => {
    if (e) e.preventDefault();
    if (window.electron?.openExternal) {
      window.electron.openExternal(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleCopyClearance = () => {
    const text = `Certificate of Content License

${certData.formattedDate}

To Whom It May Concern:

Wavely Technologies Inc. (“Wavely”) holds the legal rights necessary to license the content further described herein and has licensed such content to ${displayName} on a perpetual, royalty-free, non-exclusive basis.

The use of the following content in accordance with our Terms of Use (${certData.termsUrl}) by ${displayName} shall therefore not constitute a valid basis for a copyright infringement or de-monetization claim by a third party (including claims for master or publishing rights of the same).

The content licensed can be referenced from our platform:
• ${certData.sampleFilename} (${certData.sampleUrl}) (licensed ${certData.shortDate})

Please see our Terms of Use (${certData.termsUrl}) for more specific information pertaining to the parameters and permitted uses of this license, which includes, without limitation, the right to create new derivative works embodying the content in both audio and audiovisual formats, and to distribute such content via any method or manner now known or hereafter created which shall include, without limitation, any digital service providers that the above licensee may choose.

If further assistance is required in verifying the validity and scope of this license, please feel free to reach out to us directly at ${certData.copyrightEmail}.

Thank you,
The Wavely Team

Wavely Technologies, Inc.
817 Broadway, 4th Floor
New York, NY 10003`;

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (showToast) showToast('License clearance statement copied to clipboard!', 'success');
      setTimeout(() => setCopied(false), 3000);
    });
  };

  return (
    <div className="splice-cert-overlay" onClick={onClose}>
      <div className="splice-cert-modal-container" onClick={(e) => e.stopPropagation()}>
        
        {/* Top Control Bar & Licensee Prompt (Hidden in Print) */}
        <div className="splice-cert-toolbar no-print">
          
          {/* Header Row */}
          <div className="splice-cert-toolbar-top-row">
            <div className="splice-cert-toolbar-title">
              <ShieldCheck size={16} className="text-emerald" />
              <span>Certificate of Content License</span>
            </div>

            <div className="splice-cert-toolbar-actions">
              <button 
                className="splice-cert-btn"
                onClick={handleCopyClearance}
                title="Copy statement for YouTube Content ID dispute or digital distributors"
              >
                {copied ? <Check size={14} className="text-emerald" /> : <Copy size={14} />}
                <span>{copied ? 'Copied Statement!' : 'Copy Dispute Text'}</span>
              </button>

              <button 
                className="splice-cert-btn primary"
                onClick={handlePrint}
                title="Save as PDF or print high-resolution document"
              >
                <Printer size={14} />
                <span>Print / Save PDF</span>
              </button>

              <button 
                className="splice-cert-btn"
                onClick={(e) => handleLinkClick(certData.sampleUrl, e)}
                title="Open sample page on Splice"
              >
                <ExternalLink size={14} />
                <span>View Sample</span>
              </button>

              <button className="splice-cert-close" onClick={onClose} title="Close modal">
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Prompt Fields for Full Name & Email */}
          <div className="splice-cert-inputs-box">
            <div className="splice-cert-input-field">
              <label>
                <User size={13} />
                <span>Full Legal Name / Artist Name:</span>
              </label>
              <input 
                type="text" 
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Louis Woolford-Jones (or leave blank for 'WAVELY')"
                className="splice-cert-text-input"
              />
            </div>

            <div className="splice-cert-input-field">
              <label>
                <Mail size={13} />
                <span>Email Address:</span>
              </label>
              <input 
                type="email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. producer@example.com"
                className="splice-cert-text-input"
              />
            </div>
          </div>

        </div>

        {/* 1:1 Splice-Style Document Sheet */}
        <div className="splice-cert-sheet" id="printable-certificate">
          
          {/* Centered Top Brand Logo Mark */}
          <div className="splice-cert-logo-center">
            <svg width="44" height="44" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="22" y="18" width="22" height="38" rx="11" transform="rotate(-35 22 18)" fill="#000000" />
              <rect x="52" y="38" width="22" height="38" rx="11" transform="rotate(-35 52 38)" fill="#000000" />
            </svg>
          </div>

          {/* Certificate Title */}
          <h1 className="splice-cert-title">
            Certificate of Content License
          </h1>

          {/* Issue Date */}
          <div className="splice-cert-date">
            {certData.formattedDate}
          </div>

          {/* Formal Salutation */}
          <div className="splice-cert-salutation">
            To Whom It May Concern:
          </div>

          {/* Body Paragraph 1 */}
          <p className="splice-cert-paragraph">
            Wavely Technologies Inc. (“Wavely”) holds the legal rights necessary to license the content further described herein and has licensed such content to <strong>{displayName}</strong> on a perpetual, royalty-free, non-exclusive basis.
          </p>

          {/* Body Paragraph 2 - Link 1: Terms of Use */}
          <p className="splice-cert-paragraph">
            The use of the following content in accordance with our{' '}
            <a 
              href={certData.termsUrl} 
              onClick={(e) => handleLinkClick(certData.termsUrl, e)}
              target="_blank" 
              rel="noreferrer" 
              className="splice-cert-link"
            >
              Terms of Use
            </a>{' '}
            by <strong>{displayName}</strong> shall therefore not constitute a valid basis for a copyright infringement or de-monetization claim by a third party (including claims for master or publishing rights of the same).
          </p>

          {/* Body Paragraph 3 - Platform Reference */}
          <p className="splice-cert-paragraph" style={{ marginBottom: '8px' }}>
            The content licensed can be referenced from our platform:
          </p>

          {/* Bullet point sample line - Link 2: Sample URL */}
          <ul className="splice-cert-list">
            <li>
              <a 
                href={certData.sampleUrl} 
                onClick={(e) => handleLinkClick(certData.sampleUrl, e)}
                target="_blank" 
                rel="noreferrer" 
                className="splice-cert-link"
              >
                {certData.sampleFilename}
              </a>{' '}
              <span style={{ color: '#000000' }}>(licensed {certData.shortDate})</span>
            </li>
          </ul>

          {/* Body Paragraph 4 - Permitted Uses - Link 3: Terms of Use */}
          <p className="splice-cert-paragraph">
            Please see our{' '}
            <a 
              href={certData.termsUrl} 
              onClick={(e) => handleLinkClick(certData.termsUrl, e)}
              target="_blank" 
              rel="noreferrer" 
              className="splice-cert-link"
            >
              Terms of Use
            </a>{' '}
            for more specific information pertaining to the parameters and permitted uses of this license, which includes, without limitation, the right to create new derivative works embodying the content in both audio and audiovisual formats, and to distribute such content via any method or manner now known or hereafter created which shall include, without limitation, any digital service providers that the above licensee may choose.
          </p>

          {/* Body Paragraph 5 - Contact Clause - Link 4: Email */}
          <p className="splice-cert-paragraph">
            If further assistance is required in verifying the validity and scope of this license, please feel free to reach out to us directly at{' '}
            <a 
              href={`mailto:${certData.copyrightEmail}`}
              onClick={(e) => handleLinkClick(`mailto:${certData.copyrightEmail}`, e)}
              className="splice-cert-link"
            >
              {certData.copyrightEmail}
            </a>.
          </p>

          {/* Signature & Address Block */}
          <div className="splice-cert-signature-block">
            <p className="splice-cert-signoff-line">Thank you,</p>
            <p className="splice-cert-signoff-line" style={{ marginBottom: '20px' }}>The Wavely Team</p>

            <div className="splice-cert-company-address">
              <p>Wavely Technologies, Inc.</p>
              <p>817 Broadway, 4th Floor</p>
              <p>New York, NY 10003</p>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
