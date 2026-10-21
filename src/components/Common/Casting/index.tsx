import type {
  PlayButtonLink,
  WatchProgressContext,
} from '@app/components/Common/PlayButton';
import { useUser } from '@app/hooks/useUser';
import { castDeadline, runCastCommand } from '@app/utils/castControlRecovery';
import {
  castRecoveryKey,
  castRecoveryUrl,
  parseCastRecovery,
} from '@app/utils/castRecovery';
import defineMessages from '@app/utils/defineMessages';
import {
  installJellyfinSession,
  prepareSession,
} from '@app/utils/jellyfinSession';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import {
  PauseIcon,
  PlayIcon,
  StarIcon,
  StopIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid';
import type { WatchHistoryItem } from '@server/interfaces/api/watchHistoryInterfaces';
import axios from 'axios';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { mutate } from 'swr';

const messages = defineMessages('components.Casting', {
  cast: 'Cast',
  title: 'Cast to a device',
  searching: 'Looking for devices…',
  connecting: 'Connecting to device…',
  deviceFailed:
    'Could not connect to the device. Make sure it is online, then try again.',
  noDevices:
    'No devices found. Turn on your TV or receiver and connect it to the same network. Google Cast discovery requires a supported browser such as Chrome or Edge.',
  refresh: 'Refresh devices',
  close: 'Close',
  pause: 'Pause',
  play: 'Play',
  stop: 'Stop casting',
  disconnect: 'Disconnect remote',
  volume: 'Volume',
  seek: 'Playback position',
  controls: 'Casting controls',
  preparing: 'Preparing playback…',
  failed: 'Could not connect to the player. Please try again.',
  playingOn: 'Playing on {device}',
  rate: 'Rate {title}',
  later: 'Maybe later',
  disconnected: 'The device disconnected. Choose a device again.',
  backward: 'Back 10 seconds',
  forward: 'Forward 10 seconds',
  audio: 'Audio',
  subtitles: 'Subtitles',
  off: 'Off',
  reconnect: 'Reconnect controls',
  recovering: 'Reconnecting to TV…',
  controlDisconnected: 'TV control connection interrupted',
  applyingTracks: 'Applying playback settings on TV…',
});
export const CastIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    aria-hidden="true"
  >
    <path d="M3 4h18v14h-7M3 10a11 11 0 0 1 11 11M3 15a6 6 0 0 1 6 6" />
    <circle cx="3" cy="21" r="1" fill="currentColor" stroke="none" />
  </svg>
);
interface CastTarget {
  id: string;
  name: string;
  appName?: string;
  active?: boolean;
}
interface CastState {
  connected: boolean;
  connection?: 'connected' | 'recovering' | 'disconnected';
  connectionError?: string;
  deviceName?: string;
  itemId?: string;
  title?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  position?: number;
  duration?: number;
  paused?: boolean;
  volume?: number;
  canSeek?: boolean;
  canVolume?: boolean;
  canAudio?: boolean;
  canSubtitles?: boolean;
  audio?: { index: number; label: string }[];
  subtitles?: { index: number; label: string }[];
  audioIndex?: number;
  subtitleIndex?: number;
}
export type CastHandoff = () =>
  | { itemId?: string; ticks?: number; commit: () => void }
  | undefined;
interface CastBridge {
  ready: () => boolean;
  discover: () => Promise<CastTarget[]>;
  connect: (
    id: string,
    itemId: string,
    ticks?: number,
    handoff?: CastHandoff
  ) => Promise<CastState>;
  snapshot: () => CastState;
  command: (command: string, value?: number) => unknown;
  disconnect: (stop?: boolean) => Promise<void>;
  recover: (interactive?: boolean) => Promise<void>;
  restore: () => Promise<boolean>;
}
const CastingContext = createContext<{
  open: (link?: PlayButtonLink, handoff?: CastHandoff) => Promise<void>;
  label: string;
  isCasting: boolean;
}>({ open: async () => undefined, label: 'Cast', isCasting: false });
export const useCasting = () => useContext(CastingContext);
const timestamp = (seconds = 0) => {
  const n = Math.floor(seconds);
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};
const RemoteSlider = ({
  label,
  value,
  max,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  max: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) => {
  const [draft, setDraft] = useState(value),
    pending = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (pending.current === undefined) setDraft(value);
  }, [value]);
  const commit = () => {
    if (pending.current !== undefined) {
      onCommit(pending.current);
      pending.current = undefined;
    }
  };
  return (
    <input
      aria-label={label}
      type="range"
      min="0"
      max={max}
      step="1"
      value={draft}
      disabled={disabled}
      onChange={(event) => {
        pending.current = Number(event.target.value);
        setDraft(pending.current);
      }}
      onPointerUp={commit}
      onKeyUp={commit}
      onBlur={commit}
      className="w-full min-w-0 accent-indigo-500"
    />
  );
};
const itemId = (link: PlayButtonLink) => {
  const u = new URL(link.url, window.location.origin);
  return new URLSearchParams(u.hash.split('?')[1] || '').get('id');
};

export const CastingProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const intl = useIntl(),
    { user } = useUser();
  const t = (key: keyof typeof messages, values?: Record<string, string>) =>
    intl.formatMessage(messages[key], values);
  const [visible, setVisible] = useState(false),
    [source, setSource] = useState<string>(),
    [senderKey, setSenderKey] = useState(0),
    [targets, setTargets] = useState<CastTarget[]>([]);
  const [state, setState] = useState<CastState>({ connected: false }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [applyingTracks, setApplyingTracks] = useState(false);
  const [rating, setRating] = useState<WatchHistoryItem | null>(null),
    [rateBusy, setRateBusy] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null),
    selection = useRef<PlayButtonLink | undefined>(undefined),
    handoff = useRef<CastHandoff | undefined>(undefined);
  const active = useRef<
      | {
          context: WatchProgressContext;
          link: PlayButtonLink;
          sessionId: string;
          signature?: string;
          episodes: Record<
            string,
            Promise<{ seasonNumber: number; episodeNumber: number }>
          >;
        }
      | undefined
    >(undefined),
    last = useRef<CastState>({ connected: false });
  const ratingKey = useRef(''),
    mounted = useRef(true),
    restoring = useRef(false),
    generation = useRef(0);
  const renewal = useRef<
      { epoch: number; promise: Promise<CastBridge> } | undefined
    >(undefined),
    controlQueue = useRef<Promise<unknown>>(Promise.resolve()),
    pendingControls = useRef(0),
    seekIntent = useRef<{ position: number; until: number } | undefined>(
      undefined
    ),
    lastAutoRecovery = useRef(0);
  const bridge = () =>
    (
      frame.current?.contentWindow as
        | (Window & { __seerrCast?: CastBridge })
        | null
    )?.__seerrCast;
  const forgetRecovery = () => {
    if (user)
      try {
        localStorage.removeItem(castRecoveryKey(user.id));
      } catch {
        /* Private mode. */
      }
  };
  const persistRecovery = (snapshot: CastState) => {
    const chosen = active.current?.link ?? selection.current;
    if (!user || !chosen || !snapshot.connected) return;
    try {
      localStorage.setItem(
        castRecoveryKey(user.id),
        JSON.stringify({
          version: 1,
          updated: Date.now(),
          url: castRecoveryUrl(chosen.url, window.location.origin),
          context: chosen.watchProgress,
          viewingSessionId: active.current?.sessionId,
          deviceName: snapshot.deviceName,
          title: snapshot.title,
        })
      );
    } catch {
      /* Casting remains usable without browser storage. */
    }
  };
  const renewSender = (failed?: CastBridge): Promise<CastBridge> => {
    const epoch = generation.current;
    if (renewal.current?.epoch === epoch) return renewal.current.promise;
    const chosen = active.current?.link ?? selection.current;
    const previousFrame = frame.current;
    if (!user || !chosen || !source || !previousFrame)
      return Promise.reject(Error(t('disconnected')));
    const live = bridge();
    if (failed && live && live !== failed && live.ready())
      return Promise.resolve(live);
    persistRecovery(last.current);
    const pending = {
      ...last.current,
      connected: true,
      connection: 'recovering' as const,
    };
    restoring.current = true;
    setState(pending);
    const promise = (async () => {
      try {
        const session = await prepareSession(user.id);
        if (epoch !== generation.current)
          throw Error('Casting connection changed.');
        installJellyfinSession(chosen, session);
        // A new iframe creates a new SDK client/channel. Reinitializing the
        // same SDK instance retains the poisoned Android Presentation client.
        // Removing the sender never sends Stop or PlayNow to the receiver.
        setSenderKey((key) => key + 1);
        const deadline = Date.now() + 20000;
        while (
          epoch === generation.current &&
          Date.now() < deadline &&
          (frame.current === previousFrame || !bridge()?.ready())
        )
          await new Promise((resolve) => setTimeout(resolve, 100));
        if (epoch !== generation.current)
          throw Error('Casting connection changed.');
        const fresh = bridge();
        if (
          frame.current === previousFrame ||
          !fresh?.ready() ||
          !(await castDeadline(() => fresh.restore(), 15000))
        )
          throw Error('Could not reconnect to the TV.');
        if (epoch !== generation.current)
          throw Error('Casting connection changed.');
        const snapshot = fresh.snapshot();
        if (!snapshot.connected || snapshot.connection !== 'connected')
          throw Error(
            snapshot.connectionError || 'Could not reconnect to the TV.'
          );
        last.current = snapshot;
        setState(snapshot);
        persistRecovery(snapshot);
        setError(null);
        return fresh;
      } catch (error) {
        if (epoch === generation.current)
          setState({ ...pending, connection: 'disconnected' });
        throw error;
      } finally {
        if (epoch === generation.current) {
          restoring.current = false;
          renewal.current = undefined;
        }
      }
    })();
    renewal.current = { epoch, promise };
    return promise;
  };
  const recoverControls = async () => {
    const epoch = generation.current;
    if (renewal.current?.epoch === generation.current)
      return renewal.current.promise;
    const old = bridge();
    if (old) {
      try {
        // The OS menu for an existing route cannot repair a poisoned channel.
        // Rejoin first, then replace the sender realm if the SDK still fails.
        await castDeadline(() => old.recover(false), 7000);
        const snapshot = old.snapshot();
        if (snapshot.connected && snapshot.connection === 'connected')
          return old;
      } catch {
        /* Replace only the sender; preserve TV playback and history. */
      }
    }
    if (epoch !== generation.current)
      throw Error('Casting connection changed.');
    return renewSender(old);
  };
  const report = async (snapshot: CastState, force = false) => {
    const run = active.current,
      chosen = active.current?.link;
    if (
      !run ||
      !chosen ||
      !snapshot.itemId ||
      !Number.isFinite(snapshot.position) ||
      (snapshot.position || 0) < 15 ||
      !snapshot.duration
    )
      return;
    const context = { ...run.context };
    if (snapshot.itemId !== itemId(chosen)) {
      if (context.mediaType !== 'tv') return;
      try {
        const episode = await (run.episodes[snapshot.itemId] ||= axios
          .get(`/api/v1/tv/${context.tmdbId}/playback-item/${snapshot.itemId}`)
          .then(({ data }) => data));
        Object.assign(context, episode);
      } catch {
        delete run.episodes[snapshot.itemId];
        return;
      }
      if (active.current !== run) return;
    }
    if (context.mediaType === 'tv') {
      context.seasonNumber = snapshot.seasonNumber ?? context.seasonNumber;
      context.episodeNumber = snapshot.episodeNumber ?? context.episodeNumber;
      if (context.seasonNumber === undefined || !context.episodeNumber) return;
    }
    const signature = `${snapshot.itemId}:${Math.floor((snapshot.position || 0) / 20)}:${snapshot.paused}`;
    if (!force && run.signature === signature) return;
    run.signature = signature;
    try {
      const { data } = await axios.post<WatchHistoryItem>(
        '/api/v1/watch-history/playback',
        {
          ...context,
          sessionId: run.sessionId,
          position: snapshot.position,
          duration: snapshot.duration,
        }
      );
      void mutate('/api/v1/watch-history/summary');
      void mutate('/api/v1/watch-history?active=1&take=24');
      void mutate('/api/v1/watch-history?status=watching&take=24');
      if (
        (snapshot.position || 0) / snapshot.duration >= 0.9 &&
        !data.rating &&
        ratingKey.current !== `${data.id}`
      ) {
        ratingKey.current = `${data.id}`;
        if (mounted.current && active.current === run) setRating(data);
      }
    } catch {
      run.signature = undefined;
    }
  };
  useEffect(() => {
    mounted.current = true;
    if (!source) return;
    const timer = setInterval(() => {
      if (restoring.current) return;
      try {
        const snapshot = bridge()?.snapshot();
        if (!snapshot) return;
        if (last.current.connected && !snapshot.connected) {
          void report(last.current, true);
          active.current = undefined;
          setError(t('disconnected'));
          setTargets([]);
          forgetRecovery();
        }
        last.current = snapshot;
        persistRecovery(snapshot);
        if (
          snapshot.connected &&
          (!snapshot.connection || snapshot.connection === 'connected')
        )
          void report(snapshot);
        setState(snapshot);
      } catch {
        /* A receiver can disappear between state updates. */
      }
    }, 1000);
    const flush = () => {
      persistRecovery(last.current);
      void report(last.current, true);
    };
    window.addEventListener('pagehide', flush);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      window.removeEventListener('pagehide', flush);
    };
  }, [source, user?.id]);
  useEffect(() => {
    // Profile changes destroy the authenticated bridge, without stopping another
    // user's receiver or submitting their progress as the newly signed-in user.
    generation.current++;
    renewal.current = undefined;
    controlQueue.current = Promise.resolve();
    pendingControls.current = 0;
    seekIntent.current = undefined;
    lastAutoRecovery.current = 0;
    restoring.current = false;
    setBusy(false);
    setConnecting(false);
    setApplyingTracks(false);
    active.current = undefined;
    selection.current = undefined;
    setSource(undefined);
    setVisible(false);
    setTargets([]);
    setState({ connected: false });
    setRating(null);
    last.current = { connected: false };
    setError(null);
    if (!user) return;
    let saved;
    try {
      saved = parseCastRecovery(
        localStorage.getItem(castRecoveryKey(user.id)),
        window.location.origin
      );
    } catch {
      return;
    }
    if (!saved) return;
    const epoch = generation.current;
    restoring.current = true;
    setBusy(true);
    const chosen: PlayButtonLink = {
      url: saved.url,
      text: t('cast'),
      svg: null,
      watchProgress: saved.context,
    };
    selection.current = chosen;
    active.current = saved.context
      ? {
          context: saved.context,
          link: chosen,
          sessionId: saved.viewingSessionId || crypto.randomUUID(),
          episodes: {},
        }
      : undefined;
    const pending: CastState = {
      connected: true,
      connection: 'recovering',
      deviceName: saved.deviceName,
      title: saved.title,
    };
    last.current = pending;
    setState(pending);
    void (async () => {
      try {
        const session = await prepareSession(user.id);
        if (epoch !== generation.current) return;
        installJellyfinSession(chosen, session);
        setSource(saved.url);
        const deadline = Date.now() + 20000;
        while (
          !bridge()?.ready() &&
          Date.now() < deadline &&
          epoch === generation.current
        )
          await new Promise((resolve) => setTimeout(resolve, 100));
        if (epoch !== generation.current) return;
        if (!bridge()?.ready()) throw Error('Cast bridge unavailable');
        if (!(await bridge()!.restore())) {
          forgetRecovery();
          active.current = undefined;
          setState({ connected: false });
          setSource(undefined);
        } else setState(bridge()!.snapshot());
      } catch {
        if (epoch === generation.current)
          setState({ ...pending, connection: 'disconnected' });
      } finally {
        if (epoch === generation.current) {
          restoring.current = false;
          setBusy(false);
        }
      }
    })();
  }, [user?.id]);
  useEffect(() => {
    if (!visible && !busy && !state.connected) setSource(undefined);
  }, [visible, busy, state.connected]);
  const discover = async () => {
    const epoch = generation.current;
    setBusy(true);
    setError(null);
    try {
      const devices = await bridge()!.discover();
      if (epoch === generation.current) setTargets(devices);
    } catch {
      if (epoch === generation.current) setError(t('failed'));
    } finally {
      if (epoch === generation.current) setBusy(false);
    }
  };
  const open = async (link?: PlayButtonLink, stopLocal?: CastHandoff) => {
    if (!user) return;
    if (link) selection.current = link;
    handoff.current = stopLocal;
    setVisible(true);
    setError(null);
    setBusy(true);
    const epoch = generation.current;
    try {
      if (!source) {
        const chosen = link ?? selection.current;
        if (!chosen) throw Error('No media selected');
        const session = await prepareSession(user.id);
        if (epoch !== generation.current) return;
        installJellyfinSession(chosen, session);
        const url = new URL(chosen.url, window.location.origin);
        url.search = '?seerrCast=1&seerrPlayer=85-15';
        setSource(url.toString());
      }
      const deadline = Date.now() + 15000;
      while (
        !bridge()?.ready() &&
        Date.now() < deadline &&
        epoch === generation.current
      )
        await new Promise((resolve) => setTimeout(resolve, 100));
      if (epoch !== generation.current) return;
      if (!bridge()?.ready()) {
        setSource(undefined);
        throw Error('Cast bridge unavailable');
      }
      await discover();
    } catch {
      if (epoch === generation.current) {
        setError(t('failed'));
        setBusy(false);
      }
    }
  };
  const connect = (device: CastTarget) => {
    const chosen = selection.current,
      id = chosen && itemId(chosen);
    if (!chosen || !id) return;
    const epoch = generation.current;
    setBusy(true);
    setError(null);
    setConnecting(true);
    void report(last.current, true);
    // Invoke immediately while the original receiver-selection gesture is live.
    void bridge()!
      .connect(device.id, id, chosen.resumeTicks, () => {
        if (epoch !== generation.current) throw Error('Profile changed');
        return handoff.current?.();
      })
      .then((snapshot) => {
        if (epoch !== generation.current) return;
        active.current = chosen.watchProgress
          ? {
              context: chosen.watchProgress,
              link: chosen,
              sessionId: crypto.randomUUID(),
              episodes: {},
            }
          : undefined;
        last.current = snapshot;
        persistRecovery(snapshot);
        setState(snapshot);
      })
      .catch((e) => {
        if (epoch === generation.current)
          setError(
            /cancel/i.test(e?.message || e?.code || '')
              ? null
              : t('deviceFailed')
          );
      })
      .finally(() => {
        if (epoch === generation.current) {
          setBusy(false);
          setConnecting(false);
        }
      });
  };
  const command = (name: string, value?: number) => {
    const epoch = generation.current;
    if (pendingControls.current >= 8) {
      setError('TV controls are reconnecting. Please wait a moment.');
      return;
    }
    if (name === 'jump' && Number.isFinite(value)) {
      const anchor =
        seekIntent.current && seekIntent.current.until > Date.now()
          ? seekIntent.current.position
          : last.current.position || 0;
      value = Math.max(
        0,
        Math.min(last.current.duration || Infinity, anchor + value!)
      );
      name = 'seek';
    }
    if (name === 'seek' && Number.isFinite(value))
      seekIntent.current = { position: value!, until: Date.now() + 2000 };
    pendingControls.current++;
    const trackChange = name === 'audio' || name === 'subtitles';
    if (trackChange) {
      setBusy(true);
      setApplyingTracks(true);
    }
    try {
      setError(null);
      const result = controlQueue.current.then(async () => {
        if (epoch !== generation.current)
          throw Error('Casting connection changed.');
        const initial = bridge();
        if (!initial) throw Error(t('disconnected'));
        await runCastCommand(
          initial,
          name,
          value,
          bridge,
          renewSender,
          () => epoch === generation.current
        );
      });
      controlQueue.current = result.catch(() => {});
      void result
        .then(() => {
          if (epoch !== generation.current) return;
          const snapshot = bridge()?.snapshot() ?? last.current;
          setState(snapshot);
          void report(snapshot, true);
        })
        .catch((error) => {
          if (epoch === generation.current)
            setError(error?.message || t('disconnected'));
        })
        .finally(() => {
          if (epoch === generation.current) pendingControls.current--;
          if (trackChange && epoch === generation.current) {
            setBusy(false);
            setApplyingTracks(false);
          }
        });
    } catch {
      if (epoch === generation.current) pendingControls.current--;
      setError(t('disconnected'));
      if (trackChange) {
        setBusy(false);
        setApplyingTracks(false);
      }
    }
  };
  const reconnect = async () => {
    const epoch = generation.current;
    setBusy(true);
    setError(null);
    try {
      const result = controlQueue.current.then(() => {
        if (epoch !== generation.current)
          throw Error('Casting connection changed.');
        return recoverControls();
      });
      controlQueue.current = result.catch(() => {});
      await result;
      if (epoch === generation.current)
        setState(bridge()?.snapshot() ?? last.current);
    } catch (error) {
      if (epoch === generation.current)
        setError(
          error && typeof error === 'object' && 'message' in error
            ? String(error.message)
            : t('failed')
        );
    } finally {
      if (epoch === generation.current) setBusy(false);
    }
  };
  useEffect(() => {
    const foreground = () => {
      if (
        !source ||
        restoring.current ||
        pendingControls.current > 0 ||
        !last.current.connected ||
        document.visibilityState === 'hidden' ||
        Date.now() - lastAutoRecovery.current < 30000
      )
        return;
      lastAutoRecovery.current = Date.now();
      const epoch = generation.current;
      void recoverControls()
        .then((player) => {
          if (epoch === generation.current) {
            setState(player.snapshot());
            setError(null);
          }
        })
        .catch(() => {
          /* Retain the controls and explicit reconnect action. */
        });
    };
    document.addEventListener('visibilitychange', foreground);
    window.addEventListener('pageshow', foreground);
    window.addEventListener('online', foreground);
    return () => {
      document.removeEventListener('visibilitychange', foreground);
      window.removeEventListener('pageshow', foreground);
      window.removeEventListener('online', foreground);
    };
  }, [source, user?.id]);
  const disconnect = async (stop: boolean) => {
    setBusy(true);
    setError(null);
    await report(last.current, true);
    try {
      await bridge()?.disconnect(stop);
      generation.current++;
      renewal.current = undefined;
      restoring.current = false;
      controlQueue.current = Promise.resolve();
      pendingControls.current = 0;
      seekIntent.current = undefined;
      forgetRecovery();
      active.current = undefined;
      setState({ connected: false });
      last.current = { connected: false };
      setSource(undefined);
      setVisible(false);
    } catch {
      setError(t('failed'));
    } finally {
      setBusy(false);
    }
  };
  const saveRating = async (value: number) => {
    if (!rating) return;
    setRateBusy(true);
    try {
      await axios.patch(`/api/v1/watch-history/${rating.id}/rating`, {
        rating: value,
      });
      setRating(null);
      void mutate('/api/v1/watch-history/summary');
    } catch {
      setError(t('failed'));
    } finally {
      setRateBusy(false);
    }
  };
  return (
    <CastingContext.Provider
      value={{ open, label: t('cast'), isCasting: Boolean(source) }}
    >
      {children}
      {source && (
        <iframe
          key={senderKey}
          ref={frame}
          title="Casting connection"
          src={source}
          aria-hidden="true"
          tabIndex={-1}
          allow="autoplay; presentation"
          className="pointer-events-none fixed -left-[10000px] top-0 h-px w-px border-0"
        />
      )}
      {state.connected && (
        <button
          onClick={() => void open()}
          className="fixed bottom-20 left-3 right-3 z-[125] flex items-center justify-between gap-3 rounded-xl border border-indigo-500 bg-gray-800 px-4 py-3 text-left text-white shadow-lg sm:left-auto sm:right-4 sm:max-w-sm"
          aria-label={t('controls')}
        >
          <CastIcon className="h-5 w-5 shrink-0 text-indigo-300" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">
              {state.title || selection.current?.watchProgress?.title}
            </span>
            <span className="block truncate text-xs text-gray-300">
              {state.connection === 'recovering'
                ? t('recovering')
                : state.connection === 'disconnected'
                  ? t('controlDisconnected')
                  : t('playingOn', { device: state.deviceName || 'Device' })}
            </span>
          </span>
          <span className="text-sm">{timestamp(state.position)}</span>
        </button>
      )}
      <Dialog
        open={visible}
        onClose={() => setVisible(false)}
        className="relative z-[150]"
      >
        <div className="fixed inset-0 bg-black/70" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center overflow-y-auto p-3 sm:p-6">
          <DialogPanel className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-gray-600 bg-gray-800 p-5 text-white shadow-xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <DialogTitle className="text-lg font-semibold">
                {state.connected ? t('controls') : t('title')}
              </DialogTitle>
              <button
                aria-label={t('close')}
                onClick={() => setVisible(false)}
                className="rounded-lg p-2 hover:bg-gray-700"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            {error && (
              <p
                role="alert"
                className="mb-3 rounded-lg bg-red-900/40 p-3 text-sm text-red-100"
              >
                {error}
              </p>
            )}
            {busy && (
              <p role="status" className="mb-3 text-sm text-indigo-200">
                {applyingTracks
                  ? t('applyingTracks')
                  : connecting
                    ? t('connecting')
                    : t('searching')}
              </p>
            )}
            {state.connected &&
              state.connection &&
              state.connection !== 'connected' && (
                <div
                  role="status"
                  className="mb-3 rounded-lg bg-amber-900/30 p-3 text-sm text-amber-100"
                >
                  <p>
                    {state.connection === 'recovering'
                      ? t('recovering')
                      : t('controlDisconnected')}
                  </p>
                  {state.connection !== 'recovering' && (
                    <button
                      disabled={busy}
                      onClick={() => void reconnect()}
                      className="mt-2 rounded-lg border border-amber-300 px-3 py-2 font-semibold disabled:opacity-40"
                    >
                      {t('reconnect')}
                    </button>
                  )}
                </div>
              )}
            {state.connected && (
              <section
                aria-label={t('controls')}
                className="mb-5 rounded-xl bg-gray-900 p-4"
              >
                <p className="font-semibold">
                  {state.title || selection.current?.watchProgress?.title}
                </p>
                <p className="mt-1 text-sm text-indigo-200">
                  {t('playingOn', { device: state.deviceName || 'Device' })}
                </p>
                <label className="mt-4 block text-sm">
                  <span className="sr-only">{t('seek')}</span>
                  <RemoteSlider
                    label={t('seek')}
                    value={state.position || 0}
                    max={state.duration || 1}
                    disabled={!state.canSeek || !state.duration || busy}
                    onCommit={(value) => command('seek', value)}
                  />
                </label>
                <div className="flex justify-between text-xs text-gray-400">
                  <span>{timestamp(state.position)}</span>
                  <span>{timestamp(state.duration)}</span>
                </div>
                <div className="my-3 flex justify-center gap-3">
                  <button
                    disabled={busy || !state.canSeek || !state.duration}
                    aria-label={t('backward')}
                    onClick={() => command('jump', -10)}
                    className="h-12 w-12 shrink-0 rounded-full bg-gray-700 text-sm font-semibold hover:bg-gray-600 disabled:opacity-40"
                  >
                    −10s
                  </button>
                  <button
                    disabled={busy}
                    aria-label={state.paused ? t('play') : t('pause')}
                    onClick={() => command(state.paused ? 'play' : 'pause')}
                    className="rounded-full bg-indigo-600 p-3 hover:bg-indigo-500"
                  >
                    {state.paused ? (
                      <PlayIcon className="h-6 w-6" />
                    ) : (
                      <PauseIcon className="h-6 w-6" />
                    )}
                  </button>
                  <button
                    disabled={busy || !state.canSeek || !state.duration}
                    aria-label={t('forward')}
                    onClick={() => command('jump', 10)}
                    className="h-12 w-12 shrink-0 rounded-full bg-gray-700 text-sm font-semibold hover:bg-gray-600 disabled:opacity-40"
                  >
                    +10s
                  </button>
                  <button
                    disabled={busy}
                    aria-label={t('stop')}
                    onClick={() => void disconnect(true)}
                    className="rounded-full bg-gray-700 p-3 hover:bg-gray-600"
                  >
                    <StopIcon className="h-6 w-6" />
                  </button>
                </div>
                {state.canVolume && (
                  <label className="flex items-center gap-3 text-sm">
                    {t('volume')}
                    <RemoteSlider
                      label={t('volume')}
                      value={state.volume ?? 100}
                      max={100}
                      disabled={busy}
                      onCommit={(value) => command('volume', value)}
                    />
                  </label>
                )}
                {!!state.audio?.length && state.canAudio && (
                  <label className="mt-4 block text-sm">
                    <span className="mb-1 block">{t('audio')}</span>
                    <select
                      aria-label={t('audio')}
                      value={state.audioIndex ?? state.audio[0].index}
                      disabled={busy}
                      onChange={(e) => command('audio', Number(e.target.value))}
                      className="w-full rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm"
                    >
                      {state.audio.map((track) => (
                        <option key={track.index} value={track.index}>
                          {track.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {!!state.subtitles?.length && state.canSubtitles && (
                  <label className="mt-3 block text-sm">
                    <span className="mb-1 block">{t('subtitles')}</span>
                    <select
                      aria-label={t('subtitles')}
                      value={state.subtitleIndex ?? -1}
                      disabled={busy}
                      onChange={(e) =>
                        command('subtitles', Number(e.target.value))
                      }
                      className="w-full rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm"
                    >
                      <option value={-1}>{t('off')}</option>
                      {state.subtitles.map((track) => (
                        <option key={track.index} value={track.index}>
                          {track.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  disabled={busy}
                  onClick={() => void disconnect(false)}
                  className="mt-4 text-sm text-gray-300 underline"
                >
                  {t('disconnect')}
                </button>
              </section>
            )}
            {!busy && !targets.length && (
              <p className="text-sm leading-6 text-gray-300">
                {t('noDevices')}
              </p>
            )}
            <div className="space-y-2">
              {targets.map((device) => (
                <button
                  key={device.id}
                  disabled={busy || !selection.current}
                  onClick={() => connect(device)}
                  className="flex w-full items-center gap-3 rounded-lg border border-gray-600 p-3 text-left hover:border-indigo-400 hover:bg-gray-700 disabled:opacity-50"
                >
                  <CastIcon className="h-5 w-5 text-indigo-300" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {device.name}
                    </span>
                    {device.appName && device.appName !== device.name && (
                      <span className="block truncate text-xs text-gray-400">
                        {device.appName}
                      </span>
                    )}
                  </span>
                  {device.active && (
                    <span className="ml-auto text-indigo-300">✓</span>
                  )}
                </button>
              ))}
            </div>
            <button
              disabled={busy}
              onClick={() =>
                void (bridge()?.ready()
                  ? discover()
                  : open(selection.current, handoff.current))
              }
              className="mt-4 rounded-lg border border-gray-600 px-3 py-2 text-sm hover:bg-gray-700 disabled:opacity-50"
            >
              {t('refresh')}
            </button>
          </DialogPanel>
        </div>
      </Dialog>
      <Dialog
        open={!!rating && !state.connected}
        onClose={() => setRating(null)}
        className="relative z-[160]"
      >
        <div className="fixed inset-0 bg-black/70" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel className="w-full max-w-sm rounded-2xl bg-gray-800 p-6 text-center text-white">
            <DialogTitle className="text-lg font-semibold">
              {t('rate', { title: rating?.title || '' })}
            </DialogTitle>
            <div className="my-4 flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  disabled={rateBusy}
                  aria-label={`${value} stars`}
                  onClick={() => void saveRating(value)}
                  className="rounded p-1 text-amber-400 hover:bg-gray-700"
                >
                  <StarIcon className="h-9 w-9" />
                </button>
              ))}
            </div>
            <button
              onClick={() => setRating(null)}
              className="text-sm text-gray-300"
            >
              {t('later')}
            </button>
          </DialogPanel>
        </div>
      </Dialog>
    </CastingContext.Provider>
  );
};
