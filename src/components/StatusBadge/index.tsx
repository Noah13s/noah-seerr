import Spinner from '@app/assets/spinner.svg';
import Badge from '@app/components/Common/Badge';
import Tooltip from '@app/components/Common/Tooltip';
import DownloadBlock from '@app/components/DownloadBlock';
import useSettings from '@app/hooks/useSettings';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import type { UpcomingRelease } from '@app/utils/releaseDates';
import { MediaStatus } from '@server/constants/media';
import type { DownloadingItem } from '@server/lib/downloadtracker';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.StatusBadge', {
  status: '{status}',
  status4k: '4K {status}',
  playonplex: 'Play on {mediaServerName}',
  openinarr: 'Open in {arr}',
  managemedia: 'Manage {mediaType}',
  seasonnumber: 'S{seasonNumber}',
  seasonepisodenumber: 'S{seasonNumber}E{episodeNumber}',
  awaitingTheatrical: 'In cinemas {date}',
  awaitingDigital: 'Digital release {date}',
  awaitingPhysical: 'Physical release {date}',
  awaitingEpisode: 'Next episode {date}',
  releaseUnknown: 'Requested · release date unknown',
});

interface StatusBadgeProps {
  status?: MediaStatus;
  downloadItem?: DownloadingItem[];
  is4k?: boolean;
  inProgress?: boolean;
  plexUrl?: string;
  serviceUrl?: string;
  tmdbId?: number;
  mediaType?: 'movie' | 'tv';
  title?: string | string[];
  statusLabelOverride?: string;
  upcomingRelease?: UpcomingRelease;
}

const StatusBadge = ({
  status: initialStatus,
  downloadItem: initialDownloadItem = [],
  is4k = false,
  inProgress: initialInProgress = false,
  tmdbId,
  mediaType,
  title,
  statusLabelOverride,
  upcomingRelease,
}: StatusBadgeProps) => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  const settings = useSettings();
  const shouldPoll =
    !!tmdbId &&
    !!mediaType &&
    (initialInProgress ||
      initialStatus === MediaStatus.PENDING ||
      initialStatus === MediaStatus.PROCESSING ||
      initialStatus === MediaStatus.PARTIALLY_AVAILABLE);
  const { data: liveDetails } = useSWR<{
    mediaInfo?: {
      status: MediaStatus;
      status4k: MediaStatus;
      downloadStatus?: DownloadingItem[];
      downloadStatus4k?: DownloadingItem[];
    };
  }>(shouldPoll ? `/api/v1/${mediaType}/${tmdbId}` : null, {
    refreshInterval: 10000,
    revalidateOnFocus: true,
  });
  const liveMedia = liveDetails?.mediaInfo;
  const rawStatus = liveMedia
    ? is4k ? liveMedia.status4k : liveMedia.status
    : initialStatus;
  const status = settings.currentSettings.blocklistEnabled === false &&
    rawStatus === MediaStatus.BLOCKLISTED
      ? MediaStatus.UNKNOWN
      : rawStatus;
  const downloadItem = liveMedia
    ? (is4k ? liveMedia.downloadStatus4k : liveMedia.downloadStatus) ?? []
    : initialDownloadItem;
  const inProgress = liveMedia ? downloadItem.length > 0 : initialInProgress;
  const distinctDownloads = downloadItem.filter(
    (item, index, all) =>
      all.findIndex((candidate) => candidate.downloadId === item.downloadId) === index
  );
  const totalSize = distinctDownloads.reduce((sum, item) => sum + item.size, 0);
  const totalLeft = distinctDownloads.reduce((sum, item) => sum + item.sizeLeft, 0);
  const downloadPercent = totalSize
    ? Math.max(0, Math.min(100, Math.round((1 - totalLeft / totalSize) * 100)))
    : 0;

  const parsedReleaseDate = upcomingRelease
    ? new Date(`${upcomingRelease.date.slice(0, 10)}T12:00:00`)
    : undefined;
  const processingLabel =
    parsedReleaseDate && upcomingRelease
      ? intl.formatMessage(
          upcomingRelease.kind === 'theatrical'
            ? messages.awaitingTheatrical
            : upcomingRelease.kind === 'digital'
              ? messages.awaitingDigital
              : upcomingRelease.kind === 'physical'
                ? messages.awaitingPhysical
                : messages.awaitingEpisode,
          {
          date: intl.formatDate(parsedReleaseDate, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          }),
          }
        )
      : intl.formatMessage(messages.releaseUnknown);

  let mediaLink: string | undefined;
  let mediaLinkDescription: string | undefined;

  if (hasPermission(Permission.MANAGE_REQUESTS) && mediaType && tmdbId) {
    mediaLink = `/${mediaType}/${tmdbId}?manage=1`;
    mediaLinkDescription = intl.formatMessage(messages.managemedia, {
      mediaType: intl.formatMessage(
        mediaType === 'movie' ? globalMessages.movie : globalMessages.tvshow
      ),
    });
  }

  const tooltipContent =
    mediaType === 'tv' &&
    downloadItem.length > 1 &&
    downloadItem.every(
      (item) =>
        item.downloadId && item.downloadId === downloadItem[0].downloadId
    ) ? (
      <DownloadBlock
        downloadItem={downloadItem[0]}
        title={Array.isArray(title) ? title[0] : title}
        is4k={is4k}
      />
    ) : (
      <ul>
        {downloadItem.map((status, index) => (
          <li
            key={`dl-status-${status.externalId}-${index}`}
            className="border-b border-gray-700 last:border-b-0"
          >
            <DownloadBlock
              downloadItem={status}
              title={Array.isArray(title) ? title[index] : title}
              is4k={is4k}
            />
          </li>
        ))}
      </ul>
    );

  const badgeDownloadProgress = (
    <div
      className={`absolute left-0 top-0 z-10 flex h-full ${
        status === MediaStatus.DELETED
          ? 'bg-red-600/80'
          : status === MediaStatus.PROCESSING
            ? 'bg-indigo-500/80'
            : 'bg-green-500/80'
      } transition-all duration-200 ease-in-out`}
      style={{
        width: `${downloadPercent}%`,
      }}
    />
  );

  switch (status) {
    case MediaStatus.AVAILABLE:
      return (
        <Tooltip
          content={inProgress ? tooltipContent : mediaLinkDescription}
          className={`${
            inProgress && 'hidden max-h-96 w-96 overflow-y-auto sm:block'
          }`}
          tooltipConfig={{
            ...(inProgress && { interactive: true, delayHide: 100 }),
          }}
        >
          <Badge
            badgeType="success"
            href={mediaLink}
            className={`${
              inProgress && 'relative !bg-gray-700/80 !px-0 hover:!bg-gray-700'
            } overflow-hidden`}
          >
            {inProgress && badgeDownloadProgress}
            <div
              className={`relative z-20 flex items-center ${
                inProgress && 'px-2'
              }`}
            >
              <span>
                {intl.formatMessage(
                  is4k ? messages.status4k : messages.status,
                  {
                    status: inProgress
                      ? intl.formatMessage(globalMessages.processing)
                      : intl.formatMessage(globalMessages.available),
                  }
                )}
              </span>
              {inProgress && (
                <>
                  {mediaType === 'tv' &&
                    downloadItem[0].episode &&
                    (downloadItem.length > 1 &&
                    downloadItem.every(
                      (item) =>
                        item.downloadId &&
                        item.downloadId === downloadItem[0].downloadId
                    ) ? (
                      <span className="ml-1">
                        {intl.formatMessage(messages.seasonnumber, {
                          seasonNumber: downloadItem[0].episode.seasonNumber,
                        })}
                      </span>
                    ) : (
                      <span className="ml-1">
                        {intl.formatMessage(messages.seasonepisodenumber, {
                          seasonNumber: downloadItem[0].episode.seasonNumber,
                          episodeNumber: downloadItem[0].episode.episodeNumber,
                        })}
                      </span>
                    ))}
                  <span className="ml-1 tabular-nums">{downloadPercent}%</span>
                  <Spinner className="ml-1 h-3 w-3" />
                </>
              )}
            </div>
          </Badge>
        </Tooltip>
      );

    case MediaStatus.PARTIALLY_AVAILABLE:
      return (
        <Tooltip
          content={inProgress ? tooltipContent : mediaLinkDescription}
          className={`${
            inProgress && 'hidden max-h-96 w-96 overflow-y-auto sm:block'
          }`}
          tooltipConfig={{
            ...(inProgress && { interactive: true, delayHide: 100 }),
          }}
        >
          <Badge
            badgeType="success"
            href={mediaLink}
            className={`${
              inProgress && 'relative !bg-gray-700/80 !px-0 hover:!bg-gray-700'
            } overflow-hidden`}
          >
            {inProgress && badgeDownloadProgress}
            <div
              className={`relative z-20 flex items-center ${
                inProgress && 'px-2'
              }`}
            >
              <span>
                {intl.formatMessage(
                  is4k ? messages.status4k : messages.status,
                  {
                    status: inProgress
                      ? intl.formatMessage(globalMessages.processing)
                      : intl.formatMessage(globalMessages.partiallyavailable),
                  }
                )}
              </span>
              {inProgress && (
                <>
                  {mediaType === 'tv' &&
                    downloadItem[0].episode &&
                    (downloadItem.length > 1 &&
                    downloadItem.every(
                      (item) =>
                        item.downloadId &&
                        item.downloadId === downloadItem[0].downloadId
                    ) ? (
                      <span className="ml-1">
                        {intl.formatMessage(messages.seasonnumber, {
                          seasonNumber: downloadItem[0].episode.seasonNumber,
                        })}
                      </span>
                    ) : (
                      <span className="ml-1">
                        {intl.formatMessage(messages.seasonepisodenumber, {
                          seasonNumber: downloadItem[0].episode.seasonNumber,
                          episodeNumber: downloadItem[0].episode.episodeNumber,
                        })}
                      </span>
                    ))}
                  <span className="ml-1 tabular-nums">{downloadPercent}%</span>
                  <Spinner className="ml-1 h-3 w-3" />
                </>
              )}
            </div>
          </Badge>
        </Tooltip>
      );

    case MediaStatus.PROCESSING:
      return (
        <Tooltip
          content={inProgress ? tooltipContent : mediaLinkDescription}
          className={`${
            inProgress && 'hidden max-h-96 w-96 overflow-y-auto sm:block'
          }`}
          tooltipConfig={{
            ...(inProgress && { interactive: true, delayHide: 100 }),
          }}
        >
          <Badge
            badgeType="primary"
            href={mediaLink}
            className={`${
              inProgress && 'relative !bg-gray-700/80 !px-0 hover:!bg-gray-700'
            } overflow-hidden`}
          >
            {inProgress && badgeDownloadProgress}
            <div
              className={`relative z-20 flex items-center ${
                inProgress && 'px-2'
              }`}
            >
              <span>
                {intl.formatMessage(
                  is4k ? messages.status4k : messages.status,
                  {
                    status: inProgress
                      ? intl.formatMessage(globalMessages.processing)
                      : processingLabel,
                  }
                )}
              </span>
              {inProgress && (
                <>
                  {mediaType === 'tv' &&
                    downloadItem[0].episode &&
                    (downloadItem.length > 1 &&
                    downloadItem.every(
                      (item) =>
                        item.downloadId &&
                        item.downloadId === downloadItem[0].downloadId
                    ) ? (
                      <span className="ml-1">
                        {intl.formatMessage(messages.seasonnumber, {
                          seasonNumber: downloadItem[0].episode.seasonNumber,
                        })}
                      </span>
                    ) : (
                      <span className="ml-1">
                        {intl.formatMessage(messages.seasonepisodenumber, {
                          seasonNumber: downloadItem[0].episode.seasonNumber,
                          episodeNumber: downloadItem[0].episode.episodeNumber,
                        })}
                      </span>
                    ))}
                  <span className="ml-1 tabular-nums">{downloadPercent}%</span>
                  <Spinner className="ml-1 h-3 w-3" />
                </>
              )}
            </div>
          </Badge>
        </Tooltip>
      );

    case MediaStatus.PENDING:
      return (
        <Tooltip content={mediaLinkDescription}>
          <Badge badgeType="warning" href={mediaLink}>
            {intl.formatMessage(is4k ? messages.status4k : messages.status, {
              status: intl.formatMessage(globalMessages.pending),
            })}
          </Badge>
        </Tooltip>
      );

    case MediaStatus.BLOCKLISTED:
      return (
        <Tooltip content={mediaLinkDescription}>
          <Badge badgeType="danger" href={mediaLink}>
            {intl.formatMessage(is4k ? messages.status4k : messages.status, {
              status:
                statusLabelOverride ??
                intl.formatMessage(globalMessages.blocklisted),
            })}
          </Badge>
        </Tooltip>
      );

    case MediaStatus.DELETED:
      return (
        <Tooltip
          content={inProgress ? tooltipContent : mediaLinkDescription}
          className={`${
            inProgress && 'hidden max-h-96 w-96 overflow-y-auto sm:block'
          }`}
          tooltipConfig={{
            ...(inProgress && { interactive: true, delayHide: 100 }),
          }}
        >
          <Badge
            badgeType="danger"
            href={mediaLink}
            className={`${
              inProgress && 'relative !bg-gray-700/80 !px-0 hover:!bg-gray-700'
            } overflow-hidden`}
          >
            {inProgress && badgeDownloadProgress}
            <div
              className={`relative z-20 flex items-center ${
                inProgress && 'px-2'
              }`}
            >
              <span>
                {intl.formatMessage(
                  is4k ? messages.status4k : messages.status,
                  {
                    status: inProgress
                      ? intl.formatMessage(globalMessages.processing)
                      : intl.formatMessage(globalMessages.deleted),
                  }
                )}
              </span>
              {inProgress && (
                <>
                  {mediaType === 'tv' &&
                    downloadItem[0].episode &&
                    (downloadItem.length > 1 &&
                    downloadItem.every(
                      (item) =>
                        item.downloadId &&
                        item.downloadId === downloadItem[0].downloadId
                    ) ? (
                      <span className="ml-1">
                        {intl.formatMessage(messages.seasonnumber, {
                          seasonNumber: downloadItem[0].episode.seasonNumber,
                        })}
                      </span>
                    ) : (
                      <span className="ml-1">
                        {intl.formatMessage(messages.seasonepisodenumber, {
                          seasonNumber: downloadItem[0].episode.seasonNumber,
                          episodeNumber: downloadItem[0].episode.episodeNumber,
                        })}
                      </span>
                    ))}
                  <span className="ml-1 tabular-nums">{downloadPercent}%</span>
                  <Spinner className="ml-1 h-3 w-3" />
                </>
              )}
            </div>
          </Badge>
        </Tooltip>
      );

    default:
      return null;
  }
};

export default StatusBadge;
