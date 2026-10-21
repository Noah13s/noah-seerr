import type { WatchHistorySummaryItem } from '@server/interfaces/api/watchHistoryInterfaces';
import { viewingKey } from './viewingProgress';

/** undefined leaves legacy/untracked media to Jellyfin; zero starts a fresh pass. */
export const viewingResumeTicks = (
  history: WatchHistorySummaryItem | undefined,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): number | undefined => {
  if (!history || history.mediaType !== mediaType) return undefined;
  if (mediaType === 'tv' && (season === undefined || episode === undefined))
    return undefined;
  const key = viewingKey(mediaType, season, episode);
  const run = history.viewingProgress?.[key];
  if (run) {
    if (run.completed) return 0;
    if (
      Number.isFinite(run.position) &&
      Number.isFinite(run.duration) &&
      run.position >= 15 &&
      run.duration > run.position &&
      run.position / run.duration < 0.9
    )
      return Math.round(run.position * 10000000);
    return 0;
  }
  const watched =
    mediaType === 'movie'
      ? history.status === 'completed' || history.watchCount > 0
      : (history.episodeOverrides?.[key] ??
        ((history.seasonProgress?.[String(season)] ?? 0) >= episode! ||
          (history.status === 'completed' &&
            !Object.keys(history.seasonProgress ?? {}).length)));
  return watched ? 0 : undefined;
};
