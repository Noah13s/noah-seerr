import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { WatchHistory } from '@server/entity/WatchHistory';
import { WatchHistoryStatus } from '@server/entity/WatchHistory';
import { createHash } from 'crypto';

export const RETENTION_DAYS = 14;
// Explicit administrator override: availability is still required, but viewing
// and retention do not decide which files an administrator may review.
export function assessManualCleanup(
  requests: MediaRequest[],
  histories: WatchHistory[]
): CleanupCandidate[] {
  const groups = new Map<string, MediaRequest[]>();
  for (const request of requests) {
    if (!request.media || !request.requestedBy) continue;
    const seasons =
      request.type === 'movie'
        ? [0]
        : (request.media.seasons || [])
            .filter(
              (season) =>
                season.seasonNumber > 0 &&
                [season.status, season.status4k].includes(MediaStatus.AVAILABLE)
            )
            .map((season) => season.seasonNumber);
    if (
      request.type === 'movie' &&
      ![request.media.status, request.media.status4k].includes(
        MediaStatus.AVAILABLE
      )
    )
      continue;
    for (const season of seasons) {
      const key = `${request.type}:${request.media.tmdbId}:${season}`;
      const existing = groups.get(key) || [];
      if (!existing.some((entry) => entry.id === request.id))
        existing.push(request);
      groups.set(key, existing);
    }
  }
  return [...groups].map(([key, entries]) => {
    const first = entries[0];
    const seasonNumber = Number(key.split(':')[2]) || undefined;
    const users = new Map(
      entries.map((entry) => [entry.requestedBy.id, entry.requestedBy])
    );
    const title =
      histories.find(
        (history) =>
          history.mediaType === first.type &&
          history.tmdbId === first.media.tmdbId
      )?.title || `#${first.media.tmdbId}`;
    return {
      key,
      mediaType: first.type,
      tmdbId: first.media.tmdbId,
      seasonNumber,
      title,
      requesterNames: [...users.values()].map(
        (user) =>
          user.displayName ||
          user.username ||
          user.jellyfinUsername ||
          `User ${user.id}`
      ),
      requesterCount: users.size,
      eligibleAt: new Date().toISOString(),
      eligible: false,
      fingerprint: digest([
        'manual',
        key,
        entries
          .map((entry) => [entry.id, entry.requestedBy.id, entry.updatedAt])
          .sort(),
        first.media.status,
        first.media.status4k,
        first.media.seasons
          ?.filter((season) => season.seasonNumber === seasonNumber)
          .map((season) => [season.status, season.status4k]),
      ]),
    };
  });
}
export const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface CleanupCandidate {
  key: string;
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  seasonNumber?: number;
  title: string;
  requesterNames: string[];
  requesterCount: number;
  eligibleAt: string;
  eligible: boolean;
  fingerprint: string;
}
export interface CleanupSeasonInfo {
  count: number;
  hasFutureEpisodes: boolean;
}

export async function assessCleanup(
  requests: MediaRequest[],
  histories: WatchHistory[],
  seasonInfo: (tmdbId: number, season: number) => Promise<CleanupSeasonInfo>,
  now = Date.now()
): Promise<CleanupCandidate[]> {
  const historyMap = new Map<string, WatchHistory>();
  for (const history of [...histories].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )) {
    const key = `${history.user?.id}:${history.mediaType}:${history.tmdbId}`;
    if (!historyMap.has(key)) historyMap.set(key, history);
  }
  const groups = new Map<
    string,
    { requests: MediaRequest[]; season?: number }
  >();
  for (const request of requests) {
    if (
      !request.media ||
      !request.requestedBy ||
      [MediaRequestStatus.DECLINED, MediaRequestStatus.FAILED].includes(
        request.status
      )
    )
      continue;
    for (const season of request.type === 'tv'
      ? (request.seasons ?? [])
      : [undefined]) {
      if (request.type === 'tv' && (!season || season.seasonNumber < 1))
        continue;
      const key = `${request.type}:${request.media.tmdbId}:${season?.seasonNumber ?? 0}`;
      const group = groups.get(key) ?? {
        requests: [],
        season: season?.seasonNumber,
      };
      group.requests.push(request);
      groups.set(key, group);
    }
  }
  const result: CleanupCandidate[] = [];
  for (const [key, group] of groups) {
    const first = group.requests[0];
    const users = new Map(
      group.requests.map((request) => [
        request.requestedBy.id,
        request.requestedBy,
      ])
    );
    const revisions: unknown[] = [];
    let latest = 0;
    let title = '';
    let ready = true;
    if (
      group.requests.some((request) =>
        request.type === 'movie'
          ? request.status !== MediaRequestStatus.COMPLETED ||
            request.media[request.is4k ? 'status4k' : 'status'] !==
              MediaStatus.AVAILABLE
          : request.seasons.find(
              (season) => season.seasonNumber === group.season
            )?.status !== MediaRequestStatus.COMPLETED
      )
    )
      continue;
    let info: CleanupSeasonInfo | undefined;
    for (const user of users.values()) {
      const history = historyMap.get(
        `${user.id}:${first.type}:${first.media.tmdbId}`
      );
      if (!history) {
        ready = false;
        break;
      }
      title = history.title || title;
      // A previous completion never makes an active rewatch eligible for cleanup.
      if (
        Object.entries(history.viewingProgress ?? {}).some(
          ([key, run]) =>
            !run.completed &&
            (first.type === 'movie' || key.startsWith(`${group.season}:`))
        )
      ) {
        ready = false;
        break;
      }
      if (first.type === 'movie') {
        if (history.status !== WatchHistoryStatus.COMPLETED) {
          ready = false;
          break;
        }
      } else if (history.status !== WatchHistoryStatus.DROPPED) {
        try {
          info ??= await seasonInfo(first.media.tmdbId, group.season!);
        } catch {
          ready = false;
          break;
        }
        const explicitlyUnwatched = Object.entries(
          history.episodeOverrides ?? {}
        ).some(
          ([episode, watched]) =>
            episode.startsWith(`${group.season}:`) && !watched
        );
        if (
          !info.count ||
          info.hasFutureEpisodes ||
          explicitlyUnwatched ||
          (history.status !== WatchHistoryStatus.COMPLETED &&
            (history.seasonProgress?.[String(group.season)] ?? 0) < info.count)
        ) {
          ready = false;
          break;
        }
      }
      // Season updates are conservative: later viewing/editing starts a fresh delay.
      const finish = new Date(
        first.type === 'movie'
          ? (history.watchedAt ?? history.updatedAt)
          : history.updatedAt
      ).getTime();
      if (!Number.isFinite(finish) || finish > now) {
        ready = false;
        break;
      }
      latest = Math.max(latest, finish);
      revisions.push([
        user.id,
        history.id,
        history.status,
        history.watchCount,
        finish,
        group.season ? history.seasonProgress?.[String(group.season)] : null,
        Object.entries(history.episodeOverrides ?? {})
          .filter(([episode]) => episode.startsWith(`${group.season}:`))
          .sort(),
      ]);
    }
    if (!ready || !latest) continue;
    // A fresh request/import must also age through the retention delay.
    for (const request of group.requests) {
      const updated = new Date(request.updatedAt).getTime();
      if (Number.isFinite(updated)) latest = Math.max(latest, updated);
    }
    const eligibleAt = new Date(
      latest + RETENTION_DAYS * 86400000
    ).toISOString();
    result.push({
      key,
      mediaType: first.type,
      tmdbId: first.media.tmdbId,
      seasonNumber: group.season,
      title,
      requesterCount: users.size,
      requesterNames: [...users.values()].map(
        (user) =>
          user.displayName ||
          user.username ||
          user.jellyfinUsername ||
          `User ${user.id}`
      ),
      eligibleAt,
      eligible: new Date(eligibleAt).getTime() <= now,
      fingerprint: digest([
        key,
        revisions.sort(),
        group.requests
          .map((request) => [
            request.id,
            request.requestedBy.id,
            request.status,
            request.is4k,
            request.updatedAt,
          ])
          .sort(),
      ]),
    });
  }
  return result.sort((a, b) => a.eligibleAt.localeCompare(b.eligibleAt));
}
