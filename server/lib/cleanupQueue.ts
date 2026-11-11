export interface CleanupQueueRecord {
  movieId?: number;
  seriesId?: number;
  episodeId?: number;
  downloadId?: string;
  status?: string;
  trackedDownloadState?: string;
  sizeleft?: number;
}

export interface CleanupQueue {
  totalRecords: number;
  records: CleanupQueueRecord[];
}

export interface CleanupQueueEpisode {
  id: number;
  episodeFileId: number;
  seasonNumber?: number;
}

/** Unknown or incomplete evidence must continue to protect library files. */
export function cleanupQueueBlocks(
  queue: CleanupQueue,
  kind: 'radarr' | 'sonarr',
  itemId: number,
  episodes: CleanupQueueEpisode[] = [],
  targetEpisodeIds?: number[]
): boolean {
  if (
    !Array.isArray(queue.records) ||
    !Number.isInteger(queue.totalRecords) ||
    queue.totalRecords < 0 ||
    queue.totalRecords !== queue.records.length
  ) {
    return true;
  }
  const matching = queue.records.filter(
    (record) =>
      (kind === 'radarr' ? record.movieId : record.seriesId) === itemId
  );
  if (kind === 'radarr') return matching.length > 0;

  const seasons = new Map(
    episodes.map((episode) => [episode.id, episode.seasonNumber])
  );
  const targetSeasons = new Set(targetEpisodeIds?.map((id) => seasons.get(id)));
  const scopeKnown =
    Boolean(targetEpisodeIds?.length) &&
    [...targetSeasons].every(
      (season) => Number.isInteger(season) && season! >= 0
    );
  const unrelatedPack = (record: CleanupQueueRecord) =>
    scopeKnown &&
    Boolean(record.downloadId) &&
    queue.records
      .filter((other) => other.downloadId === record.downloadId)
      .every((other) => {
        const season = seasons.get(other.episodeId!);
        return (
          other.seriesId === itemId &&
          Number.isInteger(season) &&
          season! >= 0 &&
          !targetSeasons.has(season)
        );
      });

  const imported = new Set(
    episodes.filter((episode) => episode.episodeFileId > 0).map(({ id }) => id)
  );
  const retainedReplacement = (record: CleanupQueueRecord) =>
    Boolean(record.downloadId) &&
    record.status === 'completed' &&
    record.sizeleft === 0 &&
    record.trackedDownloadState === 'importBlocked' &&
    record.episodeId !== undefined &&
    imported.has(record.episodeId);

  // Every row in a pack must be safely accounted for. A partially imported pack,
  // active upgrade or unknown episode remains a blocker, even at 100% transfer.
  return matching.some(
    (record) =>
      !unrelatedPack(record) &&
      (!retainedReplacement(record) ||
        queue.records.some(
          (other) =>
            other.downloadId === record.downloadId &&
            (other.seriesId !== itemId || !retainedReplacement(other))
        ))
  );
}
