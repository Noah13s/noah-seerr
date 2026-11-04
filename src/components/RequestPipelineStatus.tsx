import defineMessages from '@app/utils/defineMessages';
import {
  elapsedMinutes,
  requestPercent,
  requestStage,
} from '@app/utils/requestPipeline';
import type { DownloadingItem } from '@server/lib/downloadtracker';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.RequestPipelineStatus', {
  searching: 'Searching',
  metadata: 'Getting torrent details',
  downloading: 'Downloading',
  importing: 'Importing',
  indexing: 'Updating library',
  paused: 'Paused',
  stalled: 'Download stalled',
  blocked: 'Needs attention',
  unavailable: 'Status unavailable',
  episode: 'Episode {episode} of {total}',
  elapsed:
    '{minutes, plural, =0 {Under a minute} one {# minute} other {# minutes}}',
  searchDelayed: 'Search is taking longer than usual',
  noProgress: 'No recent download progress',
  importDelayed: 'Download complete; import is delayed',
  retryLimit: 'Automatic retry limit reached',
  serviceUnavailable: 'The media service is temporarily unavailable',
  searchFailed: 'Search failed; recovery is monitored',
  downloadError: 'Download client reported an error',
});
const reasonMessages = {
  'search-delayed': messages.searchDelayed,
  'no-transfer-progress': messages.noProgress,
  'import-delayed': messages.importDelayed,
  'retry-limit': messages.retryLimit,
  'service-unavailable': messages.serviceUnavailable,
  'search-failed': messages.searchFailed,
  'download-client-error': messages.downloadError,
};

export default function RequestPipelineStatus({
  item,
  details = false,
}: {
  item: DownloadingItem;
  details?: boolean;
}) {
  const intl = useIntl();
  const percent = requestPercent(item);
  const minutes = elapsedMinutes(item);
  const progress = item.searchProgress;
  const reason = reasonMessages[item.reason as keyof typeof reasonMessages];
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span className="font-medium">
        {intl.formatMessage(messages[requestStage(item)])}
      </span>
      {percent !== undefined && (
        <span className="tabular-nums">{percent}%</span>
      )}
      {progress && (
        <span>
          {intl.formatMessage(messages.episode, {
            episode: progress.episodeNumber,
            total: progress.totalEpisodes,
          })}
        </span>
      )}
      {minutes !== undefined && (
        <span className="opacity-80">
          · {intl.formatMessage(messages.elapsed, { minutes })}
        </span>
      )}
      {details && reason && (
        <span className="basis-full text-amber-200">
          {intl.formatMessage(reason)}
        </span>
      )}
    </span>
  );
}
