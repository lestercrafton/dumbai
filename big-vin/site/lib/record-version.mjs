/** Which formula version's record the board header shows.
 * Each version keeps its own record and they are never pooled. The header
 * follows the newest version, but a just-activated version has no graded
 * games yet; until its first finals land, the header keeps showing the
 * newest version that does have graded results, so a mid-season weight
 * update never blanks the season record. */
export function chooseRecordVersion(candidates) {
  if (!Array.isArray(candidates) || !candidates.length) return null;
  return candidates.find((c) => (c?.graded ?? 0) > 0)
    ?? candidates.find((c) => (c?.recorded ?? 0) > 0)
    ?? candidates[0];
}

/** The API may fall back to baseline for a retired version. Never attribute
 * that response to the requested formula or pool it with another version. */
export function matchesRecordResponse(result, sport, version) {
  return result?.sport === sport && result?.cohort === 'live'
    && result?.version === version && Array.isArray(result?.days);
}

/** A current-season header must not resurrect a previous season's graded
 * record when choosing a formula version. Missing seasonal data is not all-time.
 * @param {any} result
 * @param {number|null} [season]
 */
export function recordVersionCounts(result, season = null) {
  const summary = season === null ? result?.overall
    : result?.seasonRecord?.season === season ? result.seasonRecord.overall : null;
  return {graded:summary?.graded??0,recorded:summary?.recorded??0};
}
