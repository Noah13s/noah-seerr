import { getRepository } from '@server/datasource';
import { CleanupReview } from '@server/entity/CleanupReview';
import { promises as fs } from 'fs';
import path from 'path';

export async function hasApprovedLibraryDeletion(tmdbId: number, mediaType: 'movie' | 'tv', seasonNumber = 0) {
  return !!await getRepository(CleanupReview).findOne({
    where: { reviewKey: `${mediaType}:${tmdbId}:${seasonNumber}`, status: 'deleted' },
    select: ['id'],
  });
}

export function jellyfinSourcePaths(item: { Path?: string; MediaSources?: { Path?: string }[] }) {
  return [item.Path, ...(item.MediaSources ?? []).map(source => source.Path)]
    .filter((value): value is string => typeof value === 'string' && !!value);
}

/** Check only tombstoned media. A seed payload elsewhere cannot resurrect a library entry. */
export async function deletedSourceIsPresent(paths: string[], stat = fs.stat): Promise<boolean> {
  for (const value of [...new Set(paths)].slice(0, 16)) {
    const mapped = path.posix.normalize(value.replace(/^\/srv\/media\//, '/media/'));
    if (!mapped.startsWith('/media/')) continue;
    try {
      const entry = await stat(mapped);
      if (entry.isFile() && Number(entry.size) > 0) return true;
    } catch { /* Missing/unreadable files must not become available from cached metadata. */ }
  }
  return false;
}
