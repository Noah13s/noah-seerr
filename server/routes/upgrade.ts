import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import { MediaType } from '@server/constants/media';
import Media from '@server/entity/Media';
import type { DVRSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import axios, { type AxiosInstance } from 'axios';
import { Router } from 'express';

const MINIMUM_UPGRADE_RESOLUTION = 2160;
const REQUEST_TIMEOUT = 120_000;
const SELECTION_CACHE_TTL = 20 * 60 * 1000;

interface QualityValue {
  name?: string;
  resolution?: number;
}

interface ArrRelease {
  title: string;
  guid: string;
  indexerId: number;
  indexer?: string;
  protocol?: string;
  seeders?: number;
  leechers?: number;
  size?: number;
  qualityWeight?: number;
  rejected?: boolean;
  temporarilyRejected?: boolean;
  downloadAllowed?: boolean;
  rejections?: string[];
  fullSeason?: boolean;
  seasonNumber?: number;
  episodeNumbers?: number[];
  mappedEpisodeNumbers?: number[];
  quality?: { quality?: QualityValue };
  [key: string]: unknown;
}

interface EpisodeFile {
  id: number;
  seasonNumber: number;
  quality?: { quality?: QualityValue };
}

interface Episode {
  id: number;
  episodeFileId: number;
  seasonNumber: number;
  episodeNumber: number;
  hasFile: boolean;
}

interface UpgradeSelection {
  currentLabel: string;
  currentResolution: number;
  lowQualityEpisodeCount: number;
  releases: ArrRelease[];
  coveredEpisodeCount: number;
  seasonCount: number;
}

interface CachedSelection {
  expiresAt: number;
  selection: UpgradeSelection;
}

const upgradeRoutes = Router();
const selectionCache = new Map<string, CachedSelection>();

const selectionCacheKey = (mediaType: string, tmdbId: string): string =>
  `${mediaType}:${tmdbId}`;

const getCachedSelection = (key: string): UpgradeSelection | undefined => {
  const cached = selectionCache.get(key);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    selectionCache.delete(key);
    return undefined;
  }
  return cached.selection;
};

const cacheSelection = (key: string, selection: UpgradeSelection): void => {
  selectionCache.set(key, {
    expiresAt: Date.now() + SELECTION_CACHE_TTL,
    selection,
  });
};

const releaseResolution = (release: ArrRelease): number =>
  Number(release.quality?.quality?.resolution ?? 0);

const releaseSeeders = (release: ArrRelease): number =>
  Number(release.seeders ?? 0);

const compareReleases = (left: ArrRelease, right: ArrRelease): number =>
  releaseSeeders(right) - releaseSeeders(left) ||
  Number(right.leechers ?? 0) - Number(left.leechers ?? 0) ||
  Number(right.qualityWeight ?? 0) - Number(left.qualityWeight ?? 0) ||
  Number(right.size ?? 0) - Number(left.size ?? 0);

const isEligibleUpgrade = (
  release: ArrRelease,
  currentResolution: number
): boolean =>
  release.protocol === 'torrent' &&
  releaseResolution(release) >= MINIMUM_UPGRADE_RESOLUTION &&
  releaseResolution(release) > currentResolution &&
  release.downloadAllowed === true &&
  release.rejected !== true &&
  release.temporarilyRejected !== true;

const arrClient = (server: DVRSettings, mediaType: MediaType): AxiosInstance =>
  axios.create({
    baseURL:
      mediaType === MediaType.MOVIE
        ? RadarrAPI.buildUrl(server, '/api/v3')
        : SonarrAPI.buildUrl(server, '/api/v3'),
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Api-Key': server.apiKey,
    },
    timeout: REQUEST_TIMEOUT,
  });

const uniqueReleases = (releases: ArrRelease[]): ArrRelease[] => {
  const seen = new Set<string>();
  return releases.filter((release) => {
    const key = `${release.indexerId}:${release.guid}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const findMovieSelection = async (
  client: AxiosInstance,
  movieId: number,
  searchReleases = true
): Promise<UpgradeSelection> => {
  const movieResponse = await client.get(`/movie/${movieId}`);
  const movieFile = movieResponse.data.movieFile;
  const quality = movieFile?.quality?.quality as QualityValue | undefined;
  const currentResolution = Number(quality?.resolution ?? 0);

  if (
    !searchReleases ||
    !movieFile ||
    currentResolution >= MINIMUM_UPGRADE_RESOLUTION
  ) {
    return {
      currentLabel: quality?.name ?? 'Aucun fichier',
      currentResolution,
      lowQualityEpisodeCount: 0,
      releases: [],
      coveredEpisodeCount: 0,
      seasonCount: 0,
    };
  }

  const releaseResponse = await client.get<ArrRelease[]>('/release', {
    params: { movieId },
  });
  const releases = releaseResponse.data
    .filter((release) => isEligibleUpgrade(release, currentResolution))
    .sort(compareReleases);

  return {
    currentLabel: quality?.name ?? `${currentResolution}p`,
    currentResolution,
    lowQualityEpisodeCount: 0,
    releases: releases.slice(0, 1),
    coveredEpisodeCount: releases.length > 0 ? 1 : 0,
    seasonCount: 0,
  };
};

const releaseEpisodes = (release: ArrRelease): number[] =>
  release.mappedEpisodeNumbers?.length
    ? release.mappedEpisodeNumbers
    : (release.episodeNumbers ?? []);

const findSeriesSelection = async (
  client: AxiosInstance,
  seriesId: number,
  searchReleases = true
): Promise<UpgradeSelection> => {
  const [filesResponse, episodesResponse] = await Promise.all([
    client.get<EpisodeFile[]>('/episodefile', { params: { seriesId } }),
    client.get<Episode[]>('/episode', { params: { seriesId } }),
  ]);
  const files = filesResponse.data;
  const filesById = new Map(files.map((file) => [file.id, file]));
  const lowEpisodes = episodesResponse.data.filter((episode) => {
    const file = filesById.get(episode.episodeFileId);
    return (
      episode.hasFile &&
      file &&
      Number(file.quality?.quality?.resolution ?? 0) <
        MINIMUM_UPGRADE_RESOLUTION
    );
  });
  const resolutions = files.map((file) =>
    Number(file.quality?.quality?.resolution ?? 0)
  );
  const currentResolution = resolutions.length ? Math.min(...resolutions) : 0;
  const qualityCounts = new Map<string, number>();
  files.forEach((file) => {
    const label = file.quality?.quality?.name ?? 'Qualité inconnue';
    qualityCounts.set(label, (qualityCounts.get(label) ?? 0) + 1);
  });
  const currentLabel = [...qualityCounts.entries()]
    .map(([quality, count]) => `${count} × ${quality}`)
    .join(' · ');

  if (!searchReleases || lowEpisodes.length === 0) {
    return {
      currentLabel: currentLabel || 'Aucun fichier',
      currentResolution,
      lowQualityEpisodeCount: lowEpisodes.length,
      releases: [],
      coveredEpisodeCount: 0,
      seasonCount: 0,
    };
  }

  const episodesBySeason = new Map<number, Episode[]>();
  lowEpisodes.forEach((episode) => {
    const seasonEpisodes = episodesBySeason.get(episode.seasonNumber) ?? [];
    seasonEpisodes.push(episode);
    episodesBySeason.set(episode.seasonNumber, seasonEpisodes);
  });

  const selected: ArrRelease[] = [];
  let coveredEpisodeCount = 0;
  const seasonResults: { releases: ArrRelease[]; covered: number }[] = [];
  for (const [seasonNumber, seasonEpisodes] of episodesBySeason) {
    const seasonCurrentResolution = Math.min(
      ...seasonEpisodes.map((episode) =>
        Number(
          filesById.get(episode.episodeFileId)?.quality?.quality?.resolution ??
            0
        )
      )
    );
    const response = await client.get<ArrRelease[]>('/release', {
      params: { seriesId, seasonNumber },
    });
    const eligible = response.data
      .filter((release) => isEligibleUpgrade(release, seasonCurrentResolution))
      .sort(compareReleases);
    const fullSeason = eligible.filter((release) => release.fullSeason);

    if (fullSeason.length > 0) {
      seasonResults.push({
        releases: [fullSeason[0]],
        covered: seasonEpisodes.length,
      });
      continue;
    }

    const episodeReleases = seasonEpisodes
      .map((episode) =>
        eligible.find((release) =>
          releaseEpisodes(release).includes(episode.episodeNumber)
        )
      )
      .filter((release): release is ArrRelease => Boolean(release));

    seasonResults.push({
      releases: uniqueReleases(episodeReleases),
      covered: episodeReleases.length,
    });
  }
  seasonResults.forEach((result) => {
    selected.push(...result.releases);
    coveredEpisodeCount += result.covered;
  });

  return {
    currentLabel: currentLabel || `${files.length} épisodes`,
    currentResolution,
    lowQualityEpisodeCount: lowEpisodes.length,
    releases: uniqueReleases(selected).sort(compareReleases),
    coveredEpisodeCount,
    seasonCount: episodesBySeason.size,
  };
};

const buildResponse = (selection: UpgradeSelection) => {
  const best = selection.releases[0];
  return {
    available: selection.releases.length > 0,
    minimumResolution: MINIMUM_UPGRADE_RESOLUTION,
    current: {
      label: selection.currentLabel,
      resolution: selection.currentResolution,
      lowQualityEpisodeCount: selection.lowQualityEpisodeCount,
    },
    best: best
      ? {
          title: best.title,
          quality: best.quality?.quality?.name ?? `${releaseResolution(best)}p`,
          resolution: releaseResolution(best),
          seeders: releaseSeeders(best),
          size: Number(best.size ?? 0),
          indexer: best.indexer ?? 'Indexeur inconnu',
          seasonNumber: best.seasonNumber,
        }
      : null,
    plan: {
      releaseCount: selection.releases.length,
      coveredEpisodeCount: selection.coveredEpisodeCount,
      lowQualityEpisodeCount: selection.lowQualityEpisodeCount,
      seasonCount: selection.seasonCount,
    },
  };
};

const getContext = async (mediaTypeValue: string, tmdbIdValue: string) => {
  if (mediaTypeValue !== MediaType.MOVIE && mediaTypeValue !== MediaType.TV) {
    throw Object.assign(new Error('Type de média invalide.'), { status: 400 });
  }

  const mediaType = mediaTypeValue as MediaType;
  const tmdbId = Number(tmdbIdValue);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    throw Object.assign(new Error('Identifiant TMDB invalide.'), {
      status: 400,
    });
  }

  const media = await Media.getMedia(tmdbId, mediaType);
  if (!media) {
    throw Object.assign(new Error('Média absent de la bibliothèque.'), {
      status: 404,
    });
  }

  const settings = getSettings();
  const services =
    mediaType === MediaType.MOVIE ? settings.radarr : settings.sonarr;
  const service =
    services.find((item) => item.id === media.serviceId) ??
    services.find((item) => item.isDefault && !item.is4k);
  if (!service) {
    throw Object.assign(new Error('Service Radarr/Sonarr non configuré.'), {
      status: 409,
    });
  }

  const client = arrClient(service, mediaType);
  let externalId = media.externalServiceId;
  if (!externalId) {
    if (mediaType === MediaType.MOVIE) {
      const response = await client.get('/movie');
      externalId = response.data.find(
        (movie: { tmdbId?: number }) => movie.tmdbId === tmdbId
      )?.id;
    } else {
      const response = await client.get('/series');
      externalId = response.data.find(
        (series: { tvdbId?: number }) => series.tvdbId === media.tvdbId
      )?.id;
    }
  }
  if (!externalId) {
    throw Object.assign(new Error('Média introuvable dans Radarr/Sonarr.'), {
      status: 404,
    });
  }

  return { client, externalId, mediaType, media };
};

const findSelection = (
  client: AxiosInstance,
  externalId: number,
  mediaType: MediaType,
  searchReleases = true
) =>
  mediaType === MediaType.MOVIE
    ? findMovieSelection(client, externalId, searchReleases)
    : findSeriesSelection(client, externalId, searchReleases);

upgradeRoutes.get('/:mediaType/:tmdbId', async (req, res, next) => {
  try {
    const { client, externalId, mediaType } = await getContext(
      req.params.mediaType,
      req.params.tmdbId
    );
    const cacheKey = selectionCacheKey(req.params.mediaType, req.params.tmdbId);
    const searchReleases = req.query.search === '1';
    const selection =
      getCachedSelection(cacheKey) ??
      (await findSelection(client, externalId, mediaType, searchReleases));
    if (searchReleases) cacheSelection(cacheKey, selection);
    return res.status(200).json(buildResponse(selection));
  } catch (error) {
    logger.warn('Impossible de vérifier une amélioration de qualité', {
      label: 'Media Upgrade',
      mediaType: req.params.mediaType,
      tmdbId: req.params.tmdbId,
      errorMessage: error.message,
    });
    return next({
      status: error.status ?? error.response?.status ?? 500,
      message:
        error.status || error.response?.status
          ? error.message
          : "Impossible de rechercher une amélioration pour l'instant.",
    });
  }
});

upgradeRoutes.post('/:mediaType/:tmdbId', async (req, res, next) => {
  try {
    const { client, externalId, mediaType, media } = await getContext(
      req.params.mediaType,
      req.params.tmdbId
    );
    const cacheKey = selectionCacheKey(req.params.mediaType, req.params.tmdbId);
    // Radarr/Sonarr garde les releases interactives 30 minutes. Notre cache
    // expire avant (20 minutes) afin que le POST reste rapide sans jamais
    // essayer d'envoyer une release que le service Arr a déjà oubliée.
    const selection =
      getCachedSelection(cacheKey) ??
      (await findSelection(client, externalId, mediaType));
    if (selection.releases.length === 0) {
      return next({
        status: 409,
        message: 'Aucune amélioration 2160p admissible trouvée.',
      });
    }

    for (const release of selection.releases) {
      await client.post('/release', release);
    }
    selectionCache.delete(cacheKey);

    logger.info('Amélioration de qualité envoyée à Radarr/Sonarr', {
      label: 'Media Upgrade',
      mediaId: media.id,
      mediaType,
      tmdbId: media.tmdbId,
      requestedBy: req.user?.id,
      releaseCount: selection.releases.length,
      bestSeeders: releaseSeeders(selection.releases[0]),
      minimumResolution: MINIMUM_UPGRADE_RESOLUTION,
    });

    return res.status(202).json({
      accepted: true,
      releaseCount: selection.releases.length,
      message:
        'Amélioration envoyée. Après import réussi, le nouveau fichier remplacera la version actuelle.',
    });
  } catch (error) {
    logger.error("Échec de l'envoi d'une amélioration de qualité", {
      label: 'Media Upgrade',
      mediaType: req.params.mediaType,
      tmdbId: req.params.tmdbId,
      errorMessage: error.message,
    });
    return next({
      status: error.status ?? error.response?.status ?? 500,
      message:
        error.response?.data?.message ??
        error.message ??
        "Impossible d'envoyer l'amélioration.",
    });
  }
});

export default upgradeRoutes;
