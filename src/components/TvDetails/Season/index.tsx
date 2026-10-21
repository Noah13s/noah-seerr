import AirDateBadge from '@app/components/AirDateBadge';
import Badge from '@app/components/Common/Badge';
import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import type { PlayButtonLink } from '@app/components/Common/PlayButton';
import PlayButton from '@app/components/Common/PlayButton';
import defineMessages from '@app/utils/defineMessages';
import { CheckCircleIcon, PlayIcon } from '@heroicons/react/24/solid';
import type { WatchHistorySummaryResponse } from '@server/interfaces/api/watchHistoryInterfaces';
import type { SeasonWithEpisodes } from '@server/models/Tv';
import axios from 'axios';
import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.TvDetails.Season', {
  somethingwentwrong: 'Something went wrong while retrieving season data.',
  noepisodes: 'Episode list unavailable.',
  episodeAvailable: 'Available',
  episodePlay: 'Play',
  episodeWatched: 'Watched',
  episodeNotWatched: 'Not watched',
  markWatched: 'Mark watched',
  markNotWatched: 'Mark not watched',
  updateFailed: 'Could not update this episode. Please try again.',
  upNext: 'Up next',
  episodeNumber: 'S{seasonNumber} · E{episodeNumber}',
});

type SeasonProps = {
  seasonNumber: number;
  tvId: number;
  tvTitle: string;
  isAvailable?: boolean;
  focusedEpisode?: number;
};

type EpisodePlaybackResponse = {
  episodes: Record<number, string>;
};

const Season = ({
  seasonNumber,
  tvId,
  tvTitle,
  isAvailable = false,
  focusedEpisode,
}: SeasonProps) => {
  const intl = useIntl();
  const focusedEpisodeRef = useRef<HTMLElement>(null);
  const lastFocusedEpisode = useRef<number | null>(null);
  const [savingEpisode, setSavingEpisode] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const { data, error } = useSWR<SeasonWithEpisodes>(
    `/api/v1/tv/${tvId}/season/${seasonNumber}`
  );
  const { data: playback } = useSWR<EpisodePlaybackResponse>(
    isAvailable ? `/api/v1/tv/${tvId}/season/${seasonNumber}/playback` : null,
    { refreshInterval: 60000, revalidateOnFocus: true }
  );
  const { data: watchHistory, mutate: revalidateHistory } =
    useSWR<WatchHistorySummaryResponse>('/api/v1/watch-history/summary', {
      revalidateOnFocus: true,
    });
  const historyEntry = watchHistory?.[`tv:${tvId}`];

  useEffect(() => {
    if (
      !focusedEpisode ||
      !data?.episodes.some(
        (episode) => episode.episodeNumber === focusedEpisode
      ) ||
      lastFocusedEpisode.current === focusedEpisode
    )
      return;

    const timeout = window.setTimeout(() => {
      const element = focusedEpisodeRef.current;
      if (!element) return;
      lastFocusedEpisode.current = focusedEpisode;
      element.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth',
        block: 'center',
      });
      element.focus({ preventScroll: true });
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [data?.episodes, focusedEpisode]);

  const setEpisodeWatched = async (episodeNumber: number, watched: boolean) => {
    setSavingEpisode(episodeNumber);
    setUpdateError(null);
    try {
      await axios.put('/api/v1/watch-history/episode', {
        tmdbId: tvId,
        title: tvTitle,
        seasonNumber,
        episodeNumber,
        watched,
      });
      await revalidateHistory();
    } catch {
      setUpdateError(intl.formatMessage(messages.updateFailed));
    } finally {
      setSavingEpisode(null);
    }
  };

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  if (!data) {
    return <div>{intl.formatMessage(messages.somethingwentwrong)}</div>;
  }

  return (
    <div className="space-y-3 py-3">
      {data.episodes.length === 0 ? (
        <p>{intl.formatMessage(messages.noepisodes)}</p>
      ) : (
        data.episodes
          .slice()
          .reverse()
          .map((episode) => {
            const isFocused = focusedEpisode === episode.episodeNumber;
            const episodeUrl = playback?.episodes[episode.episodeNumber];
            const seasonWatchedCount =
              historyEntry?.seasonProgress?.[String(seasonNumber)];
            const episodeOverride =
              historyEntry?.episodeOverrides?.[
                `${seasonNumber}:${episode.episodeNumber}`
              ];
            const viewing =
              historyEntry?.viewingProgress?.[
                `${seasonNumber}:${episode.episodeNumber}`
              ];
            const watched =
              episodeOverride ??
              (seasonWatchedCount !== undefined
                ? episode.episodeNumber <= seasonWatchedCount
                : historyEntry?.status === 'completed' &&
                  !Object.keys(historyEntry.seasonProgress ?? {}).length);
            return (
              <article
                ref={isFocused ? focusedEpisodeRef : undefined}
                tabIndex={isFocused ? -1 : undefined}
                className={`scroll-mt-28 rounded-xl border p-3 transition-colors sm:p-4 ${
                  isFocused
                    ? 'border-indigo-400 bg-indigo-500/15 ring-2 ring-indigo-400/70'
                    : watched
                      ? 'border-green-500/30 bg-green-950/10 hover:border-green-500/50'
                      : 'border-gray-700 bg-gray-800/40 hover:border-gray-500 hover:bg-gray-800/60'
                }`}
                key={`season-${seasonNumber}-episode-${episode.episodeNumber}`}
              >
                <div className="flex flex-col gap-4 sm:flex-row">
                  {episode.stillPath && (
                    <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-lg bg-gray-900 sm:w-40 lg:w-44">
                      <CachedImage
                        type="tmdb"
                        className="object-cover"
                        src={episode.stillPath}
                        alt=""
                        fill
                      />
                    </div>
                  )}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                        {intl.formatMessage(messages.episodeNumber, {
                          seasonNumber,
                          episodeNumber: episode.episodeNumber,
                        })}
                      </span>
                      {isFocused && (
                        <span className="rounded-full bg-indigo-500 px-2 py-0.5 text-xs font-semibold text-white">
                          {intl.formatMessage(messages.upNext)}
                        </span>
                      )}
                      {watchHistory && (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${
                            watched
                              ? 'border-green-500/40 bg-green-500/15 text-green-200'
                              : 'border-gray-600 bg-gray-700/70 text-gray-300'
                          }`}
                        >
                          {watched && (
                            <CheckCircleIcon className="h-3.5 w-3.5" />
                          )}
                          {watched
                            ? intl.formatMessage(messages.episodeWatched)
                            : intl.formatMessage(messages.episodeNotWatched)}
                          {watched && (viewing?.watchCount ?? 0) > 1 && (
                            <span> · {viewing!.watchCount}×</span>
                          )}
                        </span>
                      )}
                      {viewing?.rewatching && !viewing.completed && (
                        <span className="rounded-full border border-violet-400/50 bg-violet-900/70 px-2 py-0.5 text-xs font-semibold text-violet-200">
                          {intl.locale.startsWith('fr')
                            ? 'Revisionnage'
                            : 'Rewatching'}
                        </span>
                      )}
                      {episodeUrl && (
                        <Badge badgeType="success">
                          {intl.formatMessage(messages.episodeAvailable)}
                        </Badge>
                      )}
                      {episode.airDate && (
                        <AirDateBadge airDate={episode.airDate} />
                      )}
                    </div>
                    <h3 className="mt-2 text-base font-semibold leading-snug text-white sm:text-lg">
                      {episode.name}
                    </h3>
                    {episode.overview && (
                      <p className="mt-2 text-sm leading-relaxed text-gray-300">
                        {episode.overview}
                      </p>
                    )}
                    {watchHistory && (
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        {episodeUrl && (
                          <PlayButton
                            prepareOnPage={
                              episode.episodeNumber ===
                              (focusedEpisode ||
                                (historyEntry?.seasonProgress?.[
                                  String(seasonNumber)
                                ] || 0) + 1)
                            }
                            links={
                              [
                                {
                                  text: intl.formatMessage(
                                    messages.episodePlay
                                  ),
                                  url: episodeUrl,
                                  svg: <PlayIcon />,
                                  watchProgress: {
                                    tmdbId: tvId,
                                    mediaType: 'tv',
                                    title: tvTitle,
                                    seasonNumber,
                                    episodeNumber: episode.episodeNumber,
                                  },
                                },
                              ] as PlayButtonLink[]
                            }
                          />
                        )}
                        <button
                          type="button"
                          disabled={savingEpisode === episode.episodeNumber}
                          onClick={() =>
                            void setEpisodeWatched(
                              episode.episodeNumber,
                              !watched
                            )
                          }
                          className="inline-flex min-h-10 items-center justify-center rounded-md border border-gray-600 px-3 py-2 text-sm font-medium text-gray-200 transition hover:border-gray-400 hover:bg-gray-700 disabled:opacity-50"
                        >
                          {intl.formatMessage(
                            watched
                              ? messages.markNotWatched
                              : messages.markWatched
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            );
          })
      )}
      {updateError && (
        <p role="alert" className="text-sm text-red-300">
          {updateError}
        </p>
      )}
    </div>
  );
};

export default Season;
