import { getRepository } from '@server/datasource';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import { WatchHistory, WatchHistoryStatus } from '@server/entity/WatchHistory';
import { RETENTION_DAYS } from '@server/lib/cleanupPolicy';
import { cleanupCandidates } from '@server/lib/cleanupReviews';
import { Permission } from '@server/lib/permissions';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';
import { readdir, stat, statfs } from 'fs/promises';
import path from 'path';

const router = Router();
let diskCache:
  | { expires: number; value: Awaited<ReturnType<typeof diskSnapshot>> }
  | undefined;

const fileBytes = async (directory: string): Promise<number> => {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return 0;
  }
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) return fileBytes(filename);
      if (!entry.isFile()) return 0;
      try {
        return (await stat(filename)).size;
      } catch {
        return 0;
      }
    })
  );
  return sizes.reduce((sum, size) => sum + size, 0);
};

const diskSnapshot = async () => {
  const volumes = await Promise.all(
    ['/app/config', '/media'].map(async (mount) => {
      try {
        const info = await statfs(mount, { bigint: true });
        return {
          mount,
          total: Number(info.blocks * info.bsize),
          free: Number(info.bavail * info.bsize),
        };
      } catch {
        return { mount, total: 0, free: 0 };
      }
    })
  );
  const libraries = await Promise.all(
    ['films', 'series', 'imports'].map(async (name) => ({
      name,
      bytes: await fileBytes(path.join('/media', name)),
    }))
  );
  return { volumes, libraries };
};

router.get(
  '/insights',
  isAuthenticated(Permission.ADMIN),
  async (_req, res, next) => {
    try {
      const [users, histories, requests] = await Promise.all([
        getRepository(User).find(),
        getRepository(WatchHistory).find({ relations: { user: true } }),
        getRepository(MediaRequest).find({ relations: { seasons: true } }),
      ]);
      const now = Date.now();
      if (!diskCache || diskCache.expires < now) {
        diskCache = {
          value: await diskSnapshot(),
          expires: now + 15 * 60 * 1000,
        };
      }
      const candidates = await cleanupCandidates();
      const userStats = users.map((user) => {
        const personal = histories.filter((item) => item.user.id === user.id);
        return {
          id: user.id,
          name:
            user.displayName ||
            user.username ||
            user.jellyfinUsername ||
            `User ${user.id}`,
          completed: personal.filter(
            (item) => item.status === WatchHistoryStatus.COMPLETED
          ).length,
          watching: personal.filter(
            (item) => item.status === WatchHistoryStatus.WATCHING
          ).length,
          dropped: personal.filter(
            (item) => item.status === WatchHistoryStatus.DROPPED
          ).length,
          rated: personal.filter((item) => item.rating != null).length,
          requests: requests.filter((item) => item.requestedBy?.id === user.id)
            .length,
        };
      });
      res.setHeader('Cache-Control', 'private, no-store');
      return res.json({
        generatedAt: new Date().toISOString(),
        retentionDays: RETENTION_DAYS,
        cleanupMode: 'approval-required',
        disk: diskCache.value,
        totals: {
          users: users.length,
          requests: requests.length,
          watched: histories.filter(
            (item) => item.status === WatchHistoryStatus.COMPLETED
          ).length,
          watching: histories.filter(
            (item) => item.status === WatchHistoryStatus.WATCHING
          ).length,
        },
        users: userStats.sort((a, b) => b.completed - a.completed),
        candidates: candidates.sort((a, b) =>
          a.eligibleAt.localeCompare(b.eligibleAt)
        ),
      });
    } catch (error) {
      return next({ status: 500, message: error.message });
    }
  }
);

export default router;
