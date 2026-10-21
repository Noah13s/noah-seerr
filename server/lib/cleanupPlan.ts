import ServarrBase from '@server/api/servarr/base';
import type Media from '@server/entity/Media';
import type { DVRSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import axios, { type AxiosInstance } from 'axios';
import path from 'path';
import type { CleanupCandidate } from './cleanupPolicy';
import { digest } from './cleanupPolicy';

export interface CleanupFile {
  kind: 'radarr' | 'sonarr';
  serverId: number;
  itemId: number;
  fileId: number;
  path: string;
  bytes: number;
  added: string;
  episodeIds: number[];
}
export interface CleanupPlan {
  files: CleanupFile[];
  hash: string;
  bytes: number;
}
interface ArrFile {
  id: number;
  path?: string;
  relativePath?: string;
  size: number;
  dateAdded?: string;
}
interface ArrEpisode {
  id: number;
  seasonNumber: number;
  episodeFileId: number;
}
interface ArrItem {
  id: number;
  tmdbId?: number;
  tvdbId?: number;
  path: string;
  monitored: boolean;
  movieFile?: ArrFile;
  seasons?: { seasonNumber: number; monitored: boolean }[];
}
export const cleanupClient = (
  kind: CleanupFile['kind'],
  serverId: number
): AxiosInstance => {
  const server = getSettings()[kind].find((entry) => entry.id === serverId);
  if (!server)
    throw new Error(
      'The media server configuration changed. Refresh the review.'
    );
  return axios.create({
    baseURL: ServarrBase.buildUrl(server, '/api/v3'),
    timeout: 20000,
    headers: { 'X-Api-Key': server.apiKey },
  });
};
export type CleanupClientFactory = typeof cleanupClient;
const filePath = (root: string, file: ArrFile): string => {
  const normalized = path.posix.normalize(
    file.path || path.posix.join(root, file.relativePath || '')
  );
  if (
    !root.startsWith('/') ||
    !normalized.startsWith(path.posix.normalize(root).replace(/\/$/, '') + '/')
  ) {
    throw new Error(
      'A media file is outside its library folder. Manual review is required.'
    );
  }
  return normalized;
};
export async function buildCleanupPlan(
  candidate: Pick<CleanupCandidate, 'mediaType' | 'tmdbId' | 'seasonNumber'>,
  media: Pick<Media, 'tvdbId'>,
  servers: { radarr: DVRSettings[]; sonarr: DVRSettings[] } = getSettings(),
  clientFactory: CleanupClientFactory = cleanupClient
): Promise<CleanupPlan> {
  const files: CleanupFile[] = [];
  const kind = candidate.mediaType === 'movie' ? 'radarr' : 'sonarr';
  if (kind === 'sonarr' && !media.tvdbId)
    throw new Error('The series identity could not be verified.');
  for (const server of servers[kind]) {
    const client = clientFactory(kind, server.id);
    const { data: items } = await client.get<ArrItem[]>(
      kind === 'radarr' ? '/movie' : '/series',
      { params: kind === 'radarr' ? { tmdbId: candidate.tmdbId } : undefined }
    );
    for (const item of items.filter((entry) =>
      kind === 'radarr'
        ? entry.tmdbId === candidate.tmdbId
        : entry.tvdbId === media.tvdbId
    )) {
      if (kind === 'radarr') {
        if (item.movieFile?.id && item.movieFile.size > 0)
          files.push({
            kind,
            serverId: server.id,
            itemId: item.id,
            fileId: item.movieFile.id,
            path: filePath(item.path, item.movieFile),
            bytes: item.movieFile.size,
            added: item.movieFile.dateAdded || '',
            episodeIds: [],
          });
      } else {
        const [{ data: episodes }, { data: episodeFiles }] = await Promise.all([
          client.get<ArrEpisode[]>('/episode', {
            params: { seriesId: item.id },
          }),
          client.get<ArrFile[]>('/episodefile', {
            params: { seriesId: item.id },
          }),
        ]);
        const targetIds = new Set(
          episodes
            .filter(
              (episode) =>
                episode.seasonNumber === candidate.seasonNumber &&
                episode.episodeFileId > 0
            )
            .map((episode) => episode.episodeFileId)
        );
        for (const file of episodeFiles.filter((entry) =>
          targetIds.has(entry.id)
        )) {
          const associated = episodes.filter(
            (episode) => episode.episodeFileId === file.id
          );
          if (
            associated.some(
              (episode) => episode.seasonNumber !== candidate.seasonNumber
            )
          ) {
            throw new Error(
              'A file contains episodes from another season. Manual review is required.'
            );
          }
          files.push({
            kind,
            serverId: server.id,
            itemId: item.id,
            fileId: file.id,
            path: filePath(item.path, file),
            bytes: file.size,
            added: file.dateAdded || '',
            episodeIds: associated
              .map((episode) => episode.id)
              .sort((a, b) => a - b),
          });
        }
      }
    }
  }
  const sorted = files.sort((a, b) =>
    `${a.kind}:${a.serverId}:${a.fileId}`.localeCompare(
      `${b.kind}:${b.serverId}:${b.fileId}`
    )
  );
  return {
    files: sorted,
    hash: digest(sorted),
    bytes: sorted.reduce((sum, file) => sum + file.bytes, 0),
  };
}

export async function assertCleanupIdle(
  plan: CleanupPlan,
  clientFactory: CleanupClientFactory = cleanupClient
): Promise<void> {
  const groups = new Map(
    plan.files.map((file) => [
      `${file.kind}:${file.serverId}:${file.itemId}`,
      file,
    ])
  );
  for (const file of groups.values()) {
    const { data: queue } = await clientFactory(file.kind, file.serverId).get<{
      totalRecords: number;
      records: { movieId?: number; seriesId?: number }[];
    }>('/queue', {
      params: {
        pageSize: 1000,
        includeUnknownMovieItems: true,
        includeUnknownSeriesItems: true,
      },
    });
    if (
      !Array.isArray(queue.records) ||
      queue.totalRecords > queue.records.length ||
      queue.records.some(
        (record) =>
          (file.kind === 'radarr' ? record.movieId : record.seriesId) ===
          file.itemId
      )
    ) {
      throw new Error(
        'This media has a download or import in progress. Try again when it finishes.'
      );
    }
  }
  const settings = getSettings().jellyfin;
  if (!settings.apiKey)
    throw new Error('Active playback could not be checked.');
  const url = `${settings.useSsl ? 'https' : 'http'}://${settings.ip}:${settings.port}${settings.urlBase || ''}`;
  const { data: sessions } = await axios.get<
    { NowPlayingItem?: { Path?: string; Id: string } }[]
  >(url + '/Sessions', {
    timeout: 15000,
    headers: { Authorization: `MediaBrowser Token="${settings.apiKey}"` },
  });
  if (!Array.isArray(sessions))
    throw new Error('Active playback could not be checked.');
  for (const session of sessions.filter((entry) => entry.NowPlayingItem)) {
    const item = session.NowPlayingItem!;
    const { data: details } = item.Path
      ? { data: item }
      : await axios.get<{ Path?: string; MediaSources?: { Path?: string }[] }>(
          url + `/Items/${item.Id}`,
          {
            timeout: 15000,
            headers: {
              Authorization: `MediaBrowser Token="${settings.apiKey}"`,
            },
          }
        );
    const paths = [
      details.Path,
      ...('MediaSources' in details
        ? details.MediaSources?.map((source) => source.Path) || []
        : []),
    ].filter(Boolean);
    if (!paths.length)
      throw new Error(
        'An active playback file could not be identified. Try again after playback stops.'
      );
    if (
      paths.some((filename) =>
        plan.files.some(
          (file) =>
            file.path === filename ||
            file.path.replace(/^\/srv\/media\//, '/media/') === filename
        )
      )
    ) {
      throw new Error(
        'Someone is playing this media, or has it paused. Try again after they exit the player.'
      );
    }
  }
}

export async function executeCleanupPlan(
  plan: CleanupPlan,
  seasonNumber?: number,
  clientFactory: CleanupClientFactory = cleanupClient
): Promise<number> {
  if (!plan.files.length) throw new Error('No library files remain to delete.');
  // Unmonitor every affected movie/season before deleting the first file.
  const groups = new Map(
    plan.files.map((file) => [
      `${file.kind}:${file.serverId}:${file.itemId}`,
      file,
    ])
  );
  for (const file of groups.values()) {
    const client = clientFactory(file.kind, file.serverId);
    const endpoint = file.kind === 'radarr' ? '/movie' : '/series';
    const { data: item } = await client.get<ArrItem>(
      `${endpoint}/${file.itemId}`
    );
    if (file.kind === 'radarr')
      await client.put(`${endpoint}/${file.itemId}`, {
        ...item,
        monitored: false,
      });
    else {
      await client.put(`${endpoint}/${file.itemId}`, {
        ...item,
        seasons: item.seasons?.map((season) =>
          season.seasonNumber === seasonNumber
            ? { ...season, monitored: false }
            : season
        ),
      });
      await client.put('/episode/monitor', {
        episodeIds: plan.files
          .filter(
            (entry) =>
              entry.kind === file.kind &&
              entry.serverId === file.serverId &&
              entry.itemId === file.itemId
          )
          .flatMap((entry) => entry.episodeIds),
        monitored: false,
      });
    }
  }
  let deleted = 0;
  for (const file of plan.files) {
    const client = clientFactory(file.kind, file.serverId);
    const endpoint = `${file.kind === 'radarr' ? '/moviefile' : '/episodefile'}/${file.fileId}`;
    const { data: current } = await client.get<ArrFile>(endpoint);
    if (
      current.path !== file.path ||
      current.size !== file.bytes ||
      (current.dateAdded || '') !== file.added
    ) {
      throw new Error(
        'A media file changed after approval. Refresh the review before deleting it.'
      );
    }
    await client.delete(endpoint);
    deleted++;
  }
  return deleted;
}
