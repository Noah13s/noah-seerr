import type { JellyfinLibraryItemExtended } from '@server/api/jellyfin';
import type { MediaTechnicalResponse } from '@server/interfaces/api/mediaInterfaces';

const language = (value?: string): 'en' | 'fr' | undefined => {
  const code = value?.toLowerCase().split(/[-_]/)[0];
  if (code === 'en' || code === 'eng') return 'en';
  if (code === 'fr' || code === 'fra' || code === 'fre') return 'fr';
  return undefined;
};

const videoResolution = (stream: {
  DisplayTitle?: string;
  Width?: number;
  Height?: number;
}): number | null => {
  const titleResolution = Number(
    stream.DisplayTitle?.match(/\b(\d{3,4})p\b/i)?.[1]
  );
  if (titleResolution > 0) return titleResolution;

  const width = stream.Width ?? 0;
  if (width >= 3800) return 2160;
  if (width >= 2500) return 1440;
  if (width >= 1800) return 1080;
  return stream.Height || null;
};

export const summarizeMediaTechnical = (
  items: JellyfinLibraryItemExtended[]
): MediaTechnicalResponse => {
  const result: MediaTechnicalResponse = {
    fileCount: 0,
    qualities: [],
    audio: { en: 0, fr: 0, unknown: 0 },
    subtitles: { en: 0, fr: 0 },
  };
  const qualities = new Map<number | null, number>();

  for (const item of items) {
    const sources = item.MediaSources ?? [];
    if (!sources.length) continue;
    const streams = sources.flatMap((source) => source.MediaStreams ?? []);
    const resolutions = streams
      .filter((stream) => stream.Type === 'Video')
      .map(videoResolution)
      .filter((resolution): resolution is number => resolution !== null);
    const resolution = resolutions.length ? Math.max(...resolutions) : null;
    qualities.set(resolution, (qualities.get(resolution) ?? 0) + 1);

    const audio = streams.filter((stream) => stream.Type === 'Audio');
    const subtitles = streams.filter((stream) => stream.Type === 'Subtitle');
    const audioLanguages = new Set(
      audio.map((stream) => language(stream.Language))
    );
    const subtitleLanguages = new Set(
      subtitles.map((stream) => language(stream.Language))
    );

    result.fileCount += 1;
    if (audioLanguages.has('en')) result.audio.en += 1;
    if (audioLanguages.has('fr')) result.audio.fr += 1;
    if (audioLanguages.has(undefined)) result.audio.unknown += 1;
    if (subtitleLanguages.has('en')) result.subtitles.en += 1;
    if (subtitleLanguages.has('fr')) result.subtitles.fr += 1;
  }

  result.qualities = [...qualities.entries()]
    .sort(([left], [right]) => (right ?? 0) - (left ?? 0))
    .map(([resolution, count]) => ({ resolution, count }));
  return result;
};
