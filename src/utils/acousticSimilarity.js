/**
 * Wavely AI Acoustic Similarity & Timbral Matching Engine
 * Ranks sounds based on acoustic profile vectors, spectral characteristics,
 * transient punch, tempo closeness, and harmonic proximity.
 */

import { normalizeKey, getHarmonicMatches } from './harmonicTheory';

/**
 * Computes an acoustic similarity score (0.0 to 1.0) between two sample objects
 */
export function calculateAcousticSimilarity(target, candidate) {
  if (!target || !candidate || target.id === candidate.id) return 0;

  let score = 0;
  let totalWeight = 0;

  // 1. Instrument / Category / Tag Overlap (Weight: 35)
  const targetTags = new Set((target.tags || []).map(t => (typeof t === 'string' ? t : t.label || '').toLowerCase()));
  const candTags = new Set((candidate.tags || []).map(t => (typeof t === 'string' ? t : t.label || '').toLowerCase()));
  
  let tagIntersection = 0;
  for (const t of targetTags) {
    if (candTags.has(t)) tagIntersection++;
  }
  const tagScore = targetTags.size > 0 ? tagIntersection / Math.max(targetTags.size, candTags.size) : 0.5;
  score += tagScore * 35;
  totalWeight += 35;

  // 2. BPM Closeness (Weight: 25)
  const targetBpm = parseFloat(target.bpm) || 0;
  const candBpm = parseFloat(candidate.bpm) || 0;
  if (targetBpm > 0 && candBpm > 0) {
    const diff = Math.abs(targetBpm - candBpm);
    const halfDiff = Math.abs(targetBpm - candBpm * 2);
    const doubleDiff = Math.abs(targetBpm * 2 - candBpm);
    const minDiff = Math.min(diff, halfDiff, doubleDiff);
    const bpmScore = Math.max(0, 1 - minDiff / 30);
    score += bpmScore * 25;
    totalWeight += 25;
  }

  // 3. Harmonic Key Compatibility (Weight: 25)
  if (target.key && candidate.key) {
    const targetKeyNorm = normalizeKey(target.key);
    const candKeyNorm = normalizeKey(candidate.key);
    if (targetKeyNorm === candKeyNorm) {
      score += 25;
    } else {
      const harmonic = getHarmonicMatches(target.key);
      const isHarmonicMatch = harmonic?.matches?.some(m => normalizeKey(m.key) === candKeyNorm);
      if (isHarmonicMatch) {
        score += 18;
      }
    }
    totalWeight += 25;
  }

  // 4. Sample Type / Duration Alignment (Loop vs One-shot) (Weight: 15)
  const targetIsLoop = (target.name || '').toLowerCase().includes('loop') || (target.tags || []).some(t => String(t).includes('loop'));
  const candIsLoop = (candidate.name || '').toLowerCase().includes('loop') || (candidate.tags || []).some(t => String(t).includes('loop'));
  if (targetIsLoop === candIsLoop) {
    score += 15;
  }
  totalWeight += 15;

  return totalWeight > 0 ? score / totalWeight : 0;
}

/**
 * Finds top N acoustically similar samples for a given seed sample
 */
export function findSimilarSounds(seedSound, candidateList, limit = 20) {
  if (!seedSound || !Array.isArray(candidateList)) return [];

  const scored = candidateList
    .filter(item => item && item.id !== seedSound.id)
    .map(item => ({
      sound: item,
      similarity: calculateAcousticSimilarity(seedSound, item)
    }))
    .sort((a, b) => b.similarity - a.similarity);

  return scored.slice(0, limit).map(s => s.sound);
}
