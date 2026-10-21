import type { WatchHistorySummaryItem } from '@server/interfaces/api/watchHistoryInterfaces';

export interface CastRecoveryRecord {
  version: 1;
  updated: number;
  url: string;
  context?: Pick<WatchHistorySummaryItem, 'tmdbId' | 'mediaType' | 'title'> & {
    releaseYear?: number;
    seasonNumber?: number;
    episodeNumber?: number;
  };
  viewingSessionId?: string;
  deviceName?: string;
  title?: string;
}

export const castRecoveryKey = (profileId: number) =>
  `seerr.cast.ui.v1:${profileId}`;

// Persist only the item route and history context. Credentials, stream URLs,
// arbitrary query parameters and React nodes must never enter this record.
export const castRecoveryUrl = (value: string, origin: string) => {
  const url = new URL(value, origin);
  if (url.origin !== origin || url.pathname !== '/player/web/index.html')
    throw Error('Invalid Cast route');
  const query = new URLSearchParams(url.hash.split('?')[1] || '');
  const id = query.get('id'),
    serverId = query.get('serverId');
  if (!/^[a-f0-9]{32}$/i.test(id || '')) throw Error('Invalid Cast item');
  const safe = new URL('/player/web/index.html', origin);
  safe.search = '?seerrCast=1&seerrPlayer=85-15';
  safe.hash = `!/details?id=${id}`;
  if (serverId && /^[a-f0-9]{32}$/i.test(serverId))
    safe.hash += `&serverId=${serverId}`;
  return safe.toString();
};

export const parseCastRecovery = (raw: string | null, origin: string) => {
  try {
    const value = JSON.parse(raw || 'null') as CastRecoveryRecord;
    if (
      value?.version !== 1 ||
      !Number.isFinite(value.updated) ||
      value.updated < Date.now() - 12 * 3600000 ||
      value.updated > Date.now() + 60000
    )
      return undefined;
    const url = castRecoveryUrl(value.url, origin);
    const c = value.context;
    if (
      c &&
      (!Number.isSafeInteger(c.tmdbId) ||
        c.tmdbId <= 0 ||
        !['movie', 'tv'].includes(c.mediaType) ||
        typeof c.title !== 'string')
    )
      return undefined;
    return {
      version: 1 as const,
      updated: value.updated,
      url,
      context: c
        ? {
            tmdbId: c.tmdbId,
            mediaType: c.mediaType,
            title: c.title.slice(0, 300),
            releaseYear: c.releaseYear,
            seasonNumber: c.seasonNumber,
            episodeNumber: c.episodeNumber,
          }
        : undefined,
      viewingSessionId: /^[a-f0-9-]{36}$/i.test(value.viewingSessionId || '')
        ? value.viewingSessionId
        : undefined,
      deviceName:
        typeof value.deviceName === 'string'
          ? value.deviceName.slice(0, 200)
          : undefined,
      title:
        typeof value.title === 'string' ? value.title.slice(0, 300) : undefined,
    };
  } catch {
    return undefined;
  }
};
