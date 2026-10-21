import type { WatchHistoryStatus } from '@server/entity/WatchHistory';

export interface ViewingRun {
  sessionIds: string[];
  retiredSessionIds: string[];
  position: number;
  duration: number;
  completed: boolean;
  rewatching: boolean;
  watchCount: number;
  updatedAt: string;
}

export type ViewingProgress = Record<string, ViewingRun>;

export interface WatchHistoryItem {
  id: number;
  mediaType: 'movie' | 'tv';
  tmdbId?: number | null;
  title: string;
  releaseYear?: number | null;
  status: WatchHistoryStatus;
  watchCount: number;
  watchedAt?: Date | null;
  watchedEpisodes?: number | null;
  totalEpisodes?: number | null;
  seasonProgress: Record<string, number>;
  episodeOverrides: Record<string, boolean>;
  viewingProgress?: ViewingProgress;
  categories?: string | null;
  rating?: number | null;
  priority?: number | null;
  series?: string | null;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WatchHistoryResponse {
  pageInfo: {
    pages: number;
    pageSize: number;
    results: number;
    page: number;
  };
  results: WatchHistoryItem[];
}

export interface WatchHistoryPublicRating {
  average: number | null;
  votes: number;
  releaseDate: string | null;
  nextAirDate: string | null;
  upcoming: boolean;
  isAnime: boolean;
}

export type WatchHistoryPublicRatingsResponse = Record<
  string,
  WatchHistoryPublicRating | null
>;

export interface WatchHistorySummaryItem {
  id: number;
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  releaseYear?: number | null;
  status: WatchHistoryStatus;
  watchCount: number;
  watchedAt?: Date | null;
  seasonProgress: Record<string, number>;
  episodeOverrides: Record<string, boolean>;
  viewingProgress?: ViewingProgress;
  rating?: number | null;
  categories?: string | null;
  priority?: number | null;
  series?: string | null;
  notes?: string | null;
}

export type WatchHistorySummaryResponse = Record<
  string,
  WatchHistorySummaryItem
>;
