import PlexTvAPI from '@server/api/plextv';
import TheMovieDb from '@server/api/themoviedb';
import { ANIME_KEYWORD_ID } from '@server/api/themoviedb/constants';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { WatchHistory, WatchHistoryStatus } from '@server/entity/WatchHistory';
import { Watchlist } from '@server/entity/Watchlist';
import type {
  WatchHistoryItem,
  WatchHistoryPublicRatingsResponse,
  WatchHistoryResponse,
  WatchHistorySummaryResponse,
} from '@server/interfaces/api/watchHistoryInterfaces';
import { applyPlaybackReport } from '@server/lib/viewingProgress';
import logger from '@server/logger';
import { Router } from 'express';
import { Not } from 'typeorm';
import { z } from 'zod';

const watchHistoryRoutes = Router();

const publicRatingCache = new Map<
  string,
  { value: WatchHistoryPublicRatingsResponse[string]; expiresAt: number }
>();
const RATING_CACHE_MS = 12 * 60 * 60 * 1000;
const RATING_ERROR_CACHE_MS = 10 * 60 * 1000;

type TmdbKey = { mediaType: 'movie' | 'tv'; tmdbId: number };

const getPublicMetadata = async (keys: Map<string, TmdbKey>) => {
  const tmdb = new TheMovieDb();
  const response: WatchHistoryPublicRatingsResponse = {};
  const pending = [...keys];
  // Bound concurrent TMDB lookups so large collections do not flood it.
  const worker = async () => {
    for (;;) {
      const nextRating = pending.shift();
      if (!nextRating) return;
      const [key, media] = nextRating;
      const cached = publicRatingCache.get(key);
      if (cached && cached.expiresAt > Date.now()) {
        response[key] = cached.value;
        continue;
      }
      try {
        const details =
          media.mediaType === 'movie'
            ? await tmdb.getMovie({ movieId: media.tmdbId, language: 'en' })
            : await tmdb.getTvShow({ tvId: media.tmdbId, language: 'en' });
        const releaseDate =
          media.mediaType === 'movie'
            ? (details as Awaited<ReturnType<TheMovieDb['getMovie']>>)
                .release_date
            : (details as Awaited<ReturnType<TheMovieDb['getTvShow']>>)
                .first_air_date;
        const nextAirDate =
          media.mediaType === 'tv'
            ? ((details as Awaited<ReturnType<TheMovieDb['getTvShow']>>)
                .next_episode_to_air?.air_date ?? null)
            : null;
        const status = details.status;
        const keywords = details.keywords
          ? 'keywords' in details.keywords
            ? details.keywords.keywords
            : details.keywords.results
          : [];
        const isAnime =
          keywords.some((keyword) => keyword.id === ANIME_KEYWORD_ID) ||
          (details.original_language === 'ja' &&
            details.genres?.some((genre) => genre.id === 16) === true);
        const upcomingDate =
          nextAirDate && nextAirDate > new Date().toISOString().slice(0, 10)
            ? nextAirDate
            : releaseDate;
        const upcoming = upcomingDate
          ? /^\d{4}-\d{2}-\d{2}$/.test(upcomingDate) &&
            upcomingDate > new Date().toISOString().slice(0, 10)
          : media.mediaType === 'movie'
            ? [
                'Rumored',
                'Planned',
                'In Production',
                'Post Production',
              ].includes(status)
            : ['Planned', 'In Production'].includes(status);
        const value = {
          average:
            Number.isFinite(details.vote_average) && details.vote_count > 0
              ? details.vote_average
              : null,
          votes: details.vote_count ?? 0,
          releaseDate: releaseDate || null,
          nextAirDate,
          upcoming,
          isAnime,
        };
        response[key] = value;
        publicRatingCache.set(key, {
          value,
          expiresAt: Date.now() + RATING_CACHE_MS,
        });
      } catch (error) {
        logger.debug('Unable to retrieve public watch history metadata', {
          label: 'Watch History',
          media: key,
          errorMessage: error.message,
        });
        response[key] = null;
        publicRatingCache.set(key, {
          value: null,
          expiresAt: Date.now() + RATING_ERROR_CACHE_MS,
        });
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(6, pending.length) }, worker)
  );
  return response;
};

const optionalText = z
  .string()
  .trim()
  .max(4000)
  .nullish()
  .transform((value) => value || null);

const historyInput = z.object({
  mediaType: z.enum(['movie', 'tv']),
  tmdbId: z.coerce.number().int().positive().nullish(),
  title: z.string().trim().min(1).max(255),
  releaseYear: z.coerce.number().int().min(1870).max(2200).nullish(),
  status: z
    .enum([
      WatchHistoryStatus.WATCHING,
      WatchHistoryStatus.COMPLETED,
      WatchHistoryStatus.DROPPED,
    ])
    .default(WatchHistoryStatus.WATCHING),
  watchCount: z.coerce.number().int().min(0).max(10000).default(0),
  watchedAt: z.coerce.date().nullish(),
  watchedEpisodes: z.coerce.number().int().min(0).max(100000).nullish(),
  totalEpisodes: z.coerce.number().int().min(0).max(100000).nullish(),
  seasonProgress: z
    .record(
      z.string().regex(/^\d+$/),
      z.coerce.number().int().min(0).max(10000)
    )
    .default({}),
  episodeOverrides: z
    .record(z.string().regex(/^\d+:\d+$/), z.boolean())
    .optional(),
  categories: optionalText,
  rating: z.coerce.number().int().min(1).max(5).nullish(),
  priority: z.coerce.number().int().min(0).max(10).nullish(),
  series: optionalText,
  notes: optionalText,
});

const listInput = z.object({
  take: z.coerce.number().int().positive().max(1000).default(1000),
  skip: z.coerce.number().int().nonnegative().default(0),
  search: z.string().trim().optional(),
  status: z.nativeEnum(WatchHistoryStatus).optional(),
  mediaType: z.enum(['movie', 'tv']).optional(),
  active: z.enum(['1']).optional(),
});

const toItem = (entry: WatchHistory): WatchHistoryItem => ({
  id: entry.id,
  mediaType: entry.mediaType,
  tmdbId: entry.tmdbId,
  title: entry.title,
  releaseYear: entry.releaseYear,
  status: entry.status,
  watchCount: entry.watchCount,
  watchedAt: entry.watchedAt,
  watchedEpisodes: entry.watchedEpisodes,
  totalEpisodes: entry.totalEpisodes,
  seasonProgress: entry.seasonProgress ?? {},
  episodeOverrides: entry.episodeOverrides ?? {},
  viewingProgress: entry.viewingProgress ?? {},
  categories: entry.categories,
  rating: entry.rating,
  priority: entry.priority,
  series: entry.series,
  notes: entry.notes,
  createdAt: entry.createdAt,
  updatedAt: entry.updatedAt,
});

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();

const resolveTmdbId = async (
  mediaType: 'movie' | 'tv',
  title: string,
  releaseYear?: number | null
): Promise<number | null> => {
  const tmdb = new TheMovieDb();
  const response =
    mediaType === 'movie'
      ? await tmdb.searchMovies({
          query: title,
          year: releaseYear ?? undefined,
        })
      : await tmdb.searchTvShows({
          query: title,
          year: releaseYear ?? undefined,
        });
  const expected = normalize(title);
  const exact = response.results.find((result) => {
    const names =
      mediaType === 'movie'
        ? [
            (result as { title: string; original_title: string }).title,
            (result as { title: string; original_title: string })
              .original_title,
          ]
        : [
            (result as { name: string; original_name: string }).name,
            (result as { name: string; original_name: string }).original_name,
          ];
    return names.some((name) => normalize(name) === expected);
  });
  return exact?.id ?? null;
};

watchHistoryRoutes.get('/', async (req, res, next) => {
  try {
    const { take, skip, search, status, mediaType, active } = listInput.parse(
      req.query
    );
    let query = getRepository(WatchHistory)
      .createQueryBuilder('history')
      .where('history.userId = :userId', { userId: req.user!.id })
      .andWhere('history.status != :planned', {
        planned: WatchHistoryStatus.PLANNED,
      });
    if (search) {
      query = query.andWhere(
        '(LOWER(history.title) LIKE LOWER(:search) OR LOWER(history.notes) LIKE LOWER(:search) OR LOWER(history.categories) LIKE LOWER(:search))',
        { search: `%${search}%` }
      );
    }
    if (active || status === WatchHistoryStatus.WATCHING) {
      query = query.andWhere(
        '(history.status = :watching OR history.viewingProgress LIKE :activeRun)',
        {
          watching: WatchHistoryStatus.WATCHING,
          activeRun: '%"completed":false%',
        }
      );
    } else if (status)
      query = query.andWhere('history.status = :status', { status });
    if (mediaType)
      query = query.andWhere('history.mediaType = :mediaType', { mediaType });

    const [entries, count] = await query
      .orderBy(
        active ? 'history.updatedAt' : 'history.watchedAt',
        'DESC',
        'NULLS LAST'
      )
      .addOrderBy('history.updatedAt', 'DESC')
      .take(take)
      .skip(skip)
      .getManyAndCount();

    return res.json({
      pageInfo: {
        pages: Math.ceil(count / take),
        pageSize: take,
        results: count,
        page: Math.floor(skip / take) + 1,
      },
      results: entries.map(toItem),
    } as WatchHistoryResponse);
  } catch (error) {
    logger.error('Unable to retrieve watch history', {
      label: 'Watch History',
      errorMessage: error.message,
    });
    return next({ status: 400, message: error.message });
  }
});

watchHistoryRoutes.get('/summary', async (req, res, next) => {
  try {
    const entries = await getRepository(WatchHistory)
      .createQueryBuilder('history')
      .where('history.userId = :userId', { userId: req.user!.id })
      .andWhere('history.tmdbId IS NOT NULL')
      .andWhere('history.status != :planned', {
        planned: WatchHistoryStatus.PLANNED,
      })
      .orderBy('history.updatedAt', 'DESC')
      .getMany();

    const summary: WatchHistorySummaryResponse = {};
    for (const entry of entries) {
      const key = `${entry.mediaType}:${entry.tmdbId}`;
      if (summary[key] || !entry.tmdbId) continue;
      summary[key] = {
        id: entry.id,
        mediaType: entry.mediaType,
        tmdbId: entry.tmdbId,
        title: entry.title,
        releaseYear: entry.releaseYear,
        status: entry.status,
        watchCount: entry.watchCount,
        watchedAt: entry.watchedAt,
        seasonProgress: entry.seasonProgress ?? {},
        episodeOverrides: entry.episodeOverrides ?? {},
        viewingProgress: entry.viewingProgress ?? {},
        rating: entry.rating,
        categories: entry.categories,
        priority: entry.priority,
        series: entry.series,
        notes: entry.notes,
      };
    }

    return res.json(summary);
  } catch (error) {
    logger.error('Unable to retrieve watch history summary', {
      label: 'Watch History',
      errorMessage: error.message,
    });
    return next({ status: 500, message: error.message });
  }
});

watchHistoryRoutes.get('/public-ratings', async (req, res, next) => {
  try {
    const entries = await getRepository(WatchHistory).find({
      where: {
        user: { id: req.user!.id },
        status: Not(WatchHistoryStatus.PLANNED),
      },
      select: ['mediaType', 'tmdbId'],
    });
    const keys = new Map<string, TmdbKey>();
    for (const entry of entries) {
      if (entry.tmdbId) {
        keys.set(`${entry.mediaType}:${entry.tmdbId}`, {
          mediaType: entry.mediaType,
          tmdbId: entry.tmdbId,
        });
      }
    }
    const response = await getPublicMetadata(keys);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json(response);
  } catch (error) {
    logger.error('Unable to retrieve public watch history ratings', {
      label: 'Watch History',
      errorMessage: error.message,
    });
    return next({ status: 500, message: error.message });
  }
});

watchHistoryRoutes.get('/planned-metadata', async (req, res, next) => {
  try {
    const user = await getRepository(User).findOne({
      where: { id: req.user!.id },
      select: ['id', 'plexToken'],
    });
    if (!user) return next({ status: 404, message: 'Profile not found.' });

    const keys = new Map<string, TmdbKey>();
    if (user.plexToken) {
      const watchlist = await new PlexTvAPI(user.plexToken).getWatchlist({
        offset: 0,
        size: 1000,
      });
      watchlist.items.forEach((item) => {
        const mediaType = item.type === 'show' ? 'tv' : 'movie';
        if (item.tmdbId) {
          keys.set(`${mediaType}:${item.tmdbId}`, {
            mediaType,
            tmdbId: item.tmdbId,
          });
        }
      });
    } else {
      const watchlist = await getRepository(Watchlist).find({
        where: { requestedBy: { id: user.id } },
        select: ['mediaType', 'tmdbId'],
      });
      watchlist.forEach((item) => {
        if (item.tmdbId) {
          keys.set(`${item.mediaType}:${item.tmdbId}`, {
            mediaType: item.mediaType,
            tmdbId: item.tmdbId,
          });
        }
      });
    }

    const watching = await getRepository(WatchHistory).find({
      where: {
        user: { id: user.id },
        mediaType: 'tv',
        status: WatchHistoryStatus.WATCHING,
      },
      select: ['mediaType', 'tmdbId'],
    });
    watching.forEach((item) => {
      if (item.tmdbId)
        keys.set(`tv:${item.tmdbId}`, { mediaType: 'tv', tmdbId: item.tmdbId });
    });

    const response = await getPublicMetadata(keys);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json(response);
  } catch (error) {
    logger.error('Unable to retrieve planned media metadata', {
      label: 'Watch History',
      errorMessage: error.message,
    });
    return next({ status: 500, message: error.message });
  }
});

// Serialize reports for the same profile/title. Concurrent tabs and final
// progress events must not overwrite one another or count completion twice.
const playbackLocks = new Map<string, Promise<unknown>>();
async function serializePlayback<T>(
  key: string,
  action: () => Promise<T>
): Promise<T> {
  const pending = (playbackLocks.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(action);
  playbackLocks.set(key, pending);
  try {
    return await pending;
  } finally {
    if (playbackLocks.get(key) === pending) playbackLocks.delete(key);
  }
}
watchHistoryRoutes.post('/playback', async (req, res, next) => {
  try {
    const input = z
      .object({
        mediaType: z.enum(['movie', 'tv']),
        tmdbId: z.number().int().positive(),
        title: z.string().trim().min(1).max(255),
        releaseYear: z.number().int().min(1870).max(2200).optional(),
        sessionId: z.string().regex(/^[a-zA-Z0-9-]{16,64}$/),
        position: z.number().finite().min(15).max(86400),
        duration: z.number().finite().min(15).max(86400),
        seasonNumber: z.number().int().min(0).max(1000).optional(),
        episodeNumber: z.number().int().positive().max(10000).optional(),
      })
      .refine(
        (value) =>
          value.position <= value.duration + 10 &&
          (value.mediaType === 'movie' ||
            (value.seasonNumber !== undefined &&
              value.episodeNumber !== undefined)),
        'A valid duration and episode identity are required'
      )
      .parse(req.body);
    const key = `${req.user!.id}:${input.mediaType}:${input.tmdbId}`;
    return res.json(
      await serializePlayback(key, async () => {
        const repository = getRepository(WatchHistory);
        let entry = await repository.findOne({
          where: {
            user: { id: req.user!.id },
            mediaType: input.mediaType,
            tmdbId: input.tmdbId,
          },
          order: { updatedAt: 'DESC' },
        });
        entry ??= new WatchHistory({
          user: req.user!,
          mediaType: input.mediaType,
          tmdbId: input.tmdbId,
          title: input.title,
          releaseYear: input.releaseYear ?? null,
          status: WatchHistoryStatus.WATCHING,
          watchCount: 0,
          seasonProgress: {},
          episodeOverrides: {},
          viewingProgress: {},
        });
        applyPlaybackReport(entry, input);
        return toItem(await repository.save(entry));
      })
    );
  } catch (error) {
    return next({ status: 400, message: error.message });
  }
});

watchHistoryRoutes.delete('/:id/rewatch', async (req, res, next) => {
  try {
    const repository = getRepository(WatchHistory);
    const where = { id: Number(req.params.id), user: { id: req.user!.id } };
    const entry = await repository.findOne({ where });
    if (!entry)
      return next({ status: 404, message: 'History entry not found.' });
    const key = `${req.user!.id}:${entry.mediaType}:${entry.tmdbId}`;
    const saved = await serializePlayback(key, async () => {
      const latest = await repository.findOneOrFail({ where });
      latest.viewingProgress = Object.fromEntries(
        Object.entries(latest.viewingProgress ?? {}).map(([key, run]) => [
          key,
          run.rewatching ? { ...run, completed: true } : run,
        ])
      );
      return toItem(await repository.save(latest));
    });
    return res.json(saved);
  } catch (error) {
    return next({ status: 400, message: error.message });
  }
});

watchHistoryRoutes.patch('/:id/rating', async (req, res, next) => {
  try {
    const { rating } = z
      .object({ rating: z.number().int().min(1).max(5) })
      .parse(req.body);
    const repository = getRepository(WatchHistory);
    const entry = await repository.findOne({
      where: { id: Number(req.params.id), user: { id: req.user!.id } },
    });
    if (!entry)
      return next({ status: 404, message: 'History entry not found.' });
    const key = `${req.user!.id}:${entry.mediaType}:${entry.tmdbId}`;
    return res.json(
      await serializePlayback(key, async () => {
        await repository.update(entry.id, { rating });
        return { rating };
      })
    );
  } catch (error) {
    return next({ status: 400, message: error.message });
  }
});

watchHistoryRoutes.put('/episode', async (req, res, next) => {
  try {
    const input = z
      .object({
        tmdbId: z.number().int().positive(),
        title: z.string().trim().min(1).max(255),
        seasonNumber: z.number().int().min(0),
        episodeNumber: z.number().int().positive(),
        watched: z.boolean(),
      })
      .parse(req.body);
    const key = `${req.user!.id}:tv:${input.tmdbId}`;
    return await serializePlayback(key, async () => {
      const repository = getRepository(WatchHistory);
      let entry = await repository.findOne({
        where: {
          user: { id: req.user!.id },
          mediaType: 'tv',
          tmdbId: input.tmdbId,
        },
        order: { updatedAt: 'DESC' },
      });
      if (!entry && !input.watched) return res.status(204).send();
      if (!entry) {
        entry = new WatchHistory({
          user: req.user!,
          mediaType: 'tv',
          tmdbId: input.tmdbId,
          title: input.title,
          status: WatchHistoryStatus.WATCHING,
          watchCount: 0,
          seasonProgress: {},
          episodeOverrides: {},
        });
      }
      entry.episodeOverrides = {
        ...(entry.episodeOverrides ?? {}),
        [`${input.seasonNumber}:${input.episodeNumber}`]: input.watched,
      };
      if (input.watched) {
        if (entry.status === WatchHistoryStatus.PLANNED) {
          entry.status = WatchHistoryStatus.WATCHING;
        }
        entry.watchedAt = new Date();
      } else if (entry.status === WatchHistoryStatus.COMPLETED) {
        entry.status = WatchHistoryStatus.WATCHING;
      }
      await repository.save(entry);
      return res.json(toItem(entry));
    });
  } catch (error) {
    return next({ status: 400, message: error.message });
  }
});

watchHistoryRoutes.post('/', async (req, res, next) => {
  try {
    const values = historyInput.parse(req.body);
    const tmdbId =
      values.tmdbId ??
      (await resolveTmdbId(values.mediaType, values.title, values.releaseYear));
    const entry = new WatchHistory({
      ...values,
      tmdbId,
      user: req.user!,
      episodeOverrides: values.episodeOverrides ?? {},
    });
    await getRepository(WatchHistory).save(entry);
    return res.status(201).json(toItem(entry));
  } catch (error) {
    return next({ status: 400, message: error.message });
  }
});

watchHistoryRoutes.put('/:id', async (req, res, next) => {
  try {
    const repository = getRepository(WatchHistory);
    const entry = await repository.findOne({
      where: { id: Number(req.params.id), user: { id: req.user!.id } },
    });
    if (!entry) return next({ status: 404, message: 'Élément introuvable.' });
    const values = historyInput.parse(req.body);
    const key = `${req.user!.id}:${entry.mediaType}:${entry.tmdbId}`;
    return await serializePlayback(key, async () => {
      const latest = await repository.findOneOrFail({
        where: { id: entry.id, user: { id: req.user!.id } },
      });
      // The manual "Watched again" action completes the current movie pass too.
      if (
        latest.mediaType === 'movie' &&
        values.watchCount > latest.watchCount &&
        latest.viewingProgress?.movie
      ) {
        latest.viewingProgress.movie = {
          ...latest.viewingProgress.movie,
          completed: true,
          watchCount: values.watchCount,
        };
      }
      Object.assign(latest, values);
      await repository.save(latest);
      return res.json(toItem(latest));
    });
  } catch (error) {
    return next({ status: 400, message: error.message });
  }
});

watchHistoryRoutes.delete('/:id', async (req, res, next) => {
  try {
    const repository = getRepository(WatchHistory);
    const result = await repository.delete({
      id: Number(req.params.id),
      user: { id: req.user!.id },
    });
    if (!result.affected)
      return next({ status: 404, message: 'Élément introuvable.' });
    return res.status(204).send();
  } catch (error) {
    return next({ status: 400, message: error.message });
  }
});

export default watchHistoryRoutes;
