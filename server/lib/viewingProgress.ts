import type { WatchHistory } from '@server/entity/WatchHistory';
import type {
  ViewingProgress,
  ViewingRun,
} from '@server/interfaces/api/watchHistoryInterfaces';

export interface PlaybackReport {
  sessionId: string;
  position: number;
  duration: number;
  seasonNumber?: number;
  episodeNumber?: number;
}

export const viewingKey = (
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
) => (mediaType === 'movie' ? 'movie' : `${season}:${episode}`);

export const latestActiveViewing = (
  progress?: ViewingProgress
): { key: string; run: ViewingRun } | undefined =>
  Object.entries(progress ?? {})
    .filter(([, run]) => !run.completed && run.position >= 15)
    .sort(([, a], [, b]) => b.updatedAt.localeCompare(a.updatedAt))
    .map(([key, run]) => ({ key, run }))[0];

export const isRewatching = (progress?: ViewingProgress) =>
  Object.values(progress ?? {}).some(
    (run) => !run.completed && run.rewatching && run.position >= 15
  );

/** Mutate only tracking fields. Ratings, notes and lifetime watched markers survive. */
export function applyPlaybackReport(
  entry: WatchHistory,
  report: PlaybackReport,
  now = new Date()
) {
  const key = viewingKey(
    entry.mediaType,
    report.seasonNumber,
    report.episodeNumber
  );
  const previous = entry.viewingProgress?.[key];
  if (previous?.retiredSessionIds.includes(report.sessionId)) return;
  const knownSession = previous?.sessionIds.includes(report.sessionId);
  const atEnd = report.position / report.duration >= 0.9;
  // Reopening the credits is not an additional viewing. Repeated completion
  // reports, iframe recovery and resumed sessions never increase the count twice.
  if (previous?.completed && (knownSession || atEnd)) return;
  const episodeWatched =
    entry.episodeOverrides?.[key] ??
    (entry.status === 'completed' ||
      (entry.seasonProgress?.[String(report.seasonNumber)] ?? 0) >=
        (report.episodeNumber ?? Infinity));
  const wasWatched =
    entry.mediaType === 'movie'
      ? entry.status === 'completed' || entry.watchCount > 0
      : episodeWatched;
  if (!previous && wasWatched && atEnd) return;
  const baseline =
    entry.mediaType === 'movie'
      ? Math.max(entry.watchCount, wasWatched ? 1 : 0)
      : Math.max(previous?.watchCount ?? 0, wasWatched ? 1 : 0);
  const run: ViewingRun =
    !previous || previous.completed
      ? {
          sessionIds: [report.sessionId],
          retiredSessionIds: [
            ...(previous?.retiredSessionIds ?? []),
            ...(previous?.sessionIds ?? []),
          ].slice(-64),
          position: report.position,
          duration: report.duration,
          completed: false,
          rewatching: wasWatched,
          watchCount: baseline,
          updatedAt: now.toISOString(),
        }
      : {
          ...previous,
          sessionIds: [
            ...new Set([...previous.sessionIds, report.sessionId]),
          ].slice(-16),
        };
  run.position = report.position;
  run.duration = report.duration;
  run.updatedAt = now.toISOString();
  if (atEnd) {
    run.completed = true;
    run.watchCount = baseline + 1;
    entry.watchedAt = now;
    if (entry.mediaType === 'movie') {
      entry.status = 'completed' as WatchHistory['status'];
      entry.watchCount = run.watchCount;
    } else {
      entry.seasonProgress = {
        ...entry.seasonProgress,
        [String(report.seasonNumber)]: Math.max(
          entry.seasonProgress?.[String(report.seasonNumber)] ?? 0,
          report.episodeNumber!
        ),
      };
      entry.episodeOverrides = { ...entry.episodeOverrides, [key]: true };
    }
  } else if (entry.status !== 'completed') {
    entry.status = 'watching' as WatchHistory['status'];
  }
  entry.viewingProgress = { ...entry.viewingProgress, [key]: run };
}
