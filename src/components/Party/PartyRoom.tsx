import { useUser } from '@app/hooks/useUser';
import {
  ArrowLeftIcon,
  ChatBubbleLeftRightIcon,
  LinkIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import axios from 'axios';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';

type Participant = {
  id: string;
  name: string;
  avatar: string;
  isAdmin: boolean;
  online: boolean;
};
type Room = {
  id: string;
  title: string;
  mediaTitle: string;
  itemId: string;
  me: string;
  isAdmin: boolean;
  inviteToken?: string;
  serverTime: number;
  expiresAt: number;
  playback: {
    paused: boolean;
    position: number;
    updatedAt: number;
    revision: number;
    duration: number;
  };
  watchContext?: {
    tmdbId: number;
    mediaType: 'movie' | 'tv';
    title: string;
    releaseYear?: number;
    seasonNumber?: number;
    episodeNumber?: number;
  };
  members: Participant[];
  messages: {
    id: string;
    memberId: string;
    name: string;
    avatar: string;
    text: string;
    createdAt: number;
  }[];
};
type Playback = {
  url: string;
  hls: boolean;
  subtitleUrl?: string;
  audio: number;
  subtitle: number;
  duration: number;
  tracks: { type: string; index: number; label: string }[];
};
const avatars = Array.from(
  { length: 16 },
  (_, i) => `/profile-avatars/preset-${String(i + 1).padStart(2, '0')}.svg`
);
const time = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const errorText = (error: unknown) =>
  axios.isAxiosError(error)
    ? error.response?.data?.message || 'Connection interrupted. Retrying…'
    : 'Something went wrong. Please try again.';
const button =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-600 px-4 py-2 text-sm font-semibold hover:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50';

export default function PartyRoom() {
  const router = useRouter();
  const { user } = useUser();
  const id = typeof router.query.id === 'string' ? router.query.id : '';
  const [room, setRoom] = useState<Room | null>(null);
  const roomRef = useRef<Room | null>(null);
  const [invite, setInvite] = useState('');
  const [needsJoin, setNeedsJoin] = useState(false);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ended, setEnded] = useState(false);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [starting, setStarting] = useState(false);
  const [position, setPosition] = useState(0);
  const [volume, setVolume] = useState(1);
  const [playError, setPlayError] = useState('');
  const [needsTap, setNeedsTap] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const player = useRef<HTMLDivElement>(null);
  const chat = useRef<HTMLDivElement>(null);
  const lastAccepted = useRef(0);
  const clockOffset = useRef(0);
  const alive = useRef(true);
  const lastHostUpdate = useRef(0);
  const stateBusy = useRef(false);
  const pendingState = useRef<{ paused: boolean; position: number } | null>(
    null
  );
  const viewingSession = useRef('');
  const apply = useCallback((state: Room) => {
    if (
      !alive.current ||
      state.playback.revision < (roomRef.current?.playback.revision ?? 0) ||
      (state.serverTime < lastAccepted.current &&
        state.playback.revision <= (roomRef.current?.playback.revision ?? 0))
    )
      return;
    lastAccepted.current = Math.max(lastAccepted.current, state.serverTime);
    clockOffset.current = state.serverTime - Date.now();
    roomRef.current = state;
    setRoom(state);
    setError('');
    setNeedsJoin(false);
  }, []);
  const poll = useCallback(async () => {
    if (!id) return;
    try {
      const { data } = await axios.get(`/api/v1/parties/${id}`, {
        timeout: 10_000,
      });
      apply(data);
    } catch (error) {
      if (!alive.current) return;
      if (
        axios.isAxiosError(error) &&
        [404, 410].includes(error.response?.status || 0)
      ) {
        setEnded(true);
        video.current?.pause();
        setPlayback(null);
      } else if (axios.isAxiosError(error) && error.response?.status === 403) {
        setNeedsJoin(true);
        setRoom(null);
        roomRef.current = null;
        video.current?.pause();
        setPlayback(null);
      } else setError(errorText(error));
    }
  }, [id, apply]);
  useEffect(() => {
    alive.current = true;
    if (!id) return;
    setInvite(new URLSearchParams(location.hash.slice(1)).get('invite') || '');
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const refresh = async () => {
      await poll();
      if (!stopped) timer = setTimeout(refresh, document.hidden ? 5000 : 1000);
    };
    void refresh();
    const focus = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener('visibilitychange', focus);
    window.addEventListener('online', focus);
    return () => {
      stopped = true;
      alive.current = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', focus);
      window.removeEventListener('online', focus);
    };
  }, [id, poll]);
  useEffect(() => {
    if (user?.displayName) setName(user.displayName);
  }, [user?.displayName]);
  useEffect(() => {
    const el = chat.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 250)
      el.scrollTop = el.scrollHeight;
  }, [room?.messages.length]);

  const desiredPosition = useCallback(() => {
    const state = roomRef.current?.playback;
    if (!state) return 0;
    return Math.min(
      state.duration || Infinity,
      state.position +
        (state.paused
          ? 0
          : Math.max(
              0,
              (Date.now() + clockOffset.current - state.updatedAt) / 1000
            ))
    );
  }, []);
  const sync = useCallback(() => {
    const el = video.current;
    const current = roomRef.current;
    if (!el || !current || el.readyState < 1) return;
    const expected = desiredPosition();
    // The host is the clock; never seek a host back to a delayed network echo.
    if (!current.isAdmin || el.paused) {
      const drift = expected - el.currentTime;
      if (Math.abs(drift) > 2) el.currentTime = expected;
      el.playbackRate =
        !current.isAdmin && Math.abs(drift) > 0.25 && Math.abs(drift) < 2
          ? drift > 0
            ? 1.04
            : 0.96
          : 1;
    }
    if (current.playback.paused) {
      if (!el.paused) el.pause();
    } else if (el.paused)
      void el
        .play()
        .then(() => setNeedsTap(false))
        .catch(() => setNeedsTap(true));
  }, [desiredPosition]);
  useEffect(() => {
    if (playback && !starting) sync();
  }, [room?.playback, playback, starting, sync]);

  const publish = useCallback(
    async (paused: boolean, seconds: number) => {
      const current = roomRef.current;
      if (!current?.isAdmin) return;
      if (stateBusy.current) {
        pendingState.current = { paused, position: seconds };
        return;
      }
      stateBusy.current = true;
      lastHostUpdate.current = Date.now();
      try {
        const { data } = await axios.post(`/api/v1/parties/${id}/state`, {
          paused,
          position: Math.max(
            0,
            Math.min(seconds, current.playback.duration || Infinity)
          ),
          revision: current.playback.revision,
        });
        apply(data);
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 409)
          await poll();
        else setError(errorText(error));
      } finally {
        stateBusy.current = false;
        const pending = pendingState.current;
        pendingState.current = null;
        if (pending && alive.current)
          void publish(pending.paused, pending.position);
      }
    },
    [id, apply, poll]
  );

  const prepare = async (audio?: number, subtitle?: number) => {
    setStarting(true);
    setPlayError('');
    try {
      const { data } = await axios.post(
        `/api/v1/parties/${id}/playback`,
        { audio, subtitle, force: Boolean(playError) },
        { timeout: 45_000 }
      );
      if (alive.current) setPlayback(data);
    } catch (error) {
      setPlayError(errorText(error));
      setStarting(false);
    }
  };
  useEffect(() => {
    const el = video.current;
    if (!el || !playback) return;
    let cancelled = false;
    let destroy: (() => void) | undefined;
    const ready = () => {
      if (!cancelled) {
        el.currentTime = desiredPosition();
        setStarting(false);
        sync();
      }
    };
    el.addEventListener('loadedmetadata', ready);
    const load = async () => {
      if (playback.hls && !el.canPlayType('application/vnd.apple.mpegurl')) {
        const { default: Hls } = await import('hls.js');
        if (cancelled) return;
        if (!Hls.isSupported()) {
          setPlayError('This browser cannot play this stream.');
          setStarting(false);
          return;
        }
        const hls = new Hls({
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          startPosition: desiredPosition(),
        });
        destroy = () => hls.destroy();
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal && !cancelled) {
            setPlayError('Playback was interrupted. Rejoin to reconnect.');
            setStarting(false);
          }
        });
        hls.loadSource(playback.url);
        hls.attachMedia(el);
      } else {
        el.src = playback.url;
        el.load();
      }
    };
    void load().catch(() => {
      if (!cancelled) {
        setPlayError('Could not load the player. Please retry.');
        setStarting(false);
      }
    });
    return () => {
      cancelled = true;
      el.removeEventListener('loadedmetadata', ready);
      destroy?.();
      el.pause();
      el.removeAttribute('src');
      el.load();
    };
  }, [playback, desiredPosition, sync]);
  useEffect(
    () => () => {
      if (id)
        void fetch(`/api/v1/parties/${id}/playback/stop`, {
          method: 'POST',
          credentials: 'same-origin',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        }).catch(() => {});
    },
    [id]
  );
  useEffect(() => {
    if (video.current) video.current.volume = volume;
  }, [volume]);
  useEffect(() => {
    if (!starting) return;
    const timer = setTimeout(() => {
      setStarting(false);
      setPlayError('Playback is taking too long. Rejoin to reconnect.');
    }, 60_000);
    return () => clearTimeout(timer);
  }, [starting]);
  useEffect(() => {
    if (!user?.id || !playback) return;
    const report = (keepalive = false) => {
      const el = video.current;
      const context = roomRef.current?.watchContext;
      if (
        !context ||
        !el ||
        el.currentTime < 15 ||
        !Number.isFinite(el.duration) ||
        el.duration <= 0
      )
        return;
      if (!viewingSession.current) viewingSession.current = crypto.randomUUID();
      const payload = {
        ...context,
        sessionId: viewingSession.current,
        position: el.currentTime,
        duration: el.duration,
      };
      if (keepalive)
        void fetch('/api/v1/watch-history/playback', {
          method: 'POST',
          keepalive: true,
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }).catch(() => {});
      else
        void axios
          .post('/api/v1/watch-history/playback', payload)
          .catch(() => {});
    };
    const timer = setInterval(() => report(), 20_000);
    const el = video.current;
    const ended = () => report();
    el?.addEventListener('ended', ended);
    return () => {
      clearInterval(timer);
      report(true);
      el?.removeEventListener('ended', ended);
    };
  }, [user?.id, playback]);
  const manage = async (action: string, memberId?: string) => {
    setBusy(true);
    try {
      const { data } = await axios.post(`/api/v1/parties/${id}/admin`, {
        action,
        memberId,
      });
      if (action === 'end') {
        setEnded(true);
        video.current?.pause();
      } else {
        apply(data);
        if (action === 'rotate')
          toast.success('Previous invitation links no longer work.');
      }
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-gray-900 text-gray-100">
      <Head>
        <title>{room?.title || 'Join a watch party'} · Seerr</title>
        <meta name="robots" content="noindex,nofollow" />
        <meta name="referrer" content="no-referrer" />
      </Head>
      <header className="flex min-h-16 items-center justify-between gap-3 border-b border-gray-800 bg-gray-900 px-4 sm:px-6">
        <Link
          href={user ? '/parties' : '/login'}
          className="inline-flex items-center gap-2 rounded-lg px-2 py-3 text-sm text-gray-300 hover:text-white"
        >
          <ArrowLeftIcon className="h-5 w-5" />
          {user ? 'My parties' : 'Seerr'}
        </Link>
        <div className="flex items-center gap-2 text-sm font-semibold text-indigo-200">
          <UserGroupIcon className="h-5 w-5" />
          Watch together
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] p-4 sm:p-6">
        {ended ? (
          <div className="mx-auto max-w-md rounded-2xl border border-gray-700 bg-gray-800 p-8 text-center">
            <h1 className="text-2xl font-bold">This party has ended</h1>
            <p className="mt-3 text-gray-400">
              Ask the host for a new invitation to watch together again.
            </p>
          </div>
        ) : needsJoin ? (
          <section className="mx-auto max-w-lg rounded-2xl border border-indigo-400/25 bg-gray-800 p-6 shadow-2xl sm:p-8">
            <div className="mb-5 inline-flex rounded-2xl bg-indigo-500/20 p-4 text-indigo-200">
              <UserGroupIcon className="h-9 w-9" />
            </div>
            <h1 className="text-2xl font-bold">You’re invited</h1>
            <p className="mt-2 text-sm text-gray-300">
              Choose a name and picture to join the party. No account needed.
            </p>
            {!invite && (
              <p className="mt-4 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200">
                Open the complete invitation link from the host.
              </p>
            )}
            <form
              className="mt-6 space-y-5"
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setError('');
                try {
                  const { data } = await axios.post(
                    `/api/v1/parties/${id}/join`,
                    { name, avatar, inviteToken: invite }
                  );
                  apply(data);
                  history.replaceState(history.state, '', location.pathname);
                } catch (error) {
                  setError(errorText(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="block text-sm font-medium">
                Your name
                <input
                  required
                  maxLength={40}
                  autoComplete="nickname"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-gray-600 bg-gray-900 p-3"
                />
              </label>
              <fieldset>
                <legend className="mb-3 text-sm font-medium">
                  Your profile picture
                </legend>
                <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
                  {avatars.map((src, index) => (
                    <button
                      key={src}
                      type="button"
                      onClick={() => setAvatar(src)}
                      aria-label={`Profile picture ${index + 1}`}
                      aria-pressed={avatar === src}
                      className={`aspect-square rounded-full p-0.5 focus:ring-2 focus:ring-white ${avatar === src ? 'ring-2 ring-indigo-400 ring-offset-2 ring-offset-gray-800' : 'opacity-70 hover:opacity-100'}`}
                    >
                      <img
                        src={src}
                        alt=""
                        className="h-full w-full rounded-full"
                      />
                    </button>
                  ))}
                </div>
              </fieldset>
              <button
                className={`${button} w-full border-indigo-500 bg-indigo-600 hover:bg-indigo-500`}
                disabled={busy || !avatar || !name.trim() || !invite}
              >
                {busy ? 'Joining…' : 'Join party'}
              </button>
            </form>
          </section>
        ) : !room ? (
          <p className="py-16 text-center text-gray-400" role="status">
            Connecting to the party…
          </p>
        ) : (
          <>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-widest text-indigo-300">
                  {room.isAdmin
                    ? 'Your party · You are the admin'
                    : 'Private watch party'}
                </p>
                <h1 className="mt-1 break-words text-xl font-bold sm:text-2xl">
                  {room.mediaTitle}
                </h1>
                <p className="mt-1 text-xs text-gray-400">
                  {room.members.length} participant
                  {room.members.length === 1 ? '' : 's'} · Invitation expires{' '}
                  {new Date(room.expiresAt).toLocaleDateString()}
                </p>
              </div>
              {room.isAdmin && (
                <button
                  className={`${button} bg-indigo-600`}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        `${location.origin}/party/${room.id}#invite=${room.inviteToken}`
                      );
                      toast.success(
                        'Invitation copied. Anyone with the link can join.'
                      );
                    } catch {
                      setError(
                        'Clipboard unavailable. Select and copy the invitation below.'
                      );
                    }
                  }}
                >
                  <LinkIcon className="h-5 w-5" />
                  Copy invitation
                </button>
              )}
            </div>
            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
              <section className="min-w-0 space-y-4">
                <div
                  ref={player}
                  className="overflow-hidden rounded-2xl border border-gray-700 bg-black [&:fullscreen>div:first-child]:min-h-0 [&:fullscreen>div:first-child]:flex-1 [&:fullscreen]:flex [&:fullscreen]:flex-col"
                >
                  <div className="relative aspect-video">
                    <video
                      ref={video}
                      playsInline
                      className="h-full w-full"
                      onTimeUpdate={() => {
                        const el = video.current;
                        if (!el) return;
                        setPosition(el.currentTime);
                        if (
                          roomRef.current?.isAdmin &&
                          !el.paused &&
                          Date.now() - lastHostUpdate.current > 5000
                        )
                          void publish(false, el.currentTime);
                      }}
                      onPlaying={() => setStarting(false)}
                      onWaiting={() => setStarting(true)}
                      onCanPlay={() => {
                        setStarting(false);
                        sync();
                      }}
                      onEnded={() => {
                        if (roomRef.current?.isAdmin)
                          void publish(
                            true,
                            video.current?.duration || position
                          );
                      }}
                      onError={() => {
                        setPlayError(
                          'The stream could not be loaded. Rejoin playback to retry.'
                        );
                        setStarting(false);
                      }}
                    >
                      {playback?.subtitleUrl && (
                        <track
                          key={playback.subtitleUrl}
                          kind="subtitles"
                          label="Subtitles"
                          src={playback.subtitleUrl}
                          default
                        />
                      )}
                    </video>
                    {(!playback || playError || starting || needsTap) && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/75 p-5 text-center">
                        {starting ? (
                          <>
                            <span className="h-9 w-9 animate-spin rounded-full border-2 border-gray-600 border-t-indigo-400" />
                            <p role="status">Preparing your stream…</p>
                          </>
                        ) : (
                          <>
                            <UserGroupIcon className="h-12 w-12 text-indigo-300" />
                            <p className="max-w-md text-sm text-gray-300">
                              {playError ||
                                (needsTap
                                  ? 'Tap to allow playback in your browser.'
                                  : room.isAdmin
                                    ? 'Start your stream, then press Play when everyone is ready.'
                                    : 'Join playback to watch in sync with the host.')}
                            </p>
                            <button
                              className={`${button} bg-indigo-600`}
                              onClick={() => {
                                if (needsTap && video.current) {
                                  void video.current
                                    .play()
                                    .then(() => setNeedsTap(false));
                                } else
                                  void prepare(
                                    playback?.audio,
                                    playback?.subtitle
                                  );
                              }}
                            >
                              Join playback
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="space-y-3 bg-gray-950 p-3 sm:p-4">
                    <input
                      aria-label="Playback position"
                      type="range"
                      min={0}
                      max={room.playback.duration || 1}
                      step={1}
                      value={Math.min(position, room.playback.duration || 1)}
                      disabled={!room.isAdmin || !playback || starting}
                      onChange={(e) => {
                        const seconds = Number(e.target.value);
                        if (video.current) video.current.currentTime = seconds;
                        setPosition(seconds);
                        void publish(room.playback.paused, seconds);
                      }}
                      className="w-full accent-indigo-400 disabled:opacity-50"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                      <div className="flex items-center gap-2">
                        {room.isAdmin ? (
                          <>
                            {[-10, 0, 10].map((jump) => (
                              <button
                                key={jump}
                                disabled={!playback || starting}
                                className={`${button} px-3`}
                                aria-label={
                                  jump === 0
                                    ? room.playback.paused
                                      ? 'Play for everyone'
                                      : 'Pause for everyone'
                                    : `Jump ${jump} seconds`
                                }
                                onClick={() => {
                                  const el = video.current;
                                  if (!el) return;
                                  if (jump) {
                                    el.currentTime = Math.max(
                                      0,
                                      Math.min(
                                        el.duration || Infinity,
                                        el.currentTime + jump
                                      )
                                    );
                                    void publish(
                                      room.playback.paused,
                                      el.currentTime
                                    );
                                  } else {
                                    const paused = !room.playback.paused;
                                    if (paused) el.pause();
                                    else
                                      void el
                                        .play()
                                        .catch(() => setNeedsTap(true));
                                    void publish(paused, el.currentTime);
                                  }
                                }}
                              >
                                {jump
                                  ? `${jump > 0 ? '+' : '−'}10s`
                                  : room.playback.paused
                                    ? '▶ Play'
                                    : 'Ⅱ Pause'}
                              </button>
                            ))}
                          </>
                        ) : (
                          <span className="text-gray-400">
                            {room.playback.paused
                              ? 'Host paused'
                              : 'Following the host'}
                          </span>
                        )}
                        <span className="ml-1 whitespace-nowrap text-xs tabular-nums text-gray-400">
                          {time(position)} / {time(room.playback.duration)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 text-xs text-gray-300">
                          Volume
                          <input
                            aria-label="Volume"
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={volume}
                            onChange={(e) => setVolume(Number(e.target.value))}
                            className="w-20 accent-indigo-400"
                          />
                        </label>
                        <button
                          className={button}
                          onClick={() => {
                            if (document.fullscreenElement)
                              void document.exitFullscreen();
                            else void player.current?.requestFullscreen();
                          }}
                        >
                          Fullscreen
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                {playback && (
                  <div className="grid gap-3 rounded-xl border border-gray-700 bg-gray-800/50 p-4 sm:grid-cols-2">
                    {['Audio', 'Subtitle'].map((type) => (
                      <label
                        key={type}
                        className="text-xs font-medium text-gray-400"
                      >
                        {type === 'Subtitle' ? 'Your subtitles' : 'Your audio'}
                        <select
                          disabled={starting}
                          value={
                            type === 'Audio'
                              ? playback.audio
                              : playback.subtitle
                          }
                          onChange={(e) =>
                            void prepare(
                              type === 'Audio'
                                ? Number(e.target.value)
                                : playback.audio,
                              type === 'Subtitle'
                                ? Number(e.target.value)
                                : playback.subtitle
                            )
                          }
                          className="mt-2 block w-full rounded-lg border border-gray-600 bg-gray-900 p-3 text-sm text-white"
                        >
                          {type === 'Subtitle' && (
                            <option value={-1}>Off</option>
                          )}
                          {playback.tracks
                            .filter((t) => t.type === type)
                            .map((t) => (
                              <option key={t.index} value={t.index}>
                                {t.label}
                              </option>
                            ))}
                        </select>
                      </label>
                    ))}
                  </div>
                )}
                <section className="rounded-xl border border-gray-700 p-4">
                  <h2 className="mb-3 flex items-center gap-2 font-semibold">
                    <UserGroupIcon className="h-5 w-5 text-indigo-300" />
                    In the party
                  </h2>
                  <div className="flex flex-wrap gap-3">
                    {room.members.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-2"
                      >
                        <div className="relative">
                          <img
                            src={m.avatar}
                            alt=""
                            className="h-9 w-9 rounded-full"
                          />
                          <span
                            className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-gray-800 ${m.online ? 'bg-green-400' : 'bg-gray-500'}`}
                          />
                        </div>
                        <div>
                          <p className="max-w-40 truncate text-sm">
                            {m.name}
                            {m.id === room.me ? ' (you)' : ''}
                          </p>
                          <p className="text-xs text-gray-400">
                            {m.isAdmin ? 'Admin' : m.online ? 'Online' : 'Away'}
                          </p>
                        </div>
                        {room.isAdmin && !m.isAdmin && (
                          <button
                            className="ml-2 rounded p-2 text-xs text-gray-400 hover:text-red-300"
                            aria-label={`Remove ${m.name}`}
                            disabled={busy}
                            onClick={() => void manage('kick', m.id)}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
                {room.isAdmin && (
                  <details className="rounded-xl border border-gray-700 p-4">
                    <summary className="cursor-pointer text-sm font-medium">
                      Admin controls
                    </summary>
                    <p className="my-3 text-xs text-gray-400">
                      Only you can control shared playback, remove participants,
                      replace the invitation, or end this party. Replacing the
                      invitation keeps current participants connected.
                    </p>
                    <label className="block text-xs text-gray-400">
                      Invitation link
                      <input
                        readOnly
                        value={`${typeof location === 'undefined' ? '' : location.origin}/party/${room.id}#invite=${room.inviteToken}`}
                        onFocus={(e) => e.target.select()}
                        className="mt-2 w-full rounded-lg border border-gray-600 bg-gray-800 p-3 text-sm"
                      />
                    </label>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        className={button}
                        disabled={busy}
                        onClick={() => void manage('rotate')}
                      >
                        Replace invitation
                      </button>
                      {confirmEnd ? (
                        <>
                          <button
                            className={`${button} bg-red-800`}
                            disabled={busy}
                            onClick={() => void manage('end')}
                          >
                            Confirm end for everyone
                          </button>
                          <button
                            className={button}
                            onClick={() => setConfirmEnd(false)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          className={`${button} text-red-300`}
                          onClick={() => setConfirmEnd(true)}
                        >
                          End party
                        </button>
                      )}
                    </div>
                  </details>
                )}
              </section>
              <section className="flex h-[min(650px,75dvh)] min-h-96 min-w-0 flex-col overflow-hidden rounded-2xl border border-gray-700 bg-gray-800/50 xl:sticky xl:top-5">
                <h2 className="flex items-center gap-2 border-b border-gray-700 p-4 font-semibold">
                  <ChatBubbleLeftRightIcon className="h-5 w-5 text-indigo-300" />
                  Party chat
                </h2>
                <div
                  ref={chat}
                  role="log"
                  aria-label="Party messages"
                  aria-live="polite"
                  className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4"
                >
                  {room.messages.length ? (
                    room.messages.map((m) => (
                      <article key={m.id} className="flex items-start gap-2.5">
                        <img
                          src={m.avatar}
                          alt=""
                          className="mt-0.5 h-8 w-8 rounded-full"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span className="text-xs font-semibold text-indigo-200">
                              {m.name}
                            </span>
                            <time
                              dateTime={new Date(m.createdAt).toISOString()}
                              className="text-[10px] text-gray-500"
                            >
                              {new Date(m.createdAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </time>
                          </div>
                          <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-200 [overflow-wrap:anywhere]">
                            {m.text}
                          </p>
                        </div>
                      </article>
                    ))
                  ) : (
                    <p className="py-12 text-center text-sm text-gray-400">
                      Say hello to the party 👋
                    </p>
                  )}
                </div>
                <form
                  className="flex gap-2 border-t border-gray-700 p-3"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (!message.trim() || busy) return;
                    setBusy(true);
                    try {
                      const { data } = await axios.post(
                        `/api/v1/parties/${id}/chat`,
                        { message }
                      );
                      apply(data);
                      setMessage('');
                      if (chat.current)
                        chat.current.scrollTop = chat.current.scrollHeight;
                    } catch (error) {
                      setError(errorText(error));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <input
                    aria-label="Message"
                    maxLength={1000}
                    required
                    placeholder="Message the party…"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm"
                  />
                  <button
                    className={`${button} bg-indigo-600 px-3`}
                    disabled={busy || !message.trim()}
                  >
                    Send
                  </button>
                </form>
              </section>
            </div>
          </>
        )}
        {error && (
          <p
            role="alert"
            className="mx-auto mt-4 max-w-2xl rounded-lg border border-amber-500/30 bg-amber-950/50 p-3 text-sm text-amber-200"
          >
            {error}
          </p>
        )}
      </main>
    </div>
  );
}
