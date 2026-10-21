import defineMessages from '@app/utils/defineMessages';
import {
  BookmarkIcon,
  CheckCircleIcon,
  EyeIcon,
  NoSymbolIcon,
} from '@heroicons/react/24/outline';
import type { WatchHistorySummaryItem } from '@server/interfaces/api/watchHistoryInterfaces';
import { isRewatching } from '@server/lib/viewingProgress';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.WatchHistory.StatusBadge', {
  planned: 'Planned',
  watching: 'Watching',
  rewatching: 'Rewatching',
  completedMovie: 'Watched',
  completedSeries: 'Completed',
  droppedMovie: 'Dropped',
  droppedSeries: 'Dropped',
  title: 'Status in My Watch History',
});

interface WatchStatusBadgeProps {
  entry: WatchHistorySummaryItem;
  compact?: boolean;
}

const WatchStatusBadge = ({ entry }: WatchStatusBadgeProps) => {
  const intl = useIntl();
  const isTv = entry.mediaType === 'tv';
  const config = isRewatching(entry.viewingProgress)
    ? {
        label: intl.formatMessage(messages.rewatching),
        Icon: EyeIcon,
        className: 'border-violet-400/60 bg-violet-900/90 text-violet-100',
      }
    : {
        planned: {
          label: intl.formatMessage(messages.planned),
          Icon: BookmarkIcon,
          className: 'border-slate-400/60 bg-slate-800/90 text-slate-100',
        },
        watching: {
          label: intl.formatMessage(messages.watching),
          Icon: EyeIcon,
          className: 'border-sky-400/60 bg-sky-900/90 text-sky-100',
        },
        completed: {
          label: intl.formatMessage(
            isTv ? messages.completedSeries : messages.completedMovie
          ),
          Icon: CheckCircleIcon,
          className: 'border-emerald-400/60 bg-emerald-900/90 text-emerald-100',
        },
        dropped: {
          label: intl.formatMessage(
            isTv ? messages.droppedSeries : messages.droppedMovie
          ),
          Icon: NoSymbolIcon,
          className: 'border-red-400/60 bg-red-950/90 text-red-100',
        },
      }[entry.status];

  if (!config) return null;

  const { Icon } = config;
  return (
    <span
      className={`inline-flex w-max max-w-full shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-1 text-xs font-semibold leading-none shadow ${config.className}`}
      title={intl.formatMessage(messages.title)}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{config.label}</span>
    </span>
  );
};

export default WatchStatusBadge;
