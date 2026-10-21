import ButtonWithDropdown from '@app/components/Common/ButtonWithDropdown';
import CastButton from '@app/components/Common/CastButton';
import PartyButton from '@app/components/Party/PartyButton';
import { useCasting } from '@app/context/CastingContext';
import useJellyfinProgress from '@app/hooks/useJellyfinProgress';
import { useUser } from '@app/hooks/useUser';
import useWatchHistoryStatus from '@app/hooks/useWatchHistoryStatus';
import defineMessages from '@app/utils/defineMessages';
import {
  installJellyfinSession,
  isJellyfinUrl,
  prepareSession,
  type JellyfinSession,
} from '@app/utils/jellyfinSession';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { StarIcon } from '@heroicons/react/24/solid';
import type { WatchHistoryItem } from '@server/interfaces/api/watchHistoryInterfaces';
import { viewingResumeTicks } from '@server/lib/viewingResume';
import axios from 'axios';
import { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useIntl } from 'react-intl';
import { mutate } from 'swr';
import OfflineButton from './OfflineButton';

const messages = defineMessages('components.PlayButton', {
  relinkRequired:
    'Your Jellyfin account must be linked once in Profile > Linked accounts.',
  playerUnavailable:
    'The player cannot be prepared right now. Please try again shortly.',
  connecting: 'Connecting to player…',
  backToSeerr: 'Back to Seerr',
  starting: 'Starting playback…',
  optimizing: 'Optimizing playback for your device…',
  resume: 'Resume',
  progress: '{percent}% watched',
  rateTitle: 'Rate {title}',
  rateDescription: 'You watched most of this title. How would you rate it?',
  rateSkip: 'Maybe later',
  rateFailed: 'Could not save your rating. Please try again.',
});

interface PlayButtonProps {
  links: PlayButtonLink[];
  prepareOnPage?: boolean;
}

export interface PlayButtonLink {
  text: string;
  url: string;
  svg: React.ReactNode;
  watchProgress?: WatchProgressContext;
  resumeTicks?: number;
}

export interface WatchProgressContext {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  releaseYear?: number;
  seasonNumber?: number;
  episodeNumber?: number;
}

const youtubeEmbedUrl = (url: string): string => {
  try {
    const parsed = new URL(url, window.location.origin);
    let videoId: string | null = null;
    if (parsed.hostname.endsWith('youtu.be')) {
      videoId = parsed.pathname.slice(1).split('/')[0];
    } else if (parsed.hostname.includes('youtube.com')) {
      videoId = parsed.searchParams.get('v');
      if (!videoId && parsed.pathname.startsWith('/embed/')) {
        videoId = parsed.pathname.split('/')[2];
      }
    }
    if (videoId) {
      return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(
        videoId
      )}?autoplay=1&rel=0`;
    }
  } catch {
    // L'URL Jellyfin peut être relative ; elle est valide telle quelle.
  }
  return url;
};

const playerUrl = (
  link: PlayButtonLink,
  compatible: boolean,
  recovery: { itemId: string; position: number } | null,
  prepare = false
) => {
  if (!isJellyfinUrl(link.url)) return youtubeEmbedUrl(link.url);
  const url = new URL(link.url, window.location.origin);
  url.searchParams.set('seerrAutoplay', '1');
  url.searchParams.set('seerrPlayer', '77-2');
  if (link.resumeTicks !== undefined)
    url.searchParams.set('seerrResumeTicks', String(link.resumeTicks));
  if (prepare) url.searchParams.set('seerrPrepare', '1');
  if (compatible) url.searchParams.set('seerrCompatibility', '1');
  if (compatible && recovery) {
    url.searchParams.set(
      'seerrResumeTicks',
      String(Math.round(recovery.position * 10000000))
    );
    const query = new URLSearchParams(url.hash.split('?')[1] || '');
    query.set('id', recovery.itemId);
    url.hash = `#!/details?${query.toString()}`;
  }
  return url.toString();
};

let pagePreparationOwner: object | null = null;

const PlayButton = ({ links, prepareOnPage = false }: PlayButtonProps) => {
  const intl = useIntl();
  const { isCasting } = useCasting();
  const { user } = useUser();
  const context = links[0]?.watchProgress;
  const history = useWatchHistoryStatus(context?.tmdbId, context?.mediaType);
  const resumeFor = (link: PlayButtonLink) => {
    const c = link.watchProgress;
    return c && c.tmdbId === history?.tmdbId
      ? viewingResumeTicks(
          history,
          c.mediaType,
          c.seasonNumber,
          c.episodeNumber
        )
      : undefined;
  };
  const historyResume = links[0] ? resumeFor(links[0]) : undefined;

  const [activeLink, setActiveLink] = useState<PlayButtonLink | null>(null);
  // A click can arrive while the shared authentication promise is pending.
  // It must win over the background preparation callback in that same turn.
  const playbackIntent = useRef<string | null>(null);
  const warmSession = () => {
    if (user && links.some((link) => isJellyfinUrl(link.url)))
      void prepareSession(user.id).catch(() => undefined);
  };
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const preparationOwner = useRef({});
  const [preparedLink, setPreparedLink] = useState<PlayButtonLink | null>(null);
  const [preparationGeneration, setPreparationGeneration] = useState(0);
  useEffect(() => {
    if (isCasting) {
      if (!activeLink) setPreparedLink(null);
      return;
    }
    const link = links[0];
    if (
      activeLink ||
      !prepareOnPage ||
      !user?.id ||
      !link ||
      !isJellyfinUrl(link.url) ||
      document.hidden
    )
      return;
    if (
      pagePreparationOwner &&
      pagePreparationOwner !== preparationOwner.current
    )
      return;
    const owner = preparationOwner.current;
    pagePreparationOwner = owner;
    let cancelled = false;
    const timer = setTimeout(() => {
      void prepareSession(user.id)
        .then((session) => {
          if (cancelled || playbackIntent.current) return;
          installJellyfinSession(link, session);
          const id = new URLSearchParams(
            new URL(link.url, window.location.origin).hash.split('?')[1] || ''
          ).get('id');
          // This bounded server-side operation reads 4 KiB of the selected file
          // and initializes NVENC once; it never starts a media transcode.
          if (id)
            void axios
              .post('/api/v1/auth/jellyfin-warm', { itemId: id })
              .catch(() => undefined);
          setPreparedLink({ ...link, resumeTicks: historyResume });
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (pagePreparationOwner === owner) pagePreparationOwner = null;
    };
  }, [
    isCasting,
    prepareOnPage,
    user?.id,
    links[0]?.url,
    activeLink?.url,
    historyResume,
    preparationGeneration,
  ]);
  const jellyfinProgress = useJellyfinProgress(links?.[0]?.url);
  const resumePercent =
    historyResume !== undefined
      ? historyResume > 0 && context
        ? ((history?.viewingProgress?.[
            context.mediaType === 'movie'
              ? 'movie'
              : `${context.seasonNumber}:${context.episodeNumber}`
          ]?.position ?? 0) /
            (history?.viewingProgress?.[
              context.mediaType === 'movie'
                ? 'movie'
                : `${context.seasonNumber}:${context.episodeNumber}`
            ]?.duration || 1)) *
          100
        : 0
      : jellyfinProgress.percent;
  const hasResume =
    historyResume !== undefined
      ? historyResume > 0
      : jellyfinProgress.hasProgress;
  const [isOpening, setIsOpening] = useState(false);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [compatiblePlayback, setCompatiblePlayback] = useState(false);
  const [playerGeneration, setPlayerGeneration] = useState(0);
  const [recoveryPosition, setRecoveryPosition] = useState<{
    itemId: string;
    position: number;
  } | null>(null);
  const playbackPosition = useRef<{ itemId: string; position: number } | null>(
    null
  );
  const [playError, setPlayError] = useState<string | null>(null);
  const stopAutoStart = useRef<(() => void) | null>(null);
  const stopJellyfinNavigation = useRef<(() => void) | null>(null);
  const lastProgressSignature = useRef<string | null>(null);
  const viewingSessions = useRef<Record<string, string>>({});
  const resolvedWatchContext = useRef<WatchProgressContext | null>(null);
  const lastRatingPromptKey = useRef<string | null>(null);
  const [ratingPrompt, setRatingPrompt] = useState<{
    entry: WatchHistoryItem;
    title: string;
  } | null>(null);
  const [ratingSaving, setRatingSaving] = useState(false);
  const [ratingError, setRatingError] = useState(false);

  const saveRating = async (rating: number) => {
    if (!ratingPrompt) return;
    setRatingSaving(true);
    setRatingError(false);
    try {
      await axios.patch(
        `/api/v1/watch-history/${ratingPrompt.entry.id}/rating`,
        { rating }
      );
      await mutate('/api/v1/watch-history/summary');
      setRatingPrompt(null);
    } catch {
      setRatingError(true);
    } finally {
      setRatingSaving(false);
    }
  };

  const closePlayer = () => {
    playbackIntent.current = null;
    const progressContext = activeLink?.watchProgress;
    // Flush while the native timeline is still mounted, before iframe teardown.
    stopAutoStart.current?.();
    stopAutoStart.current = null;
    setActiveLink(null);
    setPreparedLink(null);
    setPreparationGeneration((value) => value + 1);
    setTimeout(() => {
      void jellyfinProgress.refresh();
      if (progressContext?.mediaType === 'tv' && progressContext.seasonNumber) {
        void mutate(
          `/api/v1/tv/${progressContext.tmdbId}/season/${progressContext.seasonNumber}/playback`
        );
      }
    }, 1500);
  };

  const recordProgress = async (
    position: number,
    duration: number,
    force = false
  ) => {
    const context = resolvedWatchContext.current ?? activeLink?.watchProgress;
    if (
      !context ||
      !user?.id ||
      position < 15 ||
      !Number.isFinite(position) ||
      !Number.isFinite(duration) ||
      duration <= 0
    )
      return;
    if (
      context.mediaType === 'tv' &&
      (context.seasonNumber === undefined || !context.episodeNumber)
    )
      return;

    const complete = duration > 0 && position / duration >= 0.9;
    const signature = `${context.tmdbId}:${context.mediaType}:${context.seasonNumber ?? 0}:${context.episodeNumber ?? 0}:${Math.floor(position / 20)}:${complete}`;
    if (!force && signature === lastProgressSignature.current) return;
    lastProgressSignature.current = signature;

    try {
      const key =
        context.mediaType === 'movie'
          ? 'movie'
          : `${context.seasonNumber}:${context.episodeNumber}`;
      const storageKey = `seerr-viewing:${user.id}:${context.mediaType}:${context.tmdbId}:${key}`;
      // Each explicit Play starts a fresh transport session. The server merges
      // unfinished viewing runs across reloads/devices; a stopped replay can
      // therefore be started again without stale browser storage suppressing it.
      const sessionId = (viewingSessions.current[storageKey] ||=
        crypto.randomUUID());
      const saved = await axios.post<WatchHistoryItem>(
        '/api/v1/watch-history/playback',
        {
          ...context,
          sessionId,
          position,
          duration,
        }
      );
      await mutate('/api/v1/watch-history?active=1&take=24');
      await mutate('/api/v1/watch-history?status=watching&take=24');
      await mutate('/api/v1/watch-history/summary');
      const promptKey = `${context.mediaType}:${context.tmdbId}`;
      if (
        complete &&
        !saved.data.rating &&
        lastRatingPromptKey.current !== promptKey
      ) {
        lastRatingPromptKey.current = promptKey;
        setRatingPrompt({ entry: saved.data, title: context.title });
      }
    } catch {
      // Playback must continue even if personal tracking is temporarily unavailable.
      lastProgressSignature.current = null;
    }
  };

  useEffect(() => {
    if (!activeLink) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePlayer();
    };
    document.addEventListener('keydown', closeOnEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (
      preparedLink &&
      frameRef.current?.contentDocument?.readyState === 'complete'
    ) {
      startJellyfinPlayback(frameRef.current);
    }
    return () => {
      stopAutoStart.current?.();
      stopAutoStart.current = null;
      stopJellyfinNavigation.current?.();
      stopJellyfinNavigation.current = null;
      document.removeEventListener('keydown', closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [activeLink]);

  if (!links || !links.length) return null;

  const open = async (requestedLink: PlayButtonLink) => {
    const link = { ...requestedLink, resumeTicks: resumeFor(requestedLink) };
    setPlayError(null);
    setCompatiblePlayback(false);
    setRecoveryPosition(null);
    playbackPosition.current = null;
    lastProgressSignature.current = null;
    viewingSessions.current = {};
    resolvedWatchContext.current = link.watchProgress ?? null;

    if (!isJellyfinUrl(link.url)) {
      setActiveLink(link);
      return;
    }

    playbackIntent.current = link.url;

    const nativeStart = (
      frameRef.current?.contentWindow as
        | (Window & {
            __seerrStartPrepared?: (ticks?: number) => Promise<void>;
          })
        | null
    )?.__seerrStartPrepared;
    if (preparedLink?.url === link.url) {
      setIsPlayerReady(false);
      setActiveLink(link);
      // Retain an iframe that is still booting. Its readiness handshake below
      // consumes the Play intent as soon as native preparation completes.
      if (nativeStart)
        void nativeStart(link.resumeTicks).catch(() => recoverPlayback());
      return;
    }
    setPreparedLink(null);

    setIsOpening(true);
    try {
      const data = user
        ? await prepareSession(user.id)
        : (await axios.get<JellyfinSession>('/api/v1/auth/jellyfin-session'))
            .data;
      installJellyfinSession(link, data);
      setIsPlayerReady(false);
      setActiveLink(link);
    } catch (error) {
      playbackIntent.current = null;
      const needsRelink =
        axios.isAxiosError(error) && error.response?.status === 409;
      setPlayError(
        needsRelink
          ? intl.formatMessage(messages.relinkRequired)
          : intl.formatMessage(messages.playerUnavailable)
      );
    } finally {
      setIsOpening(false);
    }
  };

  const recoverPlayback = () => {
    setPreparedLink(null);
    setRecoveryPosition(playbackPosition.current);
    setIsPlayerReady(false);
    setCompatiblePlayback(true);
    setPlayerGeneration((generation) => generation + 1);
  };

  const startJellyfinPlayback = (frame: HTMLIFrameElement) => {
    if (!activeLink || !isJellyfinUrl(activeLink.url)) {
      setIsPlayerReady(true);
      return;
    }

    stopAutoStart.current?.();
    stopJellyfinNavigation.current?.();
    stopJellyfinNavigation.current = null;

    const frameWindow = frame.contentWindow;
    const frameDocument = frame.contentDocument;
    if (!frameWindow || !frameDocument) {
      setActiveLink(null);
      setPlayError(intl.formatMessage(messages.playerUnavailable));
      return;
    }

    let playbackStarted = false;
    let trackingInstalled = false;
    let episodeLookupStarted = false;
    let observer: MutationObserver | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let stopTracking: (() => void) | null = null;
    let attemptedVideo: HTMLVideoElement | null = null;
    let attemptedSource = '';
    let requiresGesture = false;
    let stopped = false;

    const playbackFailed = () => {
      cleanup();
      setActiveLink(null);
      setPlayError(intl.formatMessage(messages.playerUnavailable));
    };

    const onPlaybackMessage = (event: MessageEvent) => {
      if (
        event.source !== frameWindow ||
        event.origin !== window.location.origin
      )
        return;
      const data = event.data;
      if (data?.type === 'seerr-player-prepared') {
        const targetId = new URLSearchParams(
          new URL(activeLink.url, window.location.origin).hash.split('?')[1] ||
            ''
        ).get('id');
        if (data.itemId === targetId) attemptStart();
        return;
      }
      if (
        !data ||
        !['seerr-playback-position', 'seerr-playback-stalled'].includes(
          data.type
        ) ||
        !/^[a-f0-9]{32}$/i.test(data.itemId) ||
        !Number.isFinite(data.position) ||
        data.position < 0 ||
        data.position > 86400
      )
        return;
      playbackPosition.current = {
        itemId: data.itemId,
        position: data.position,
      };
      if (data.type !== 'seerr-playback-stalled') return;
      if (!compatiblePlayback) {
        recoverPlayback();
      } else {
        // Bound recovery: a persistent failure returns to the media's Play action.
        playbackFailed();
      }
    };
    window.addEventListener('message', onPlaybackMessage);

    const cleanup = () => {
      observer?.disconnect();
      if (interval) clearInterval(interval);
      if (timeout) clearTimeout(timeout);
      frameDocument.removeEventListener('loadeddata', attemptStart, true);
      frameDocument.removeEventListener('playing', attemptStart, true);
      frameWindow.removeEventListener('hashchange', attemptStart);
    };

    const isVideoRoute = () =>
      /(?:#!?\/|#\/)video(?:\?|$)/.test(frameWindow.location.hash);

    const revealPlayableVideo = () => {
      if (stopped) return false;
      const video = frameDocument.querySelector<HTMLVideoElement>('video');
      if (
        !isVideoRoute() ||
        !video ||
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        !video.videoWidth
      ) {
        return false;
      }
      // Show the actual player only after playback starts. If browser autoplay
      // policy requires a gesture, its normal Play control is the only action.
      if (video.paused && !requiresGesture) return false;
      cleanup();
      setIsPlayerReady(true);
      return true;
    };

    const resolveCurrentEpisode = async () => {
      const context = activeLink?.watchProgress;
      if (
        context?.mediaType !== 'tv' ||
        (context.seasonNumber && context.episodeNumber)
      )
        return;
      const query = frameWindow.location.hash.split('?')[1];
      const itemId = query
        ? (new URLSearchParams(query).get('id') ??
          new URLSearchParams(query).get('itemId'))
        : null;
      if (!itemId) return;
      try {
        const { data } = await axios.get<{
          seasonNumber: number;
          episodeNumber: number;
        }>(
          `/api/v1/tv/${context.tmdbId}/playback-item/${encodeURIComponent(itemId)}`
        );
        resolvedWatchContext.current = { ...context, ...data };
      } catch {
        // Playback continues; the series-level history remains available.
      }
    };

    const protectSeerrNavigation = () => {
      if (stopJellyfinNavigation.current) return;

      let reachedPlayer = false;
      let interval: ReturnType<typeof setInterval> | null = null;

      const returnToSeerr = () => {
        // Hide the embedded document before Jellyfin gets a chance to paint
        // its library/details route. This avoids the distracting flash users
        // would see after pressing Jellyfin's own back button.
        frameDocument.documentElement.style.visibility = 'hidden';
        stopJellyfinNavigation.current?.();
        stopJellyfinNavigation.current = null;
        closePlayer();
      };

      const watchNavigation = () => {
        if (isVideoRoute()) {
          reachedPlayer = true;
          return;
        }

        if (!reachedPlayer) return;

        returnToSeerr();
      };

      // Jellyfin uses hash routes. Listening to the route change lets us
      // close the embedded player in the same turn as its own back action,
      // rather than after a polling delay.
      const onNavigation = () => watchNavigation();
      frameWindow.addEventListener('hashchange', onNavigation);
      frameWindow.addEventListener('popstate', onNavigation);
      interval = setInterval(watchNavigation, 200);
      stopJellyfinNavigation.current = () => {
        frameWindow.removeEventListener('hashchange', onNavigation);
        frameWindow.removeEventListener('popstate', onNavigation);
        if (interval) clearInterval(interval);
      };
      watchNavigation();
    };

    const attemptStart = () => {
      if (isVideoRoute()) {
        if (!episodeLookupStarted) {
          episodeLookupStarted = true;
          void resolveCurrentEpisode();
        }
        protectSeerrNavigation();
        if (!trackingInstalled) {
          trackingInstalled = true;
          const installTracking = () => {
            const video =
              frameDocument.querySelector<HTMLVideoElement>('video');
            if (!video) return false;
            const report = (force = false) => {
              const snapshot = (
                frameWindow as Window & {
                  __seerrPlaybackSnapshot?: () => {
                    position: number;
                    duration: number;
                    seasonNumber?: number;
                    episodeNumber?: number;
                  } | null;
                }
              ).__seerrPlaybackSnapshot;
              if (snapshot) {
                const state = snapshot();
                if (state) {
                  const context = activeLink.watchProgress;
                  if (
                    context?.mediaType === 'tv' &&
                    Number.isInteger(state.seasonNumber) &&
                    Number.isInteger(state.episodeNumber)
                  )
                    resolvedWatchContext.current = {
                      ...context,
                      seasonNumber: state.seasonNumber,
                      episodeNumber: state.episodeNumber,
                    };
                  void recordProgress(state.position, state.duration, force);
                }
              } else {
                void recordProgress(video.currentTime, video.duration, force);
              }
            };
            const onTimeUpdate = () => report();
            const onEnded = () => report(true);
            video.addEventListener('timeupdate', onTimeUpdate);
            video.addEventListener('ended', onEnded);
            video.addEventListener('pause', onEnded);
            video.addEventListener('seeked', onEnded);
            const progressInterval = setInterval(() => report(), 20_000);
            stopTracking = () => {
              clearInterval(progressInterval);
              video.removeEventListener('timeupdate', onTimeUpdate);
              video.removeEventListener('ended', onEnded);
              video.removeEventListener('pause', onEnded);
              video.removeEventListener('seeked', onEnded);
              report(true);
            };
            return true;
          };
          if (!installTracking()) {
            const installInterval = setInterval(() => {
              if (installTracking()) clearInterval(installInterval);
            }, 500);
            setTimeout(() => clearInterval(installInterval), 15_000);
          }
        }
        const video = frameDocument.querySelector<HTMLVideoElement>('video');
        if (
          video?.currentSrc &&
          (video !== attemptedVideo || video.currentSrc !== attemptedSource)
        ) {
          attemptedVideo = video;
          attemptedSource = video.currentSrc;
          if (video.paused) {
            void video
              .play()
              .then(revealPlayableVideo)
              .catch((error: unknown) => {
                if (
                  error &&
                  typeof error === 'object' &&
                  'name' in error &&
                  error.name === 'NotAllowedError'
                ) {
                  requiresGesture = true;
                  revealPlayableVideo();
                }
              });
          }
        }
        revealPlayableVideo();
        return;
      }

      if (playbackStarted) return;
      const nativeStart = frameWindow as Window & {
        __seerrInstantStart?: string;
        __seerrStartPrepared?: (ticks?: number) => Promise<void>;
      };
      if (
        nativeStart.__seerrInstantStart === 'prepared' &&
        nativeStart.__seerrStartPrepared
      ) {
        playbackStarted = true;
        void nativeStart
          .__seerrStartPrepared(activeLink.resumeTicks)
          .catch(() => recoverPlayback());
        return;
      }
      if (
        nativeStart.__seerrInstantStart &&
        nativeStart.__seerrInstantStart !== 'fallback'
      )
        return;

      const selectors = [
        '.btnPlayOrResume:not([disabled])',
        '.detailPagePrimaryContainer .btnPlay:not(.hide):not([disabled])',
        '.detailButton[data-action="resume"]:not(.hide):not([disabled])',
        '.detailButton[data-action="play"]:not(.hide):not([disabled])',
      ];

      const playButton = selectors
        .map((selector) =>
          frameDocument.querySelector<HTMLButtonElement>(selector)
        )
        .find((button) => button && button.getClientRects().length > 0);

      if (playButton) {
        playbackStarted = true;
        playButton.click();
      }
    };

    frameDocument.addEventListener('loadeddata', attemptStart, true);
    frameDocument.addEventListener('playing', attemptStart, true);
    frameWindow.addEventListener('hashchange', attemptStart);
    observer = new MutationObserver(attemptStart);
    observer.observe(frameDocument.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    interval = setInterval(attemptStart, 200);
    timeout = setTimeout(
      () => {
        cleanup();
        if (!compatiblePlayback) {
          recoverPlayback();
          return;
        }
        playbackFailed();
      },
      compatiblePlayback ? 45000 : 30000
    );
    stopAutoStart.current = () => {
      stopped = true;
      cleanup();
      stopTracking?.();
      window.removeEventListener('message', onPlaybackMessage);
    };
    attemptStart();
  };

  return (
    <>
      <div
        className="inline-flex max-w-full flex-wrap items-start gap-2"
        onPointerEnter={warmSession}
        onFocus={warmSession}
        onPointerDown={warmSession}
      >
        <ButtonWithDropdown
          as="button"
          buttonType="ghost"
          className="media-action media-action-play"
          aria-label={
            hasResume
              ? `${intl.formatMessage(messages.resume)} · ${Math.round(
                  resumePercent
                )}%`
              : links[0].text
          }
          title={
            hasResume
              ? `${intl.formatMessage(messages.resume)} · ${Math.round(
                  resumePercent
                )}%`
              : links[0].text
          }
          text={
            <>
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center [&>svg]:h-5 [&>svg]:w-5">
                {links[0].svg}
              </span>
              <span
                className={
                  hasResume ? 'whitespace-nowrap text-sm' : 'hidden 2xl:inline'
                }
              >
                {hasResume
                  ? intl.formatMessage(messages.resume)
                  : links[0].text}
              </span>
              {hasResume && (
                <span className="ml-1.5 rounded-full bg-indigo-500/25 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-indigo-100">
                  {Math.round(resumePercent)}%
                </span>
              )}
            </>
          }
          onClick={() => void open(links[0])}
        >
          {links.length > 1 &&
            links.slice(1).map((link, index) => (
              <ButtonWithDropdown.Item
                key={`play-button-dropdown-item-${index}`}
                buttonType="ghost"
                href={link.url}
                onClick={(event) => {
                  event.preventDefault();
                  void open(link);
                }}
              >
                {link.svg}
                <span>{link.text}</span>
              </ButtonWithDropdown.Item>
            ))}
        </ButtonWithDropdown>
        {isJellyfinUrl(links[0].url) && (
          <CastButton link={{ ...links[0], resumeTicks: historyResume }} />
        )}
        <OfflineButton link={links[0]} />
        {isJellyfinUrl(links[0].url) && <PartyButton link={links[0]} />}
      </div>

      {isOpening && (
        <span className="ml-3 text-sm text-gray-300" role="status">
          {intl.formatMessage(messages.connecting)}
        </span>
      )}
      {playError && (
        <div
          className="mt-2 max-w-xl rounded-md border border-red-500/40 bg-red-900/30 px-3 py-2 text-sm text-red-100"
          role="alert"
        >
          {playError}
        </div>
      )}

      {(activeLink || preparedLink) &&
        ReactDOM.createPortal(
          <div
            className={
              activeLink
                ? 'fixed inset-0 z-[120] flex flex-col bg-black'
                : 'pointer-events-none fixed -left-[10000px] top-0 flex h-[720px] w-[1280px] flex-col bg-black'
            }
            role={activeLink ? 'dialog' : undefined}
            aria-modal={activeLink ? true : undefined}
            aria-hidden={!activeLink}
            aria-label={(activeLink || preparedLink)?.text}
          >
            <div className="flex min-h-14 items-center justify-between gap-3 border-b border-gray-700 bg-gray-900 px-3 py-2 text-white sm:px-5">
              <div className="flex min-w-0 items-center gap-2 font-semibold">
                <span className="h-5 w-5 shrink-0">
                  {(activeLink || preparedLink)?.svg}
                </span>
                <span className="truncate">
                  {(activeLink || preparedLink)?.text}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {activeLink && isJellyfinUrl(activeLink.url) && (
                  <CastButton
                    link={activeLink}
                    resolveLink={() => {
                      const frame = frameRef.current?.contentWindow as
                        | (Window & {
                            __seerrPlaybackSnapshot?: () => {
                              itemId?: string;
                              position: number;
                              seasonNumber?: number;
                              episodeNumber?: number;
                            } | null;
                          })
                        | null;
                      const snapshot = frame?.__seerrPlaybackSnapshot?.();
                      if (
                        !snapshot?.itemId ||
                        !/^[a-f0-9]{32}$/i.test(snapshot.itemId)
                      )
                        return activeLink;
                      const url = new URL(
                        activeLink.url,
                        window.location.origin
                      );
                      const query = new URLSearchParams(
                        url.hash.split('?')[1] || ''
                      );
                      query.set('id', snapshot.itemId);
                      url.hash = `#!/details?${query.toString()}`;
                      const context =
                        resolvedWatchContext.current ??
                        activeLink.watchProgress;
                      return {
                        ...activeLink,
                        url: url.toString(),
                        resumeTicks: Math.round(snapshot.position * 10000000),
                        watchProgress: context
                          ? {
                              ...context,
                              seasonNumber:
                                snapshot.seasonNumber ?? context.seasonNumber,
                              episodeNumber:
                                snapshot.episodeNumber ?? context.episodeNumber,
                            }
                          : undefined,
                      };
                    }}
                    handoff={() => {
                      const frame = frameRef.current?.contentWindow as
                        | (Window & {
                            __seerrPlaybackSnapshot?: () => {
                              itemId?: string;
                              position: number;
                            } | null;
                          })
                        | null;
                      const snapshot = frame?.__seerrPlaybackSnapshot?.();
                      const position = snapshot?.position;
                      return {
                        itemId: snapshot?.itemId,
                        ticks:
                          position !== undefined
                            ? Math.round(position * 10000000)
                            : undefined,
                        commit: closePlayer,
                      };
                    }}
                  />
                )}
                <button
                  type="button"
                  onClick={closePlayer}
                  className="inline-flex items-center gap-2 rounded-md border border-gray-600 px-3 py-2 text-sm hover:bg-gray-700"
                  aria-label={intl.formatMessage(messages.backToSeerr)}
                >
                  <XMarkIcon className="h-5 w-5" />
                  <span>{intl.formatMessage(messages.backToSeerr)}</span>
                </button>
              </div>
            </div>
            <div className="relative min-h-0 flex-1 bg-black">
              {activeLink &&
                isJellyfinUrl(activeLink.url) &&
                !isPlayerReady && (
                  <div
                    className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-5 bg-black px-6 text-center text-sm text-gray-200"
                    role="status"
                  >
                    {intl.formatMessage(
                      compatiblePlayback
                        ? messages.optimizing
                        : messages.starting
                    )}
                  </div>
                )}
              <iframe
                ref={frameRef}
                key={`${(preparedLink || activeLink)?.url}:${Boolean(preparedLink)}:${compatiblePlayback}:${playerGeneration}`}
                src={playerUrl(
                  (preparedLink || activeLink) as PlayButtonLink,
                  compatiblePlayback,
                  recoveryPosition,
                  Boolean(preparedLink)
                )}
                title={(activeLink || preparedLink)?.text}
                className={`absolute inset-0 h-full w-full border-0 bg-black transition-opacity duration-200 ${
                  isJellyfinUrl((activeLink || preparedLink)?.url || '') &&
                  !isPlayerReady
                    ? 'opacity-0'
                    : 'opacity-100'
                }`}
                allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
                onLoad={(event) => {
                  if (activeLink) startJellyfinPlayback(event.currentTarget);
                }}
              />
            </div>
          </div>,
          document.body
        )}
      {!activeLink &&
        ratingPrompt &&
        ReactDOM.createPortal(
          <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/75 p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-label={intl.formatMessage(messages.rateTitle, {
                title: ratingPrompt.title,
              })}
              className="w-full max-w-sm rounded-2xl border border-gray-600 bg-gray-800 p-6 text-center shadow-2xl"
            >
              <h2 className="text-xl font-semibold text-white">
                {intl.formatMessage(messages.rateTitle, {
                  title: ratingPrompt.title,
                })}
              </h2>
              <p className="mt-2 text-sm text-gray-300">
                {intl.formatMessage(messages.rateDescription)}
              </p>
              <div className="mt-5 flex justify-center gap-2">
                {[1, 2, 3, 4, 5].map((rating) => (
                  <button
                    key={rating}
                    type="button"
                    disabled={ratingSaving}
                    aria-label={`${rating} ${rating === 1 ? 'star' : 'stars'}`}
                    onClick={() => void saveRating(rating)}
                    className="rounded-lg p-1 text-amber-400 transition hover:scale-110 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50"
                  >
                    <StarIcon className="h-9 w-9" />
                  </button>
                ))}
              </div>
              {ratingError && (
                <p role="alert" className="mt-3 text-sm text-red-300">
                  {intl.formatMessage(messages.rateFailed)}
                </p>
              )}
              <button
                type="button"
                onClick={() => setRatingPrompt(null)}
                className="mt-5 rounded-md px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
              >
                {intl.formatMessage(messages.rateSkip)}
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

export default PlayButton;
