import { MediaType } from '@server/constants/media';
import Media from '@server/entity/Media';
import { promises as fs } from 'fs';
import path from 'path';
import { buildCleanupPlan } from './cleanupPlan';
import type { CleanupCandidate } from './cleanupPolicy';

export async function filterPresentCleanup<T>(
  candidates: T[],
  exists: (candidate: T) => Promise<boolean>
): Promise<T[]> {
  const results: T[] = [];
  // Bound Arr calls and preserve ordering. Fail closed on service errors.
  for (let index = 0; index < candidates.length; index += 4) {
    const chunk = candidates.slice(index, index + 4);
    const present = await Promise.all(chunk.map(exists));
    results.push(...chunk.filter((_, position) => present[position]));
  }
  return results;
}

export const cleanupLibraryCandidates = (candidates: CleanupCandidate[]) =>
  filterPresentCleanup(candidates, async (candidate) => {
    const media = await Media.getMedia(
      candidate.tmdbId,
      candidate.mediaType === 'movie' ? MediaType.MOVIE : MediaType.TV
    );
    if (!media || (candidate.mediaType === 'tv' && !media.tvdbId)) return false;
    const plan = await buildCleanupPlan(candidate, media);
    for (const file of plan.files) {
      const filename = file.path.replace(/^\/srv\/media\//, '/media/');
      try {
        const stat = await fs.stat(filename);
        if (stat.isFile() && stat.size === file.bytes) return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return false;
  });

export interface SourceCleanupStatus {
  state: 'pending' | 'complete' | 'ready' | 'waiting_seeding' | 'blocked';
  remainingBytes: number;
  reclaimedBytes: number;
  checkedAt?: string;
  reason?: string;
  torrents: {
    name?: string;
    bytes: number;
    state: string;
    remainingSeconds?: number | null;
    reason?: string;
  }[];
}

export async function cleanupSourceStatuses(): Promise<
  Record<string, SourceCleanupStatus & { planHash: string }>
> {
  try {
    const filename = path.join(
      process.env.CONFIG_DIRECTORY || path.join(__dirname, '../../config'),
      'cleanup-source-state.json'
    );
    const stat = await fs.stat(filename);
    if (stat.size > 5 * 1024 * 1024) throw new Error('Cleanup state too large');
    const report = JSON.parse(await fs.readFile(filename, 'utf8'));
    if (
      report.version !== 1 ||
      !report.reviews ||
      !Number.isFinite(Date.parse(report.updatedAt)) ||
      Date.now() - Date.parse(report.updatedAt) > 10 * 60000
    )
      return {};
    return Object.fromEntries(
      Object.entries(report.reviews).map(([id, value]) => {
        const entry = value as SourceCleanupStatus & { planHash: string };
        // Paths, file identities and private tracker credentials never leave the worker journal.
        return [
          id,
          {
            planHash: entry.planHash,
            state: entry.state,
            remainingBytes: entry.remainingBytes,
            reclaimedBytes: entry.reclaimedBytes,
            reason: entry.reason,
            torrents: entry.torrents,
            checkedAt: report.updatedAt,
          },
        ];
      })
    );
  } catch {
    return {};
  }
}
