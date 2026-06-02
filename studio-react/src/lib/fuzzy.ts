/**
 * Tiny subsequence fuzzy matcher for the command palette. Returns a score
 * (higher = better) or null when the query isn't a subsequence of the target.
 * Rewards consecutive matches, word-boundary hits, and earlier matches — enough
 * to order a short command list well without pulling in a dependency.
 */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = target.toLowerCase();
  let score = 0;
  let qi = 0;
  let prevMatch = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      let bonus = 1;
      if (ti === prevMatch + 1) bonus += 3; // consecutive run
      if (ti === 0 || /[\s._-]/.test(t[ti - 1])) bonus += 2; // word boundary
      score += bonus;
      prevMatch = ti;
      qi++;
    }
  }
  if (qi < q.length) return null; // not all query chars matched in order
  score -= prevMatch * 0.05; // slight preference for earlier full matches
  return score;
}
