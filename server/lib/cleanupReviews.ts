import TheMovieDb from '@server/api/themoviedb';
import { getRepository } from '@server/datasource';
import { CleanupReview } from '@server/entity/CleanupReview';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import { WatchHistory } from '@server/entity/WatchHistory';
import PreparedEmail from '@server/lib/email';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import path from 'path';
import { In } from 'typeorm';
import { cleanupLibraryCandidates } from './cleanupLibrary';
import {
  RETENTION_DAYS,
  assessCleanup,
  assessManualCleanup,
  type CleanupCandidate,
} from './cleanupPolicy';

const previewSecret = randomBytes(32);
const processStartedAt = new Date();
let synchronizeTail: Promise<void> = Promise.resolve();
export type ReviewAction = 'delete' | 'delete-now' | 'keep' | 'reconsider';
export async function manualCleanupCandidates(): Promise<CleanupCandidate[]> {
  const [requests, histories] = await Promise.all([
    getRepository(MediaRequest).find({
      relations: { seasons: true, media: { seasons: true } },
    }),
    getRepository(WatchHistory).find(),
  ]);
  const candidates = await cleanupLibraryCandidates(
    assessManualCleanup(requests, histories)
  );
  const tmdb = new TheMovieDb();
  await Promise.all(
    candidates
      .filter((candidate) => candidate.title.startsWith('#'))
      .map(async (candidate) => {
        try {
          candidate.title =
            candidate.mediaType === 'movie'
              ? (await tmdb.getMovie({ movieId: candidate.tmdbId })).title
              : (await tmdb.getTvShow({ tvId: candidate.tmdbId })).name;
        } catch {
          /* Identity and exact file paths remain visible if metadata is unavailable. */
        }
      })
  );
  return candidates.sort((a, b) => a.title.localeCompare(b.title));
}
export function previewToken(
  review: Pick<CleanupReview, 'id' | 'fingerprint' | 'planHash' | 'status'>,
  userId: number,
  action: ReviewAction,
  expires = Date.now() + 10 * 60000
): string {
  const signature = createHmac('sha256', previewSecret)
    .update(
      JSON.stringify([
        review.id,
        review.fingerprint,
        review.planHash,
        review.status,
        userId,
        action,
        expires,
      ])
    )
    .digest('hex');
  return `${expires}.${signature}`;
}
export function validPreview(
  token: unknown,
  review: CleanupReview,
  userId: number,
  action: ReviewAction
): boolean {
  if (typeof token !== 'string' || !/^\d{13}\.[a-f0-9]{64}$/.test(token))
    return false;
  const expires = Number(token.split('.')[0]);
  if (expires <= Date.now() || expires > Date.now() + 10 * 60000) return false;
  const expected = Buffer.from(previewToken(review, userId, action, expires));
  const received = Buffer.from(token);
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}
export async function cleanupCandidates(): Promise<CleanupCandidate[]> {
  const [requests, histories] = await Promise.all([
    getRepository(MediaRequest).find({ relations: { seasons: true } }),
    getRepository(WatchHistory).find({ relations: { user: true } }),
  ]);
  const tmdb = new TheMovieDb();
  const seasons = new Map<
    string,
    Awaited<ReturnType<TheMovieDb['getTvSeason']>>
  >();
  return cleanupLibraryCandidates(
    await assessCleanup(requests, histories, async (tmdbId, seasonNumber) => {
      const key = `${tmdbId}:${seasonNumber}`;
      if (!seasons.has(key))
        seasons.set(
          key,
          await tmdb.getTvSeason({ tvId: tmdbId, seasonNumber })
        );
      const episodes = seasons.get(key)!.episodes;
      return {
        count: episodes.length,
        hasFutureEpisodes: episodes.some(
          (episode) =>
            !episode.air_date ||
            new Date(episode.air_date).getTime() > Date.now()
        ),
      };
    })
  );
}

export async function synchronizeCleanupReviews(
  candidates: CleanupCandidate[]
): Promise<void> {
  const operation = synchronizeTail.then(() => synchronize(candidates));
  synchronizeTail = operation.catch(() => undefined);
  return operation;
}
async function synchronize(candidates: CleanupCandidate[]): Promise<void> {
  const repository = getRepository(CleanupReview);
  const existing = await repository.find();
  for (const review of existing) {
    if (
      review.status === 'deleting' &&
      review.decidedAt &&
      review.decidedAt < processStartedAt
    ) {
      await repository.update(
        { id: review.id, status: 'deleting' },
        {
          status: 'failed',
          lastError:
            'The server restarted during deletion. Review remaining files before retrying.',
        }
      );
      review.status = 'failed';
    }
    if (
      ['pending', 'failed'].includes(review.status) &&
      !candidates.some(
        (candidate) => candidate.key === review.reviewKey && candidate.eligible
      )
    ) {
      await repository.update(
        { id: review.id, status: review.status },
        { status: 'stale', planJson: null, planHash: null }
      );
      review.status = 'stale';
    }
  }
  for (const candidate of candidates.filter((entry) => entry.eligible)) {
    const review = existing.find((entry) => entry.reviewKey === candidate.key);
    // Keeping a title is persistent until an administrator chooses Reconsider.
    if (
      review?.status === 'kept' ||
      review?.status === 'deleting' ||
      (review?.status === 'deleted' &&
        review.fingerprint === candidate.fingerprint)
    )
      continue;
    if (!review) {
      await repository.save(
        repository.create({
          id: randomUUID(),
          reviewKey: candidate.key,
          mediaType: candidate.mediaType,
          tmdbId: candidate.tmdbId,
          seasonNumber: candidate.seasonNumber ?? null,
          title: candidate.title,
          fingerprint: candidate.fingerprint,
          eligibleAt: new Date(candidate.eligibleAt),
          requesterNames: JSON.stringify(candidate.requesterNames),
          status: 'pending',
        })
      );
    } else if (
      review.fingerprint !== candidate.fingerprint ||
      review.status === 'stale'
    ) {
      const previousStatus = review.status;
      const previousFingerprint = review.fingerprint;
      if (review.status === 'deleted') {
        review.notifiedAt = null;
        review.decidedBy = null;
        review.decidedAt = null;
      }
      review.fingerprint = candidate.fingerprint;
      review.title = candidate.title;
      review.requesterNames = JSON.stringify(candidate.requesterNames);
      review.eligibleAt = new Date(candidate.eligibleAt);
      review.status = 'pending';
      review.planJson = null;
      review.planHash = null;
      review.lastError = null;
      // Existing reminders remain single-send while the candidate is pending.
      await repository.update(
        {
          id: review.id,
          status: previousStatus,
          fingerprint: previousFingerprint,
        },
        {
          fingerprint: review.fingerprint,
          title: review.title,
          requesterNames: review.requesterNames,
          eligibleAt: review.eligibleAt,
          status: 'pending',
          planJson: null,
          planHash: null,
          lastError: null,
          notifiedAt: review.notifiedAt,
          decidedBy: review.decidedBy,
          decidedAt: review.decidedAt,
        }
      );
    }
  }
}

export async function notifyCleanupReviews(): Promise<void> {
  if (process.env.SEERR_CLEANUP_DISABLED === '1') return;
  const settings = getSettings();
  const emailSettings = settings.notifications.agents.email;
  if (!emailSettings.enabled || !settings.main.applicationUrl) return;
  // The original owner receives deletion approvals; requesters receive no deletion email.
  const owner = await getRepository(User).findOne({
    where: { id: 1 },
    relations: { settings: true },
  });
  if (!owner?.hasPermission(Permission.ADMIN) || !owner.email) return;
  const reviews = await getRepository(CleanupReview).find({
    where: { status: In(['pending', 'failed']) },
    order: { eligibleAt: 'ASC' },
  });
  for (const review of reviews
    .filter((entry) => !entry.notifiedAt)
    .slice(0, 20)) {
    const french = (owner.settings?.locale || settings.main.locale).startsWith(
      'fr'
    );
    const label =
      review.title +
      (review.seasonNumber
        ? french
          ? ` · Saison ${review.seasonNumber}`
          : ` · Season ${review.seasonNumber}`
        : '');
    const url = new URL('/admin-tools', settings.main.applicationUrl);
    url.searchParams.set('review', review.id);
    const deleteUrl = new URL(url);
    deleteUrl.searchParams.set('intent', 'delete');
    const keepUrl = new URL(url);
    keepUrl.searchParams.set('intent', 'keep');
    try {
      await new PreparedEmail(emailSettings, owner.settings?.pgpKey).send({
        template: path.join(__dirname, '../templates/email/cleanup-review'),
        message: { to: owner.email },
        locals: {
          french,
          label,
          applicationTitle: settings.main.applicationTitle,
          requesters: JSON.parse(review.requesterNames).join(', '),
          retentionDays: RETENTION_DAYS,
          eligibleAt: new Date(review.eligibleAt).toLocaleDateString(
            french ? 'fr-FR' : 'en-GB'
          ),
          deleteUrl: deleteUrl.toString(),
          keepUrl: keepUrl.toString(),
        },
      });
      review.notifiedAt = new Date();
      review.emailError = null;
      await getRepository(CleanupReview).update(review.id, {
        notifiedAt: review.notifiedAt,
        emailError: null,
      });
    } catch {
      review.emailError =
        'Approval email could not be delivered. The hourly job will retry.';
      await getRepository(CleanupReview).update(review.id, {
        emailError: review.emailError,
      });
      logger.warn('Cleanup approval email failed; retry deferred.', {
        label: 'Cleanup review',
        reviewId: review.id,
      });
    }
  }
}
let running = false;
export async function runCleanupReviewJob(): Promise<void> {
  if (running || process.env.SEERR_CLEANUP_DISABLED === '1') return;
  running = true;
  try {
    await synchronizeCleanupReviews(await cleanupCandidates());
    await notifyCleanupReviews();
  } catch {
    logger.warn('Cleanup eligibility review failed; media kept.', {
      label: 'Cleanup review',
    });
  } finally {
    running = false;
  }
}
