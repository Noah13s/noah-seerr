import type { DownloadingItem } from '@server/lib/downloadtracker';
import { readFileSync, statSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';

export const pipelineStages = [
  'searching',
  'metadata',
  'downloading',
  'importing',
  'indexing',
  'paused',
  'stalled',
  'blocked',
  'unavailable',
] as const;
export type PipelineStage = (typeof pipelineStages)[number];
export interface PipelineProgress {
  stage?: PipelineStage;
  reason?: string;
  seasonNumber?: number;
  startedAt?: string;
  lastProgressAt?: string;
  updatedAt?: string;
  searchProgress?: { episodeNumber: number; totalEpisodes: number };
  recoveryAttempts?: number;
}
interface PipelineRecord extends PipelineProgress {
  title?: string;
  mediaType: 'movie' | 'tv';
  serverId: number;
  externalId: number;
  downloadId: string;
  size: number;
  sizeLeft: number;
}
export interface PipelineSnapshot {
  trackerHealth?: TrackerHealth[];
  clientAvailable?: boolean;
  generatedAt?: string;
  fresh: boolean;
  records: PipelineRecord[];
  jobs: {
    downloadId: string;
    title: string;
    seasonNumber?: number;
    stage: string;
    retained: boolean;
    reason: string;
  }[];
}

export interface TrackerHealth {
  id: string;
  name: string;
  budgeted: boolean;
  fresh: boolean;
  reason?: string;
  checkedAt?: string;
  retryAt?: string;
  availableBytes?: number;
  reservedBytes: number;
  reservations: number;
  adapterError?: string;
  monitored?: boolean;
  healthFresh?: boolean;
  healthCheckedAt?: string;
  health?: TrackerAccountDetails;
}

export interface TrackerAccountDetails {
  source?: 'api' | 'website';
  ratio?: number | null;
  credits?: number;
  bufferBytes?: number;
  freeleech?: boolean;
  freeleechUntil?: string;
  hnrCount?: number;
  seedCount?: number;
  activeContracts?: number;
  slotsUnlimited?: boolean;
  slotLimit?: number;
  warnings?: string[];
}

const accountWarnings = new Set([
  'ratio-low',
  'hit-and-run',
  'account-warning',
  'automation-disabled',
  'seed-contracts',
  'acknowledgements-required',
]);
function accountDetails(value: unknown): TrackerAccountDetails {
  const row = object(value) || {};
  const result: TrackerAccountDetails = {};
  if (row.source === 'api' || row.source === 'website')
    result.source = row.source;
  if (row.ratio === null) result.ratio = null;
  else if (
    typeof row.ratio === 'number' &&
    Number.isFinite(row.ratio) &&
    row.ratio >= 0
  )
    result.ratio = row.ratio;
  for (const key of [
    'credits',
    'hnrCount',
    'seedCount',
    'activeContracts',
    'slotLimit',
  ] as const) {
    const value = row[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
      result[key] = value;
  }
  if (
    typeof row.bufferBytes === 'number' &&
    Number.isSafeInteger(row.bufferBytes)
  )
    result.bufferBytes = row.bufferBytes;
  if (typeof row.freeleech === 'boolean') result.freeleech = row.freeleech;
  if (typeof row.slotsUnlimited === 'boolean')
    result.slotsUnlimited = row.slotsUnlimited;
  result.freeleechUntil = date(row.freeleechUntil);
  result.warnings = (Array.isArray(row.warnings) ? row.warnings : [])
    .filter((v): v is string => typeof v === 'string' && accountWarnings.has(v))
    .slice(0, 6);
  return result;
}

function trackerHealth(value: unknown): TrackerHealth[] {
  return (Array.isArray(value) ? value.slice(0, 100) : []).flatMap((value) => {
    const row = object(value);
    if (
      !row ||
      typeof row.id !== 'string' ||
      !/^[a-z0-9_-]{1,64}$/.test(row.id) ||
      typeof row.name !== 'string'
    )
      return [];
    const balance =
      typeof row.availableBytes === 'number' &&
      Number.isSafeInteger(row.availableBytes)
        ? row.availableBytes
        : undefined;
    return [
      {
        id: row.id,
        name: [...row.name]
          .filter(
            (character) =>
              character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127
          )
          .join('')
          .slice(0, 100),
        budgeted: row.budgeted === true,
        fresh: row.fresh === true,
        reason: reasonCode(row.reason),
        checkedAt: date(row.checkedAt),
        retryAt: date(row.retryAt),
        availableBytes: balance,
        reservedBytes: numeric(row.reservedBytes),
        reservations: Math.min(10000, numeric(row.reservations)),
        adapterError: reasonCode(row.adapterError),
        monitored: row.monitored === true,
        healthFresh: row.healthFresh === true,
        healthCheckedAt: date(row.healthCheckedAt),
        health: accountDetails(row.health),
      },
    ];
  });
}

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
const numeric = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
const integer = (value: unknown, minimum: number) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
    ? value
    : undefined;
const date = (value: unknown) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? value
    : undefined;
const reasonCode = (value: unknown) =>
  typeof value === 'string' && /^[a-z-]{1,48}$/.test(value) ? value : undefined;

function searchProgress(value: unknown): PipelineProgress['searchProgress'] {
  const entry = object(value);
  const episode = integer(entry?.episodeNumber, 1),
    total = integer(entry?.totalEpisodes, 1);
  return episode !== undefined && total !== undefined && episode <= total
    ? { episodeNumber: episode, totalEpisodes: total }
    : undefined;
}

function parseRecord(
  value: unknown,
  updatedAt: string
): PipelineRecord | undefined {
  const entry = object(value);
  if (!entry) return undefined;
  const serverId = integer(entry.serverId, 0),
    externalId = integer(entry.externalId, 1);
  if (
    (entry.mediaType !== 'movie' && entry.mediaType !== 'tv') ||
    serverId === undefined ||
    externalId === undefined ||
    !pipelineStages.includes(entry.stage as PipelineStage) ||
    typeof entry.downloadId !== 'string' ||
    entry.downloadId.length > 150
  )
    return undefined;
  const size = numeric(entry.size);
  return {
    mediaType: entry.mediaType,
    serverId,
    externalId,
    downloadId: entry.downloadId,
    title:
      typeof entry.title === 'string' ? entry.title.slice(0, 250) : undefined,
    stage: entry.stage as PipelineStage,
    reason: reasonCode(entry.reason),
    size,
    sizeLeft: Math.min(size, numeric(entry.sizeLeft)),
    seasonNumber: integer(entry.seasonNumber, 1),
    startedAt: date(entry.startedAt),
    lastProgressAt: date(entry.lastProgressAt),
    updatedAt,
    recoveryAttempts: Math.min(3, numeric(entry.recoveryAttempts)),
    searchProgress: searchProgress(entry.searchProgress),
  };
}

function parseJob(
  value: unknown
): PipelineSnapshot['jobs'][number] | undefined {
  const entry = object(value);
  if (
    !entry ||
    typeof entry.downloadId !== 'string' ||
    !/^[a-f0-9]{40}$/.test(entry.downloadId) ||
    !['superseded', 'obsolete', 'blocked', 'held', 'reused'].includes(
      entry.stage as string
    )
  )
    return undefined;
  return {
    downloadId: entry.downloadId,
    title: typeof entry.title === 'string' ? entry.title.slice(0, 250) : '',
    seasonNumber: integer(entry.seasonNumber, 1),
    stage: entry.stage as string,
    retained: true,
    reason: reasonCode(entry.reason) || '',
  };
}

export function parsePipelineSnapshot(
  value: unknown,
  now = Date.now()
): PipelineSnapshot {
  const empty: PipelineSnapshot = { fresh: false, records: [], jobs: [] };
  const raw = object(value);
  if (!raw) return empty;
  const generatedAt = date(raw.generatedAt);
  const at = generatedAt ? Date.parse(generatedAt) : NaN;
  if (
    raw.version !== 1 ||
    !Number.isFinite(at) ||
    at > now + 30000 ||
    now - at > 180000
  )
    return { ...empty, generatedAt };
  const records = (
    Array.isArray(raw.records) ? raw.records.slice(0, 2000) : []
  ).flatMap((value) => {
    const record = parseRecord(value, new Date(at).toISOString());
    return record ? [record] : [];
  });
  const jobs = (Array.isArray(raw.jobs) ? raw.jobs.slice(0, 100) : []).flatMap(
    (value) => {
      const job = parseJob(value);
      return job ? [job] : [];
    }
  );
  return {
    fresh: true,
    trackerHealth: trackerHealth(raw.trackerHealth),
    clientAvailable: raw.clientAvailable !== false,
    generatedAt: new Date(at).toISOString(),
    records,
    jobs,
  };
}

export async function readPipelineSnapshot(): Promise<PipelineSnapshot> {
  try {
    const path =
      process.env.REQUEST_PIPELINE_FILE || '/app/config/request-pipeline.json';
    if ((await stat(path)).size > 2 * 1024 * 1024)
      return parsePipelineSnapshot(null);
    const content = await readFile(path, 'utf8');
    if (content.length > 2 * 1024 * 1024) return parsePipelineSnapshot(null);
    return parsePipelineSnapshot(JSON.parse(content));
  } catch {
    return parsePipelineSnapshot(null);
  }
}

let cache: { path: string; at: number; snapshot: PipelineSnapshot } | undefined;
export function cachedPipelineSnapshot(): PipelineSnapshot {
  const path =
    process.env.REQUEST_PIPELINE_FILE || '/app/config/request-pipeline.json';
  const now = Date.now();
  if (cache?.path === path && now - cache.at < 5000) return cache.snapshot;
  let snapshot = parsePipelineSnapshot(null);
  try {
    if (statSync(path).size <= 2 * 1024 * 1024)
      snapshot = parsePipelineSnapshot(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    /* Missing/stale monitoring must not block the normal Arr queue. */
  }
  cache = { path, at: now, snapshot };
  return snapshot;
}

export function mergePipelineProgress(
  queue: DownloadingItem[],
  snapshot: PipelineSnapshot,
  mediaType: 'movie' | 'tv',
  serverId: number,
  externalId: number
): DownloadingItem[] {
  const records = snapshot.records.filter(
    (row) =>
      row.mediaType === mediaType &&
      row.serverId === serverId &&
      row.externalId === externalId
  );
  const superseded = new Set(
    snapshot.jobs
      .filter((job) => job.stage === 'superseded')
      .map((job) => job.downloadId)
  );
  const queued = queue
    .filter((item) => !superseded.has(item.downloadId.toLowerCase()))
    .map((item) => {
      const record = records.find(
        (row) => row.downloadId.toLowerCase() === item.downloadId?.toLowerCase()
      );
      return record
        ? { ...item, ...record, mediaType: item.mediaType, title: item.title }
        : item;
    });
  const missing = records.filter(
    (row) =>
      !queued.some(
        (item) => item.downloadId.toLowerCase() === row.downloadId.toLowerCase()
      )
  );
  // Synthetic rows represent real searching/blocked work before a torrent exists.
  return [
    ...queued,
    ...missing.map((row) => ({
      ...row,
      mediaType: mediaType as DownloadingItem['mediaType'],
      status: row.stage || 'searching',
      timeLeft: '',
      estimatedCompletionTime: new Date(NaN),
      title: row.title || '',
    })),
  ];
}
