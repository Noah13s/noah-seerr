import { useUser } from '@app/hooks/useUser';
import { Menu, Transition } from '@headlessui/react';
import { BellIcon, ChevronDownIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import type { WatchlistResponse } from '@server/interfaces/api/discoverInterfaces';
import type { WatchHistoryPublicRatingsResponse, WatchHistoryResponse } from '@server/interfaces/api/watchHistoryInterfaces';
import Link from 'next/link';
import { Fragment, useEffect, useState } from 'react';
import useSWR from 'swr';

interface ActivityItem {
  id: number;
  type: 'movie' | 'tv';
  tmdbId: number;
  is4k: boolean;
  status: MediaRequestStatus;
  mediaStatus: MediaStatus;
  downloads: { downloadId: string; size: number; sizeLeft: number }[];
  createdAt: string;
  updatedAt: string;
  mediaUpdatedAt: string;
}

const eventKey = (item: ActivityItem) => `${item.id}:${stageFor(item).key}`;

interface NotificationState {
  key: string;
  seen: string[];
  dismissed: string[];
}

const stageFor = (item: ActivityItem) => {
  if (item.status === MediaRequestStatus.DECLINED)
    return { key: 'declined', label: 'Request declined' };
  if (item.status === MediaRequestStatus.FAILED)
    return { key: 'failed', label: 'Request failed' };
  if (
    item.status === MediaRequestStatus.COMPLETED ||
    item.mediaStatus === MediaStatus.AVAILABLE
  )
    return { key: 'available', label: 'Available to watch' };
  if (item.downloads.length) {
    const unique = item.downloads.filter(
      (download, index, all) =>
        all.findIndex((candidate) => candidate.downloadId === download.downloadId) === index
    );
    const size = unique.reduce((total, download) => total + download.size, 0);
    const left = unique.reduce((total, download) => total + download.sizeLeft, 0);
    const percent = size
      ? Math.max(0, Math.min(100, Math.round((1 - left / size) * 100)))
      : 0;
    return { key: 'downloading', label: `Downloading · ${percent}%` };
  }
  if (item.mediaStatus === MediaStatus.PARTIALLY_AVAILABLE)
    return { key: 'partial', label: 'Partially available' };
  if (item.status === MediaRequestStatus.PENDING)
    return { key: 'pending', label: 'Waiting for approval' };
  return { key: 'approved', label: 'Request approved' };
};

const NotificationRow = ({
  item,
  unread,
  onRead,
  onDismiss,
}: {
  item: ActivityItem;
  unread: boolean;
  onRead: () => void;
  onDismiss: () => void;
}) => {
  const { data } = useSWR<{ title?: string; name?: string }>(
    `/api/v1/${item.type}/${item.tmdbId}`
  );
  const stage = stageFor(item);
  const timestamp =
    ['available', 'partial', 'downloading'].includes(stage.key)
      ? item.mediaUpdatedAt || item.updatedAt || item.createdAt
      : stage.key === 'pending'
        ? item.createdAt
        : item.updatedAt || item.createdAt;
  return (
    <Menu.Item>
      <div className="flex items-start border-b border-gray-700 hover:bg-gray-700/70">
        <Link
          href={`/${item.type}/${item.tmdbId}`}
          onClick={onRead}
          className="flex min-w-0 flex-1 gap-3 px-3 py-3 text-left sm:px-4"
        >
          <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${unread ? 'bg-indigo-400' : 'bg-transparent'}`} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-white">
              {data?.title ?? data?.name ?? (item.type === 'movie' ? 'Movie' : 'Series')}
              {item.is4k ? ' · 4K' : ''}
            </span>
            <span className="block text-xs text-gray-300">{stage.label}</span>
            <time dateTime={timestamp} className="mt-1 block text-xs text-gray-400">
              {timestamp && new Date(timestamp).toLocaleString(undefined, {
                dateStyle: 'medium', timeStyle: 'short',
              })}
            </time>
          </span>
        </Link>
        <button
          type="button"
          aria-label="Clear notification"
          title="Clear notification"
          onClick={onDismiss}
          className="m-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-gray-300 hover:bg-gray-600 hover:text-white"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>
    </Menu.Item>
  );
};

const Notifications = () => {
  const { user } = useUser();
  const { data } = useSWR<{ results: ActivityItem[] }>(
    user ? '/api/v1/request/activity' : null,
    { refreshInterval: 15000, revalidateOnFocus: true }
  );
  const { data: watchlist } = useSWR<WatchlistResponse>(user ? '/api/v1/discover/watchlist?page=1&take=1000' : null, { refreshInterval: 60 * 60 * 1000 });
  const { data: watching } = useSWR<WatchHistoryResponse>(user ? '/api/v1/watch-history?status=watching&take=1000' : null, { refreshInterval: 60 * 60 * 1000 });
  const { data: plannedMetadata } = useSWR<WatchHistoryPublicRatingsResponse>(user ? '/api/v1/watch-history/planned-metadata' : null, { refreshInterval: 60 * 60 * 1000 });
  const [upcomingExpanded, setUpcomingExpanded] = useState(false);
  const storageKey = `seerr-notifications-seen-${user?.id ?? 'guest'}`;
  const [notificationState, setNotificationState] = useState<NotificationState>({ key: '', seen: [], dismissed: [] });
  const items = data?.results ?? [];
  const tracked = new Map<string, { mediaType: 'movie' | 'tv'; tmdbId: number; title: string }>();
  for (const item of [...(watchlist?.results ?? []), ...(watching?.results ?? [])]) {
    if (item.tmdbId) tracked.set(`${item.mediaType}:${item.tmdbId}`, { mediaType: item.mediaType, tmdbId: item.tmdbId, title: item.title });
  }
  const upcoming = [...tracked].flatMap(([key, item]) => {
    const metadata = plannedMetadata?.[key];
    if (!metadata?.upcoming) return [];
    return [{ ...item, date: metadata.nextAirDate || metadata.releaseDate }];
  }).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));

  useEffect(() => {
    if (!user || !data || notificationState.key === storageKey) return;
    try {
      const saved = localStorage.getItem(storageKey);
      const parsed = saved ? JSON.parse(saved) as string[] | { seen?: string[]; dismissed?: string[] } : null;
      const next: NotificationState = {
        key: storageKey,
        seen: Array.isArray(parsed) ? parsed : parsed?.seen ?? items.map(eventKey),
        dismissed: Array.isArray(parsed) ? [] : parsed?.dismissed ?? [],
      };
      setNotificationState(next);
      if (!saved) localStorage.setItem(storageKey, JSON.stringify({ seen: next.seen, dismissed: [] }));
    } catch {
      setNotificationState({ key: storageKey, seen: [], dismissed: [] });
    }
  }, [user, data, notificationState.key, storageKey, items]);

  const ready = notificationState.key === storageKey;
  const visibleItems = ready
    ? items.filter((item) => !notificationState.dismissed.includes(eventKey(item)))
    : [];

  const unreadCount = visibleItems.filter((item) => !notificationState.seen.includes(eventKey(item))).length;

  const persist = (next: NotificationState) => {
    setNotificationState(next);
    localStorage.setItem(storageKey, JSON.stringify({ seen: next.seen, dismissed: next.dismissed }));
  };

  const markRead = (keys: string[]) => {
    persist({ ...notificationState, seen: Array.from(new Set([...notificationState.seen, ...keys])).slice(-500) });
  };
  const dismiss = (keys: string[]) => {
    persist({ ...notificationState, dismissed: Array.from(new Set([...notificationState.dismissed, ...keys])).slice(-500) });
  };

  if (!user) return null;

  return (
    <Menu as="div" className="relative">
      <Menu.Button
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-full text-gray-200 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ''}`}
      >
        <BellIcon className="h-6 w-6" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 rounded-full bg-indigo-500 px-1.5 text-[10px] font-bold text-white">
            {Math.min(unreadCount, 9)}{unreadCount > 9 ? '+' : ''}
          </span>
        )}
      </Menu.Button>
      <Transition
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="opacity-0 scale-95"
        enterTo="opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="opacity-100 scale-100"
        leaveTo="opacity-0 scale-95"
      >
        <Menu.Items className="fixed left-2 right-2 top-16 z-50 origin-top-right overflow-hidden rounded-xl border border-gray-600 bg-gray-800 shadow-2xl focus:outline-none sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-96">
          <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
            <span className="font-semibold text-white">Notifications</span>
            <div className="flex items-center gap-3">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => markRead(items.map(eventKey))}
                className="text-xs text-indigo-300 hover:text-indigo-100"
              >
                Mark all read
              </button>
            )}
            {visibleItems.length > 0 && (
              <button type="button" onClick={() => dismiss(visibleItems.map(eventKey))} className="text-xs text-gray-200 hover:text-white">
                Clear all
              </button>
            )}
            </div>
          </div>
          <div className="max-h-[min(65dvh,32rem)] overflow-y-auto">
            <div className="border-b border-gray-700">
              <button
                type="button"
                aria-expanded={upcomingExpanded}
                onClick={() => setUpcomingExpanded((value) => !value)}
                className="flex min-h-11 w-full items-center justify-between gap-3 px-4 text-left text-sm font-semibold text-white hover:bg-gray-700"
              >
                <span>Upcoming <span className="ml-1 rounded-full bg-gray-700 px-2 py-0.5 text-xs text-gray-200">{upcoming.length}</span></span>
                <ChevronDownIcon className={`h-4 w-4 shrink-0 transition-transform ${upcomingExpanded ? 'rotate-180' : ''}`} />
              </button>
              {upcomingExpanded && (
                <div className="max-h-56 overflow-y-auto border-t border-gray-700 bg-gray-900/50">
                  {upcoming.length ? upcoming.slice(0, 20).map((item) => (
                    <Menu.Item key={`${item.mediaType}:${item.tmdbId}`}>
                      <Link href={`/${item.mediaType}/${item.tmdbId}`} className="flex min-h-12 items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-gray-700">
                        <span className="min-w-0 truncate text-white">{item.title}</span>
                        <span className="shrink-0 text-xs text-gray-300">{item.date ? new Date(`${item.date}T12:00:00`).toLocaleDateString() : 'TBA'}</span>
                      </Link>
                    </Menu.Item>
                  )) : <p className="px-4 py-3 text-xs text-gray-400">No tracked releases yet.</p>}
                </div>
              )}
            </div>
            {visibleItems.length ? visibleItems.slice(0, 12).map((item) => (
              <NotificationRow
                key={item.id}
                item={item}
                unread={!notificationState.seen.includes(eventKey(item))}
                onRead={() => markRead([eventKey(item)])}
                onDismiss={() => dismiss([eventKey(item)])}
              />
            )) : (
              <p className="px-4 py-6 text-sm text-gray-300">No notifications.</p>
            )}
          </div>
          <Menu.Item>
            <Link href="/requests" className="block px-4 py-3 text-center text-sm text-indigo-300 hover:bg-gray-700">
              View requests
            </Link>
          </Menu.Item>
        </Menu.Items>
      </Transition>
    </Menu>
  );
};

export default Notifications;
