/**
 * Wavely Harmonic Theory & Camelot Wheel Compatibility Engine
 * Computes musically matching keys, relative major/minor, dominant, subdominant,
 * and parallel keys for sample blending and mashups.
 */

export const KEY_DATA = {
  // Minor Keys (Camelot A)
  'Abm': { name: 'Ab Minor', alt: ['G#m', 'G# Minor', 'Abm'], camelot: '1A', relative: 'B', dominant: 'Ebm', subdominant: 'Dbm', parallel: 'Ab' },
  'G#m': { name: 'G# Minor', alt: ['Abm', 'G#m', 'G# Minor'], camelot: '1A', relative: 'B', dominant: 'D#m', subdominant: 'C#m', parallel: 'G#' },
  'Ebm': { name: 'Eb Minor', alt: ['D#m', 'D# Minor', 'Ebm'], camelot: '2A', relative: 'F#', dominant: 'Bbm', subdominant: 'Abm', parallel: 'Eb' },
  'D#m': { name: 'D# Minor', alt: ['Ebm', 'D#m', 'D# Minor'], camelot: '2A', relative: 'F#', dominant: 'A#m', subdominant: 'G#m', parallel: 'D#' },
  'Bbm': { name: 'Bb Minor', alt: ['A#m', 'A# Minor', 'Bbm'], camelot: '3A', relative: 'Db', dominant: 'Fm', subdominant: 'Ebm', parallel: 'Bb' },
  'A#m': { name: 'A# Minor', alt: ['Bbm', 'A#m', 'A# Minor'], camelot: '3A', relative: 'Db', dominant: 'Fm', subdominant: 'D#m', parallel: 'A#' },
  'Fm':  { name: 'F Minor',  alt: ['Fm', 'F Minor'], camelot: '4A', relative: 'Ab', dominant: 'Cm', subdominant: 'Bbm', parallel: 'F' },
  'Cm':  { name: 'C Minor',  alt: ['Cm', 'C Minor'], camelot: '5A', relative: 'Eb', dominant: 'Gm', subdominant: 'Fm', parallel: 'C' },
  'Gm':  { name: 'G Minor',  alt: ['Gm', 'G Minor'], camelot: '6A', relative: 'Bb', dominant: 'Dm', subdominant: 'Cm', parallel: 'G' },
  'Dm':  { name: 'D Minor',  alt: ['Dm', 'D Minor'], camelot: '7A', relative: 'F', dominant: 'Am', subdominant: 'Gm', parallel: 'D' },
  'Am':  { name: 'A Minor',  alt: ['Am', 'A Minor'], camelot: '8A', relative: 'C', dominant: 'Em', subdominant: 'Dm', parallel: 'A' },
  'Em':  { name: 'E Minor',  alt: ['Em', 'E Minor'], camelot: '9A', relative: 'G', dominant: 'Bm', subdominant: 'Am', parallel: 'E' },
  'Bm':  { name: 'B Minor',  alt: ['Bm', 'B Minor'], camelot: '10A', relative: 'D', dominant: 'F#m', subdominant: 'Em', parallel: 'B' },
  'F#m': { name: 'F# Minor', alt: ['Gbm', 'Gb Minor', 'F#m'], camelot: '11A', relative: 'A', dominant: 'C#m', subdominant: 'Bm', parallel: 'F#' },
  'C#m': { name: 'C# Minor', alt: ['Dbm', 'Db Minor', 'C#m'], camelot: '12A', relative: 'E', dominant: 'G#m', subdominant: 'F#m', parallel: 'C#' },

  // Major Keys (Camelot B)
  'B':   { name: 'B Major',  alt: ['B', 'B Major', 'Cb'], camelot: '1B', relative: 'Abm', dominant: 'F#', subdominant: 'E', parallel: 'Bm' },
  'F#':  { name: 'F# Major', alt: ['F#', 'F# Major', 'Gb'], camelot: '2B', relative: 'Ebm', dominant: 'C#', subdominant: 'B', parallel: 'F#m' },
  'Gb':  { name: 'Gb Major', alt: ['Gb', 'Gb Major', 'F#'], camelot: '2B', relative: 'Ebm', dominant: 'Db', subdominant: 'B', parallel: 'Gbm' },
  'Db':  { name: 'Db Major', alt: ['Db', 'Db Major', 'C#'], camelot: '3B', relative: 'Bbm', dominant: 'Ab', subdominant: 'Gb', parallel: 'Dbm' },
  'C#':  { name: 'C# Major', alt: ['C#', 'C# Major', 'Db'], camelot: '3B', relative: 'A#m', dominant: 'G#', subdominant: 'F#', parallel: 'C#m' },
  'Ab':  { name: 'Ab Major', alt: ['Ab', 'Ab Major', 'G#'], camelot: '4B', relative: 'Fm', dominant: 'Eb', subdominant: 'Db', parallel: 'Abm' },
  'Eb':  { name: 'Eb Major', alt: ['Eb', 'Eb Major', 'D#'], camelot: '5B', relative: 'Cm', dominant: 'Bb', subdominant: 'Ab', parallel: 'Ebm' },
  'Bb':  { name: 'Bb Major', alt: ['Bb', 'Bb Major', 'A#'], camelot: '6B', relative: 'Gm', dominant: 'F', subdominant: 'Eb', parallel: 'Bbm' },
  'F':   { name: 'F Major',  alt: ['F', 'F Major'], camelot: '7B', relative: 'Dm', dominant: 'C', subdominant: 'Bb', parallel: 'Fm' },
  'C':   { name: 'C Major',  alt: ['C', 'C Major'], camelot: '8B', relative: 'Am', dominant: 'G', subdominant: 'F', parallel: 'Cm' },
  'G':   { name: 'G Major',  alt: ['G', 'G Major'], camelot: '9B', relative: 'Em', dominant: 'D', subdominant: 'C', parallel: 'Gm' },
  'D':   { name: 'D Major',  alt: ['D', 'D Major'], camelot: '10B', relative: 'Bm', dominant: 'A', subdominant: 'G', parallel: 'Dm' },
  'A':   { name: 'A Major',  alt: ['A', 'A Major'], camelot: '11B', relative: 'F#m', dominant: 'E', subdominant: 'D', parallel: 'Am' },
  'E':   { name: 'E Major',  alt: ['E', 'E Major'], camelot: '12B', relative: 'C#m', dominant: 'B', subdominant: 'A', parallel: 'Em' }
};

/**
 * Normalizes any key string into standard lookup token (e.g., "F# min" -> "F#m", "D Major" -> "D")
 */
export function normalizeKey(keyStr) {
  if (!keyStr) return null;
  let clean = keyStr.trim().replace(/\s+/g, '');
  
  // Format minor: e.g. "Cmin", "Cminor", "c#m"
  if (/min|minor/i.test(clean) || (clean.endsWith('m') && !clean.endsWith('dim'))) {
    clean = clean.replace(/minor|min/i, '').replace(/m$/, '') + 'm';
    clean = clean.charAt(0).toUpperCase() + clean.slice(1);
    return clean;
  }
  
  // Format major
  clean = clean.replace(/major|maj/i, '');
  clean = clean.charAt(0).toUpperCase() + clean.slice(1);
  return clean;
}

/**
 * Returns harmonic matches for a given key string:
 * - Same Key
 * - Relative Major / Minor (Same Camelot number)
 * - Subdominant (-1 Camelot step)
 * - Dominant (+1 Camelot step)
 * - Parallel
 */
export function getHarmonicMatches(keyStr) {
  const norm = normalizeKey(keyStr);
  if (!norm || !KEY_DATA[norm]) return null;

  const current = KEY_DATA[norm];
  const matches = [
    { type: 'Exact Key', key: norm, camelot: current.camelot, desc: 'Exact pitch and scale match' },
    { type: 'Relative Key', key: current.relative, camelot: KEY_DATA[current.relative]?.camelot || '', desc: 'Shares identical scale notes' },
    { type: 'Subdominant (4th)', key: current.subdominant, camelot: KEY_DATA[current.subdominant]?.camelot || '', desc: 'Harmonic resolution & warmth' },
    { type: 'Dominant (5th)', key: current.dominant, camelot: KEY_DATA[current.dominant]?.camelot || '', desc: 'Energy lift and tension' },
    { type: 'Parallel Key', key: current.parallel, camelot: KEY_DATA[current.parallel]?.camelot || '', desc: 'Mood shift (Major ↔ Minor)' }
  ].filter(m => m.key && KEY_DATA[m.key]);

  return {
    rootKey: norm,
    rootData: current,
    matches
  };
}
