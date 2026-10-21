import defineMessages from '@app/utils/defineMessages';
import type { MediaTechnicalResponse } from '@server/interfaces/api/mediaInterfaces';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.MediaTechnicalDetails', {
  quality: 'Quality',
  audio: 'Audio',
  subtitles: 'Subtitles',
  unknown: 'Unknown',
  none: 'None listed',
  unavailable: 'Technical details unavailable',
});

interface MediaTechnicalDetailsProps {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  available: boolean;
}

const MediaTechnicalDetails = ({
  mediaType,
  tmdbId,
  available,
}: MediaTechnicalDetailsProps) => {
  const intl = useIntl();
  const { data, error } = useSWR<MediaTechnicalResponse>(
    available ? `/api/v1/media/${mediaType}/${tmdbId}/technical` : null
  );

  if (!available || (!data && !error)) return null;

  const countLabel = (count: number): string =>
    mediaType === 'tv' && data ? ` ${count}/${data.fileCount}` : '';
  const languages = (counts: { en: number; fr: number }): string[] =>
    (['en', 'fr'] as const)
      .filter((language) => counts[language] > 0)
      .map(
        (language) => `${language.toUpperCase()}${countLabel(counts[language])}`
      );

  const quality = data?.qualities.length
    ? data.qualities
        .map(
          ({ resolution, count }) =>
            `${resolution ? `${resolution}p` : intl.formatMessage(messages.unknown)}${countLabel(count)}`
        )
        .join(' · ')
    : intl.formatMessage(messages.unknown);
  const audio = data
    ? languages(data.audio).join(' · ') ||
      intl.formatMessage(data.audio.unknown ? messages.unknown : messages.none)
    : '';
  const subtitles = data
    ? languages(data.subtitles).join(' · ') || intl.formatMessage(messages.none)
    : '';

  return (
    <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 rounded-md border border-gray-700/70 bg-gray-900/70 px-4 py-3 text-sm text-gray-200">
      {error || !data?.fileCount ? (
        <span>{intl.formatMessage(messages.unavailable)}</span>
      ) : (
        <>
          <div>
            <span className="font-semibold text-gray-400">
              {intl.formatMessage(messages.quality)}:{' '}
            </span>
            {quality}
          </div>
          <div>
            <span className="font-semibold text-gray-400">
              {intl.formatMessage(messages.audio)}:{' '}
            </span>
            {audio}
          </div>
          <div>
            <span className="font-semibold text-gray-400">
              {intl.formatMessage(messages.subtitles)}:{' '}
            </span>
            {subtitles}
          </div>
        </>
      )}
    </div>
  );
};

export default MediaTechnicalDetails;
