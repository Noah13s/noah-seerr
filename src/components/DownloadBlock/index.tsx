import Badge from '@app/components/Common/Badge';
import RequestPipelineStatus from '@app/components/RequestPipelineStatus';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { requestPercent, requestStage } from '@app/utils/requestPipeline';
import type { DownloadingItem } from '@server/lib/downloadtracker';
import { FormattedRelativeTime, useIntl } from 'react-intl';

const messages = defineMessages('components.DownloadBlock', {
  estimatedtime: 'Estimated {time}',
  formattedTitle: '{title}: Season {seasonNumber} Episode {episodeNumber}',
});

interface DownloadBlockProps {
  downloadItem: DownloadingItem;
  is4k?: boolean;
  title?: string;
}

const DownloadBlock = ({
  downloadItem,
  is4k = false,
  title,
}: DownloadBlockProps) => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  const percent = requestPercent(downloadItem);
  const completionAt = downloadItem.estimatedCompletionTime
    ? new Date(downloadItem.estimatedCompletionTime).getTime()
    : NaN;

  return (
    <div className="p-4">
      <div className="mb-2 w-56 truncate text-sm sm:w-80 md:w-full">
        {hasPermission(Permission.ADMIN) && downloadItem.title
          ? downloadItem.title
          : downloadItem.episode
            ? intl.formatMessage(messages.formattedTitle, {
                title,
                seasonNumber: downloadItem?.episode?.seasonNumber,
                episodeNumber: downloadItem?.episode?.episodeNumber,
              })
            : title}
      </div>
      <div className="mb-2 text-xs text-gray-200">
        <RequestPipelineStatus item={downloadItem} details />
      </div>
      {percent !== undefined && (
        <div className="relative mb-2 h-6 min-w-0 overflow-hidden rounded-full bg-gray-700">
          <div
            className="h-8 bg-indigo-600 transition-all duration-200 ease-in-out"
            style={{
              width: `${percent}%`,
            }}
          />
          <div className="absolute inset-0 flex h-6 w-full items-center justify-center text-xs">
            <span>{percent}%</span>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between text-xs">
        <span>
          {is4k && (
            <Badge badgeType="warning" className="mr-2">
              4K
            </Badge>
          )}
        </span>
        <span>
          {Number.isFinite(completionAt) &&
          requestStage(downloadItem) === 'downloading'
            ? intl.formatMessage(messages.estimatedtime, {
                time: (
                  <FormattedRelativeTime
                    value={Math.floor((completionAt - Date.now()) / 1000)}
                    updateIntervalInSeconds={1}
                    numeric="auto"
                  />
                ),
              })
            : ''}
        </span>
      </div>
    </div>
  );
};

export default DownloadBlock;
