import type {
  WatchHistorySummaryItem,
  WatchHistorySummaryResponse,
} from '@server/interfaces/api/watchHistoryInterfaces';
import useSWR from 'swr';

export const WATCH_HISTORY_SUMMARY_KEY = '/api/v1/watch-history/summary';

const useWatchHistoryStatus = (
  tmdbId?: number,
  mediaType?: 'movie' | 'tv'
): WatchHistorySummaryItem | undefined => {
  const { data } = useSWR<WatchHistorySummaryResponse>(
    WATCH_HISTORY_SUMMARY_KEY
  );

  if (!tmdbId || !mediaType) return undefined;
  return data?.[`${mediaType}:${tmdbId}`];
};

export default useWatchHistoryStatus;
