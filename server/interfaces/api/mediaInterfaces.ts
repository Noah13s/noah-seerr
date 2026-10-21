import type Media from '@server/entity/Media';
import type { User } from '@server/entity/User';
import type { PaginatedResponse } from './common';

export interface MediaResultsResponse extends PaginatedResponse {
  results: Media[];
}

export interface MediaWatchDataResponse {
  data?: {
    users: User[];
    playCount: number;
    playCount7Days: number;
    playCount30Days: number;
  };
  data4k?: {
    users: User[];
    playCount: number;
    playCount7Days: number;
    playCount30Days: number;
  };
}

export interface MediaTechnicalResponse {
  fileCount: number;
  qualities: { resolution: number | null; count: number }[];
  audio: { en: number; fr: number; unknown: number };
  subtitles: { en: number; fr: number };
}
