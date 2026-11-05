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
  importRejected:
    'Import blocked; review the release and episode mapping in Sonarr',
  trackerDenied:
    'Private tracker rejected access; check the tracker account or choose another release',
  trackersUnreachable:
    'Trackers are unreachable; check their connectivity or choose another release',
  searchDelayed: 'Search is taking longer than usual',
  noProgress: 'No recent download progress',
  importDelayed: 'Download complete; import is delayed',
  retryLimit: 'Automatic retry limit reached',
  serviceUnavailable: 'The media service is temporarily unavailable',
  searchFailed: 'Search failed; recovery is monitored',
  downloadError: 'Download client reported an error',
  quotaExhausted:
    'Tracker download allowance exhausted; waiting for credit or an eligible alternative',
  creditLow:
    'This release exceeds the tracker credit budget; searching eligible alternatives',
  creditStale:
    'Tracker allowance could not be verified; new downloads from this tracker are held',
  credentialsInvalid:
    'Tracker credentials need attention; automatic retries are paused',
  rateLimited: 'Tracker request limit reached; waiting before retrying',
  releaseUnregistered: 'This release is no longer registered with its tracker',
  sizeUnknown: 'Tracker release size could not be verified safely',
  storageFull: 'Not enough free download space; waiting for space',
  filesMissing: 'Download files are missing; automatic resume is paused',
});
const reasonMessages = {
  'import-rejected': messages.importRejected,
  'tracker-access-denied': messages.trackerDenied,
  'trackers-unreachable': messages.trackersUnreachable,
  'search-delayed': messages.searchDelayed,
  'no-transfer-progress': messages.noProgress,
  'import-delayed': messages.importDelayed,
  'retry-limit': messages.retryLimit,
  'service-unavailable': messages.serviceUnavailable,
  'search-failed': messages.searchFailed,
  'download-client-error': messages.downloadError,
  'tracker-quota-exhausted': messages.quotaExhausted,
  'tracker-credit-low': messages.creditLow,
  'tracker-credit-stale': messages.creditStale,
  'tracker-credentials-invalid': messages.credentialsInvalid,
  'tracker-rate-limited': messages.rateLimited,
  'tracker-release-unregistered': messages.releaseUnregistered,
  'tracker-size-unknown': messages.sizeUnknown,
  'storage-full': messages.storageFull,
  'download-files-missing': messages.filesMissing,
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
