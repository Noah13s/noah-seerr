import { MediaRequestStatus, MediaType } from '@server/constants/media';
import { MediaRequest } from '@server/entity/MediaRequest';
import SeasonRequest from '@server/entity/SeasonRequest';
import { applyDeletedLibraryState, deletedRequestUpdates } from '@server/lib/deletedLibraryState';
import { mediaKey, mediaLock } from '@server/utils/requestLock';
import { getRepository } from '@server/datasource';
import { CleanupReview } from '@server/entity/CleanupReview';
import Media from '@server/entity/Media';
import { cleanupSourceStatuses } from '@server/lib/cleanupLibrary';
import {
  assertCleanupIdle,
  buildCleanupPlan,
  executeCleanupPlan,
} from '@server/lib/cleanupPlan';
import {
  cleanupCandidates,
  manualCleanupCandidates,
  previewToken,
  synchronizeCleanupReviews,
  validPreview,
  type ReviewAction,
} from '@server/lib/cleanupReviews';
import { Permission } from '@server/lib/permissions';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { randomUUID } from 'crypto';
import { Router } from 'express';
import { In } from 'typeorm';

const router = Router();
router.use(isAuthenticated(Permission.ADMIN));
const serialize = (review: CleanupReview) => ({
  id: review.id,
  mediaType: review.mediaType,
  tmdbId: review.tmdbId,
  title: review.title,
  seasonNumber: review.seasonNumber,
  status: review.status,
  eligibleAt: review.eligibleAt,
  requesters: JSON.parse(review.requesterNames),
  notifiedAt: review.notifiedAt,
  emailError: review.emailError,
  decidedBy: review.decidedBy,
  decidedAt: review.decidedAt,
  lastError: review.lastError,
});

router.get('/', async (_req, res, next) => {
  try {
    await synchronizeCleanupReviews(await cleanupCandidates());
    const reviews = await getRepository(CleanupReview).find({
      order: { eligibleAt: 'ASC' },
    });
    const sourceStatuses = await cleanupSourceStatuses();
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      reviews: reviews.map((review) => ({
        ...serialize(review),
        sourceCleanup:
          review.status === 'deleted' &&
          sourceStatuses[review.id]?.planHash === review.planHash
            ? sourceStatuses[review.id]
            : null,
      })),
      manualCandidates: await manualCleanupCandidates(),
    });
  } catch {
    next({
      status: 503,
      message: 'Cleanup reviews could not be refreshed. Media is kept.',
    });
  }
});

router.post('/override-preview', async (req, res, next) => {
  try {
    const key = `${req.body.mediaType}:${req.body.tmdbId}:${req.body.seasonNumber || 0}`;
    const candidate = (await manualCleanupCandidates()).find(
      (entry) => entry.key === key
    );
    if (!candidate)
      return res
        .status(409)
        .json({ message: 'This media is not available in the library.' });
    const media = await Media.getMedia(
      candidate.tmdbId,
      candidate.mediaType === 'movie' ? MediaType.MOVIE : MediaType.TV
    );
    if (!media)
      return res.status(409).json({ message: 'Media could not be verified.' });
    const plan = await buildCleanupPlan(candidate, media);
    if (!plan.files.length)
      return res
        .status(409)
        .json({ message: 'No library files remain to delete.' });
    await assertCleanupIdle(plan);
    const repository = getRepository(CleanupReview);
    let review = await repository.findOne({ where: { reviewKey: key } });
    if (!review) {
      try {
        await repository.insert(
          repository.create({
            id: randomUUID(),
            reviewKey: key,
            mediaType: candidate.mediaType,
            tmdbId: candidate.tmdbId,
            seasonNumber: candidate.seasonNumber || null,
            title: candidate.title,
            fingerprint: candidate.fingerprint,
            requesterNames: JSON.stringify(candidate.requesterNames),
            eligibleAt: new Date(candidate.eligibleAt),
            status: 'stale',
          })
        );
      } catch {
        /* A concurrent preview may already have created the unique review. */
      }
      review = await repository.findOne({ where: { reviewKey: key } });
    }
    if (!review || review.status === 'deleting')
      return res
        .status(409)
        .json({ message: 'This review is already being acted on.' });
    review.planJson = JSON.stringify({
      ...plan,
      overrideFingerprint: candidate.fingerprint,
    });
    review.planHash = plan.hash;
    const saved = await repository.update(
      { id: review.id, status: review.status, fingerprint: review.fingerprint },
      { planJson: review.planJson, planHash: review.planHash }
    );
    if (saved.affected !== 1)
      return res
        .status(409)
        .json({ message: 'This review changed. Open it again.' });
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({
      review: serialize(review),
      action: 'delete-now',
      files: plan.files.map((file) => ({ path: file.path, bytes: file.bytes })),
      bytes: plan.bytes,
      token: previewToken(review, req.user!.id, 'delete-now'),
    });
  } catch (error) {
    next({
      status: 409,
      message:
        error.message || 'This media cannot be deleted safely right now.',
    });
  }
});

router.get('/:id/preview', async (req, res, next) => {
  try {
    const action = req.query.intent as ReviewAction;
    if (!['delete', 'keep', 'reconsider'].includes(action))
      return res.status(400).json({ message: 'Invalid review action.' });
    const repository = getRepository(CleanupReview);
    const review = await repository.findOne({ where: { id: req.params.id } });
    if (!review)
      return res.status(404).json({ message: 'This review no longer exists.' });
    if (['deleted', 'deleting'].includes(review.status))
      return res
        .status(409)
        .json({ message: 'This review has already been acted on.' });
    if (action === 'reconsider' && review.status !== 'kept')
      return res
        .status(409)
        .json({ message: 'This title is not marked to keep.' });
    let plan;
    if (action === 'delete') {
      if (!['pending', 'failed'].includes(review.status))
        return res
          .status(409)
          .json({ message: 'This deletion is not pending approval.' });
      const candidate = (await cleanupCandidates()).find(
        (entry) => entry.key === review.reviewKey && entry.eligible
      );
      if (!candidate || candidate.fingerprint !== review.fingerprint)
        return res.status(409).json({
          message: 'The eligibility rules changed. Refresh the review list.',
        });
      const media = await Media.getMedia(
        review.tmdbId,
        review.mediaType === 'movie' ? MediaType.MOVIE : MediaType.TV
      );
      if (!media)
        return res
          .status(409)
          .json({ message: 'Media could not be verified.' });
      plan = await buildCleanupPlan(candidate, media);
      if (!plan.files.length)
        return res
          .status(409)
          .json({ message: 'No library files remain to delete.' });
      await assertCleanupIdle(plan);
      review.planJson = JSON.stringify(plan);
      review.planHash = plan.hash;
      const saved = await repository.update(
        {
          id: review.id,
          status: review.status,
          fingerprint: review.fingerprint,
        },
        { planJson: review.planJson, planHash: review.planHash }
      );
      if (saved.affected !== 1)
        return res.status(409).json({
          message: 'This review changed while loading. Open it again.',
        });
    }
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({
      review: serialize(review),
      action,
      files:
        plan?.files.map((file) => ({ path: file.path, bytes: file.bytes })) ||
        [],
      bytes: plan?.bytes || 0,
      token: previewToken(review, req.user!.id, action),
    });
  } catch (error) {
    next({
      status: 409,
      message:
        error.message || 'This media cannot be deleted safely right now.',
    });
  }
});

router.post('/:id/decision', async (req, res, next) => {
  let claimed: CleanupReview | undefined;
  try {
    const action = req.body.action as ReviewAction;
    const repository = getRepository(CleanupReview);
    const review = await repository.findOne({ where: { id: req.params.id } });
    if (
      !review ||
      !['delete', 'delete-now', 'keep', 'reconsider'].includes(action)
    )
      return res.status(404).json({ message: 'Invalid review.' });
    if (!validPreview(req.body.token, review, req.user!.id, action))
      return res.status(409).json({
        message:
          'The review changed or expired. Open it again before confirming.',
      });
    if (action === 'keep') {
      const saved = await repository.update(
        { id: review.id, status: In(['pending', 'failed', 'stale']) },
        {
          status: 'kept',
          decidedBy: req.user!.id,
          decidedAt: new Date(),
          lastError: null,
        }
      );
      if (saved.affected !== 1)
        return res.status(409).json({
          message: 'Another administrator already acted on this review.',
        });
      logger.info('Administrator kept media.', {
        label: 'Cleanup review',
        reviewId: review.id,
        userId: req.user!.id,
      });
      return res.json({ status: 'kept' });
    }
    // Serialize the complete eligibility check, file removal and state transition
    // with requests for this title. A new request must not be overwritten by deletion.
    return await mediaLock.dispatch(mediaKey(review.mediaType as MediaType, review.tmdbId), async () => {
    const override = action === 'delete-now';
    const candidate = (
      await (override ? manualCleanupCandidates() : cleanupCandidates())
    ).find(
      (entry) => entry.key === review.reviewKey && (override || entry.eligible)
    );
    if (
      !candidate ||
      (action === 'delete' && candidate.fingerprint !== review.fingerprint)
    )
      return res.status(409).json({
        message:
          'This media no longer meets the rules. Refresh the review list.',
      });
    if (
      override &&
      JSON.parse(review.planJson || '{}').overrideFingerprint !==
        candidate.fingerprint
    )
      return res.status(409).json({
        message:
          'The library changed after your override preview. Review the files again.',
      });
    if (action === 'reconsider') {
      const saved = await repository.update(
        { id: review.id, status: 'kept' },
        {
          status: 'pending',
          fingerprint: candidate.fingerprint,
          eligibleAt: new Date(candidate.eligibleAt),
          requesterNames: JSON.stringify(candidate.requesterNames),
          planJson: null,
          planHash: null,
          decidedBy: null,
          decidedAt: null,
          notifiedAt: null,
        }
      );
      if (saved.affected !== 1)
        return res
          .status(409)
          .json({ message: 'The review has already changed.' });
      return res.json({ status: 'pending' });
    }
    if (process.env.SEERR_CLEANUP_EXECUTION_DISABLED === '1')
      return res.status(403).json({
        message: 'Media deletion is disabled in this test environment.',
      });
    const media = await Media.getMedia(
      review.tmdbId,
      review.mediaType === 'movie' ? MediaType.MOVIE : MediaType.TV
    );
    if (!media)
      return res.status(409).json({ message: 'Media could not be verified.' });
    const plan = await buildCleanupPlan(candidate, media);
    if (!plan.files.length || plan.hash !== review.planHash)
      return res.status(409).json({
        message: 'The files changed. Open a fresh review before deleting them.',
      });
    await assertCleanupIdle(plan);
    const deletionDecidedAt = new Date();
    const saved = await repository.update(
      {
        id: review.id,
        status: In(
          override
            ? ['pending', 'failed', 'kept', 'stale', 'deleted']
            : ['pending', 'failed']
        ),
        fingerprint: review.fingerprint,
        planHash: plan.hash,
      },
      {
        status: 'deleting',
        decidedBy: req.user!.id,
        decidedAt: deletionDecidedAt,
        lastError: null,
      }
    );
    if (saved.affected !== 1)
      return res.status(409).json({
        message: 'Another administrator already acted on this review.',
      });
    claimed = review;
    const fileCount = await executeCleanupPlan(
      plan,
      review.seasonNumber ?? undefined
    );
    applyDeletedLibraryState(media, review.seasonNumber ?? undefined);
    const requests = await getRepository(MediaRequest).find({
      where: { media: { id: media.id } }, relations: ['seasons'],
    });
    const updates = deletedRequestUpdates(requests, review.mediaType === 'movie', review.seasonNumber ?? undefined);
    await getRepository(Media).manager.transaction(async manager => {
      await manager.save(Media, media);
      // The seeding cleanup worker protects requests newer than this decision.
      // Closing an old cycle is part of this decision, not a new media request.
      if (updates.seasonIds.length) await manager.update(SeasonRequest, { id: In(updates.seasonIds) }, { status: MediaRequestStatus.COMPLETED, updatedAt: deletionDecidedAt });
      if (updates.requestIds.length) await manager.update(MediaRequest, { id: In(updates.requestIds) }, { status: MediaRequestStatus.COMPLETED, updatedAt: deletionDecidedAt });
      await manager.update(CleanupReview, review.id, { status: 'deleted' });
    });
    logger.info('Administrator approved library file deletion.', {
      label: 'Cleanup review',
      reviewId: review.id,
      userId: req.user!.id,
      fileCount,
      override,
    });
    return res.json({ status: 'deleted', fileCount });
    });
  } catch (error) {
    if (claimed)
      await getRepository(CleanupReview).update(claimed.id, {
        status: 'failed',
        lastError:
          'Deletion did not fully complete. Some files may already be removed. Refresh the review to inspect remaining files.',
      });
    return next({
      status: 409,
      message:
        error.message || 'Deletion could not complete. Refresh the review.',
    });
  }
});
export default router;
