import Slider from '@app/components/Slider';
import TitleCard from '@app/components/TitleCard';
import useJellyfinProgress from '@app/hooks/useJellyfinProgress';
import defineMessages from '@app/utils/defineMessages';
import type { WatchHistoryResponse } from '@server/interfaces/api/watchHistoryInterfaces';
import { latestActiveViewing } from '@server/lib/viewingProgress';
import Link from 'next/link';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.ContinueWatching', {
  title: 'Continue Watching',
});

type MediaDetails = {
  posterPath?: string;
  overview?: string;
  releaseDate?: string;
  firstAirDate?: string;
  voteAverage?: number;
  onUserWatchlist?: boolean;
  mediaInfo?: {
    status?: number;
    mediaUrl?: string;
  };
  seasons?: { seasonNumber: number }[];
};

type EpisodePlaybackResponse = {
  episodes: Record<number, string>;
  progress: Record<
    number,
    {
      positionTicks: number;
      runtimeTicks: number;
      percent: number;
      played: boolean;
      lastPlayedDate?: string;
    }
  >;
};

const latestEpisode = (
  seasonProgress: Record<string, number>
): { season: number; episode: number } | undefined =>
  Object.entries(seasonProgress ?? {})
    .map(([season, episode]) => ({ season: Number(season), episode }))
    .filter(({ season, episode }) => season > 0 && episode > 0)
    .sort((a, b) => b.season - a.season || b.episode - a.episode)[0];

const ContinueWatchingCard = ({
  entry,
}: {
  entry: WatchHistoryResponse['results'][number];
}) => {
  const { data } = useSWR<MediaDetails>(
    `/api/v1/${entry.mediaType}/${entry.tmdbId}`
  );
  const active = latestActiveViewing(entry.viewingProgress);
  const [activeSeason, activeEpisode] =
    active?.key.split(':').map(Number) ?? [];
  const episode =
    entry.mediaType === 'tv' && active
      ? { season: activeSeason, episode: activeEpisode }
      : latestEpisode(entry.seasonProgress);
  const { data: playback } = useSWR<EpisodePlaybackResponse>(
    entry.mediaType === 'tv' && episode
      ? `/api/v1/tv/${entry.tmdbId}/season/${episode.season}/playback`
      : null
  );
  const nextSeason =
    episode &&
    data?.seasons
      ?.map((season) => season.seasonNumber)
      .filter((number) => number > episode.season)
      .sort((a, b) => a - b)[0];
  const { data: nextSeasonPlayback } = useSWR<EpisodePlaybackResponse>(
    entry.mediaType === 'tv' && nextSeason
      ? `/api/v1/tv/${entry.tmdbId}/season/${nextSeason}/playback`
      : null
  );
  const watchedInHistory = (number: number) => {
    if (!episode) return false;
    const override = entry.episodeOverrides?.[`${episode.season}:${number}`];
    return (
      override ??
      number <= (entry.seasonProgress?.[String(episode.season)] ?? 0)
    );
  };
  const jellyfinEpisode = Object.entries(playback?.progress ?? {})
    .map(([episodeNumber, item]) => ({
      episode: Number(episodeNumber),
      ...item,
    }))
    .filter(
      (item) =>
        item.positionTicks > 0 &&
        item.percent > 0 &&
        !watchedInHistory(item.episode)
    )
    .sort((a, b) => {
      const dateDifference =
        new Date(b.lastPlayedDate ?? 0).getTime() -
        new Date(a.lastPlayedDate ?? 0).getTime();
      return dateDifference || b.episode - a.episode;
    })[0];
  const nextEpisode =
    episode && playback?.episodes[episode.episode + 1]
      ? episode.episode + 1
      : undefined;
  const hasNextSeason = Boolean(nextSeason && nextSeasonPlayback?.episodes[1]);
  const resumeEpisode =
    entry.mediaType === 'tv' && active && episode
      ? episode
      : entry.mediaType === 'tv' && episode
        ? {
            season:
              jellyfinEpisode || nextEpisode || !hasNextSeason
                ? episode.season
                : nextSeason!,
            episode: jellyfinEpisode?.episode ?? nextEpisode ?? episode.episode,
          }
        : undefined;
  if (
    !active &&
    resumeEpisode &&
    hasNextSeason &&
    !jellyfinEpisode &&
    !nextEpisode
  )
    resumeEpisode.episode = 1;
  const resumePlayback =
    resumeEpisode?.season === nextSeason ? nextSeasonPlayback : playback;
  const progressUrl =
    entry.mediaType === 'tv' && resumeEpisode
      ? resumePlayback?.episodes[resumeEpisode.episode]
      : data?.mediaInfo?.mediaUrl;
  const movieProgress = useJellyfinProgress(
    entry.mediaType === 'movie' && !active ? progressUrl : undefined
  );
  const percent = active
    ? Math.min(100, (active.run.position / active.run.duration) * 100)
    : entry.mediaType === 'tv'
      ? (jellyfinEpisode?.percent ?? 0)
      : movieProgress.percent;
  const hasProgress = active
    ? percent > 0 && percent < 95
    : entry.mediaType === 'tv'
      ? percent > 0 && percent < 95
      : movieProgress.hasProgress;
  const canContinue =
    entry.mediaType === 'tv'
      ? Boolean(
          resumeEpisode && resumePlayback?.episodes[resumeEpisode.episode]
        )
      : hasProgress;
  const actionLabel = hasProgress
    ? 'Resume'
    : nextEpisode || hasNextSeason
      ? 'Continue'
      : 'Replay';
  const episodeLabel =
    entry.mediaType === 'tv' && resumeEpisode
      ? `S${String(resumeEpisode.season).padStart(2, '0')} E${String(
          resumeEpisode.episode
        ).padStart(2, '0')}`
      : undefined;

  return (
    <TitleCard
      id={entry.tmdbId ?? 0}
      image={data?.posterPath}
      summary={data?.overview}
      title={entry.title}
      year={data?.releaseDate ?? data?.firstAirDate}
      userScore={data?.voteAverage}
      mediaType={entry.mediaType}
      status={data?.mediaInfo?.status}
      isAddedToWatchlist={data?.onUserWatchlist ?? false}
      actionProgress={hasProgress ? percent : undefined}
      action={
        canContinue ? (
          <Link
            href={
              entry.mediaType === 'tv' && resumeEpisode
                ? `/tv/${entry.tmdbId}?season=${resumeEpisode.season}&episode=${resumeEpisode.episode}`
                : `/${entry.mediaType}/${entry.tmdbId}`
            }
            className="flex min-h-8 w-full min-w-0 items-center justify-center overflow-hidden rounded-md bg-indigo-600 px-1.5 text-center text-xs font-semibold leading-tight text-white shadow-lg"
          >
            <span className="truncate">
              {actionLabel}
              {episodeLabel ? ` ${episodeLabel}` : ''}
              {entry.mediaType === 'movie' ? ` · ${Math.round(percent)}%` : ''}
            </span>
          </Link>
        ) : undefined
      }
    />
  );
};

const ContinueWatching = () => {
  const intl = useIntl();
  const { data } = useSWR<WatchHistoryResponse>(
    '/api/v1/watch-history?active=1&take=24'
  );
  const entries = data?.results ?? [];

  if (!entries.length) return null;

  return (
    <>
      <div className="slider-header">
        <div className="slider-title">
          <span>{intl.formatMessage(messages.title)}</span>
        </div>
      </div>
      <Slider
        sliderKey="continue-watching"
        isLoading={!data}
        isEmpty={false}
        items={entries.map((entry) => {
          return <ContinueWatchingCard key={entry.id} entry={entry} />;
        })}
      />
    </>
  );
};

export default ContinueWatching;
