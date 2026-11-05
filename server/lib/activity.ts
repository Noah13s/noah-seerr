import { getRepository } from '@server/datasource';
import { ActivityEvent } from '@server/entity/ActivityEvent';
import type { User } from '@server/entity/User';
import logger from '@server/logger';
import { LessThan } from 'typeorm';

export const activityText = (value: unknown, max = 200) =>
  typeof value === 'string'
    ? Array.from(value)
        .filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127)
        .join('')
        .slice(0, max)
    : '';
export const userLabel = (user: User) =>
  activityText(
    user.displayName ||
      user.username ||
      user.jellyfinUsername ||
      `User ${user.id}`
  );
let lastMaintenance = 0;
let lastWarning = 0;
export async function recordActivity(
  event: Pick<
    ActivityEvent,
    'userId' | 'userName' | 'category' | 'action' | 'device'
  > &
    Partial<Pick<ActivityEvent, 'title' | 'details'>>
) {
  try {
    const repository = getRepository(ActivityEvent);
    await repository.insert({
      ...event,
      title: activityText(event.title),
      createdAt: new Date(),
    });
    if (Date.now() - lastMaintenance > 3600000) {
      lastMaintenance = Date.now();
      await repository.delete({
        createdAt: LessThan(new Date(Date.now() - 90 * 86400000)),
      });
      const cutoff = await repository.find({
        select: ['id'],
        order: { id: 'DESC' },
        skip: 99999,
        take: 1,
      });
      if (cutoff[0]) await repository.delete({ id: LessThan(cutoff[0].id) });
    }
  } catch {
    if (Date.now() - lastWarning > 60000) {
      lastWarning = Date.now();
      logger.warn(
        'Activity recording unavailable; normal operations continue.',
        { label: 'Activity' }
      );
    }
  }
}

export interface PlaybackObservation {
  position: number;
  paused: boolean;
  audio?: string;
  subtitle?: string;
  at: number;
  item: string;
  title: string;
  device: string;
  method?: string;
}
export function playbackChanges(
  before: PlaybackObservation | undefined,
  after: PlaybackObservation
) {
  const changes: {
    action: string;
    details: Record<string, string | number | boolean>;
  }[] = [];
  if (!before || before.item !== after.item)
    return [
      {
        action: 'playback.started',
        details: {
          position: after.position,
          audio: after.audio ?? 'unknown',
          subtitle: after.subtitle ?? 'unknown',
          method: after.method ?? 'unknown',
        },
      },
    ];
  if (after.paused !== before.paused)
    changes.push({
      action: after.paused ? 'playback.paused' : 'playback.resumed',
      details: { position: after.position },
    });
  const elapsed = Math.max(0, (after.at - before.at) / 1000);
  // Discontinuities are observations, never claims about a deliberate button press.
  if (
    elapsed <= 20 &&
    (after.position < before.position - 3 ||
      after.position > before.position + (before.paused ? 0 : elapsed) + 4)
  )
    changes.push({
      action: 'playback.seeked',
      details: { from: before.position, to: after.position },
    });
  for (const kind of ['audio', 'subtitle'] as const)
    if (
      before[kind] !== undefined &&
      after[kind] !== undefined &&
      before[kind] !== after[kind]
    )
      changes.push({
        action: `playback.${kind}`,
        details: {
          from: before[kind]!,
          to: after[kind]!,
          position: after.position,
        },
      });
  return changes;
}
