import { MediaRequestStatus, MediaStatus, MediaType } from '@server/constants/media';

type Season = { seasonNumber: number; status: MediaStatus; status4k: MediaStatus };
type LibraryMedia = { mediaType: MediaType; status: MediaStatus; status4k: MediaStatus; seasons: Season[] };
type Request = { id: number; status: MediaRequestStatus; seasons: { id: number; seasonNumber: number; status: MediaRequestStatus }[] };

function aggregate(seasons: Season[], field: 'status' | 'status4k'): MediaStatus {
  if (seasons.some(s => [MediaStatus.AVAILABLE, MediaStatus.PARTIALLY_AVAILABLE].includes(s[field])))
    return MediaStatus.PARTIALLY_AVAILABLE;
  if (seasons.some(s => s[field] === MediaStatus.PROCESSING)) return MediaStatus.PROCESSING;
  if (seasons.some(s => s[field] === MediaStatus.PENDING)) return MediaStatus.PENDING;
  return MediaStatus.DELETED;
}

/** A deleted library lifecycle is requestable; it is not an unknown new title. */
export function applyDeletedLibraryState(media: LibraryMedia, seasonNumber?: number): void {
  if (media.mediaType === MediaType.MOVIE) {
    media.status = media.status4k = MediaStatus.DELETED;
    return;
  }
  if (!Number.isInteger(seasonNumber) || seasonNumber! < 0) throw new Error('A season is required.');
  for (const season of media.seasons.filter(s => s.seasonNumber === seasonNumber)) {
    season.status = season.status4k = MediaStatus.DELETED;
  }
  media.status = aggregate(media.seasons, 'status');
  media.status4k = aggregate(media.seasons, 'status4k');
}

/** Preserve request rows/owners for history, but close the approved deletion's old cycle. */
export function deletedRequestUpdates(requests: Request[], movie: boolean, seasonNumber?: number) {
  const requestIds: number[] = [], seasonIds: number[] = [];
  const terminal = (status: MediaRequestStatus) =>
    [MediaRequestStatus.COMPLETED, MediaRequestStatus.DECLINED].includes(status);
  for (const request of requests) {
    if (movie) {
      if (!terminal(request.status)) requestIds.push(request.id);
      continue;
    }
    const matching = request.seasons.filter(s => s.seasonNumber === seasonNumber);
    for (const season of matching) if (!terminal(season.status)) seasonIds.push(season.id);
    if (matching.length && !terminal(request.status) && request.seasons.every(s =>
      s.seasonNumber === seasonNumber || terminal(s.status))) requestIds.push(request.id);
  }
  return { requestIds, seasonIds };
}
