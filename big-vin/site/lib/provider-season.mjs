/** Season identity comes only from existing league metadata, never calendar rules. */
export function providerSeasonYear(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1900 && value <= 2200 ? value : null;
}
const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
export function providerSeasonContext(payload, {observedAt = null, sourceUrl = null} = {}) {
  const league = payload?.leagues?.[0]?.season, board = payload?.season;
  const leagueYear = providerSeasonYear(league?.year), boardYear = providerSeasonYear(board?.year);
  if (leagueYear !== null && boardYear !== null && leagueYear !== boardYear) return null;
  const meta = leagueYear !== null ? league : boardYear !== null ? board : null;
  if (!meta) return null;
  return {year:meta.year,label:typeof meta.displayName === 'string' && meta.displayName.trim() ? meta.displayName.trim() : String(meta.year),
    startDate:instant(meta.startDate),endDate:instant(meta.endDate),observedAt,sourceUrl};
}
/** Explicit provider intervals establish current season across calendar years. */
export function activeProviderSeason(context, now = Date.now()) {
  const year = providerSeasonYear(context?.year), start = Date.parse(context?.startDate), end = Date.parse(context?.endDate);
  return year !== null && Number.isFinite(now) && Number.isFinite(start) && Number.isFinite(end)
    && start <= end && now >= start && now <= end ? year : null;
}
/** A multi-day fallback must not select conflicting season IDs by source order. */
export function mergeSeasonContexts(boards) {
  const contexts = boards.map(board => board?.seasonContext).filter(Boolean);
  if (!contexts.length || new Set(contexts.map(context=>context.year)).size !== 1) return null;
  return contexts.sort((a,b)=>(Date.parse(b.observedAt)||0)-(Date.parse(a.observedAt)||0))[0];
}
