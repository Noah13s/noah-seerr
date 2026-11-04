import type { DownloadingItem } from '@server/lib/downloadtracker';
import type { PipelineStage } from '@server/lib/requestPipeline';

export function requestStage(item: DownloadingItem): PipelineStage {
  if (item.stage) return item.stage;
  if (/paused|stopped/i.test(item.status)) return 'paused';
  if (/warning|error|failed/i.test(item.status)) return 'blocked';
  return item.size > 0 && item.sizeLeft <= 0 ? 'importing' : 'downloading';
}

export function requestPercent(item: DownloadingItem): number | undefined {
  if (
    !['downloading', 'stalled', 'paused', 'blocked'].includes(
      requestStage(item)
    ) ||
    !Number.isFinite(item.size) ||
    !Number.isFinite(item.sizeLeft) ||
    item.size <= 0
  )
    return undefined;
  return Math.max(
    0,
    Math.min(100, Math.round((1 - item.sizeLeft / item.size) * 100))
  );
}

export function pipelineSummary(
  items: DownloadingItem[]
): DownloadingItem | undefined {
  const order: PipelineStage[] = [
    'downloading',
    'importing',
    'indexing',
    'metadata',
    'searching',
    'stalled',
    'blocked',
    'paused',
    'unavailable',
  ];
  return [...items].sort(
    (a, b) => order.indexOf(requestStage(a)) - order.indexOf(requestStage(b))
  )[0];
}

export function elapsedMinutes(item: DownloadingItem): number | undefined {
  const start = Date.parse(item.startedAt || '');
  const end = Date.parse(item.updatedAt || '');
  return Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? Math.floor((end - start) / 60000)
    : undefined;
}
