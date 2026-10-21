import type { TmdbMovieReleaseResult } from '@server/api/themoviedb/interfaces';

export type UpcomingReleaseKind =
  | 'theatrical'
  | 'digital'
  | 'physical'
  | 'episode';

export interface UpcomingRelease {
  date: string;
  kind: UpcomingReleaseKind;
}

const isFutureDate = (value?: string | null): value is string => {
  if (!value) return false;
  const parsed = new Date(`${value.slice(0, 10)}T23:59:59`);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() >= Date.now();
};

export const getNextMovieRelease = (
  releases: TmdbMovieReleaseResult | undefined,
  region: string,
  fallbackReleaseDate?: string | null
): UpcomingRelease | undefined => {
  const regional =
    releases?.results.find((item) => item.iso_3166_1 === region)
      ?.release_dates ??
    releases?.results.find((item) => item.iso_3166_1 === 'US')
      ?.release_dates ??
    [];

  const milestones: { kind: UpcomingReleaseKind; types: number[] }[] = [
    { kind: 'theatrical', types: [2, 3] },
    { kind: 'digital', types: [4] },
    { kind: 'physical', types: [5] },
  ];

  for (const milestone of milestones) {
    const nextDate = regional
      .filter(
        (release) =>
          milestone.types.includes(release.type) &&
          isFutureDate(release.release_date)
      )
      .sort((left, right) =>
        left.release_date.localeCompare(right.release_date)
      )[0]?.release_date;

    if (nextDate) return { date: nextDate, kind: milestone.kind };
  }

  return isFutureDate(fallbackReleaseDate)
    ? { date: fallbackReleaseDate, kind: 'theatrical' }
    : undefined;
};

export const getNextTvRelease = (
  nextEpisodeDate?: string | null,
  firstAirDate?: string | null
): UpcomingRelease | undefined => {
  const date = isFutureDate(nextEpisodeDate)
    ? nextEpisodeDate
    : isFutureDate(firstAirDate)
      ? firstAirDate
      : undefined;

  return date ? { date, kind: 'episode' } : undefined;
};
