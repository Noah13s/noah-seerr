import Button from '@app/components/Common/Button';
import {
  WATCH_HISTORY_SUMMARY_KEY,
  default as useWatchHistoryStatus,
} from '@app/hooks/useWatchHistoryStatus';
import defineMessages from '@app/utils/defineMessages';
import {
  CheckCircleIcon,
  EyeIcon,
  NoSymbolIcon,
  PencilSquareIcon,
  StarIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { isRewatching } from '@server/lib/viewingProgress';
import axios from 'axios';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { useIntl } from 'react-intl';
import { mutate } from 'swr';

const messages = defineMessages('components.MediaWatchEditor', {
  saved: 'Watch status saved.',
  saveError: 'Unable to save watch status.',
  removeConfirm: 'Remove this title from My Watch History?',
  removed: 'Title removed from My Watch History.',
  removeError: 'Unable to remove title.',
  edit: 'Edit watch status',
  watched: 'Watched?',
  heading: 'My Watch History',
  close: 'Close',
  status: 'Status',
  watching: 'Watching',
  completedMovie: 'Watched',
  completedSeries: 'Completed',
  dropped: 'Dropped',
  lastEpisode: 'Last watched episode by season',
  season: 'Season {seasonNumber}',
  watchCount: 'Number of watches',
  lastWatched: 'Last watched',
  rating: 'Rating',
  notRated: 'Not rated',
  rateStars: '{rating} out of 5 stars',
  clearRating: 'Clear rating',
  notes: 'Personal notes',
  remove: 'Remove',
  cancel: 'Cancel',
  saving: 'Saving…',
  save: 'Save',
  rewatching: 'Rewatching — your previous watched history is preserved.',
  stopRewatch: 'Stop rewatching',
});

type EditableStatus = 'watching' | 'completed' | 'dropped';

interface SeasonSummary {
  seasonNumber: number;
  episodeCount: number;
}

interface MediaWatchEditorProps {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  releaseYear?: number;
  seasons?: SeasonSummary[];
}

const today = () => new Date().toISOString().slice(0, 10);

const MediaWatchEditor = ({
  tmdbId,
  mediaType,
  title,
  releaseYear,
  seasons = [],
}: MediaWatchEditorProps) => {
  const intl = useIntl();
  const entry = useWatchHistoryStatus(tmdbId, mediaType);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<EditableStatus>('completed');
  const [watchCount, setWatchCount] = useState(1);
  const [watchedAt, setWatchedAt] = useState(today());
  const [rating, setRating] = useState<number | ''>('');
  const [hoveredRating, setHoveredRating] = useState(0);
  const [notes, setNotes] = useState('');
  const [seasonProgress, setSeasonProgress] = useState<Record<string, number>>(
    {}
  );

  const realSeasons = useMemo(
    () =>
      seasons
        .filter((season) => season.seasonNumber > 0 && season.episodeCount > 0)
        .sort((a, b) => a.seasonNumber - b.seasonNumber),
    [seasons]
  );

  useEffect(() => {
    if (!open) return;
    setStatus(
      entry?.status === 'watching' ||
        entry?.status === 'completed' ||
        entry?.status === 'dropped'
        ? entry.status
        : 'completed'
    );
    setWatchCount(Math.max(1, entry?.watchCount ?? 1));
    setWatchedAt(
      entry?.watchedAt
        ? new Date(entry.watchedAt).toISOString().slice(0, 10)
        : today()
    );
    setRating(entry?.rating ?? '');
    setHoveredRating(0);
    setNotes(entry?.notes ?? '');
    setSeasonProgress(entry?.seasonProgress ?? {});
  }, [entry, open]);

  const updateSeason = (season: SeasonSummary, value: number) => {
    const next = {
      ...seasonProgress,
      [String(season.seasonNumber)]: Math.max(
        0,
        Math.min(value, season.episodeCount)
      ),
    };
    setSeasonProgress(next);
    const watched = realSeasons.reduce(
      (total, item) => total + (next[String(item.seasonNumber)] ?? 0),
      0
    );
    const available = realSeasons.reduce(
      (total, item) => total + item.episodeCount,
      0
    );
    if (watched > 0 && watched < available) setStatus('watching');
    if (available > 0 && watched >= available) setStatus('completed');
  };

  const selectStatus = (next: EditableStatus) => {
    setStatus(next);
    if (next === 'completed' && mediaType === 'tv') {
      setSeasonProgress(
        Object.fromEntries(
          realSeasons.map((season) => [
            String(season.seasonNumber),
            season.episodeCount,
          ])
        )
      );
    }
  };

  const payload = () => ({
    mediaType,
    tmdbId,
    title,
    releaseYear: releaseYear ?? null,
    status,
    watchCount: mediaType === 'movie' ? Math.max(1, watchCount) : 0,
    watchedAt: watchedAt
      ? new Date(`${watchedAt}T12:00:00`).toISOString()
      : null,
    watchedEpisodes: null,
    totalEpisodes: null,
    seasonProgress: mediaType === 'tv' ? seasonProgress : {},
    categories: entry?.categories ?? null,
    rating: rating === '' ? null : rating,
    priority: entry?.priority ?? null,
    series: entry?.series ?? null,
    notes: notes || null,
  });

  const save = async () => {
    setSaving(true);
    try {
      if (entry) {
        await axios.put(`/api/v1/watch-history/${entry.id}`, payload());
      } else {
        await axios.post('/api/v1/watch-history', payload());
      }
      await mutate(WATCH_HISTORY_SUMMARY_KEY);
      setOpen(false);
      toast.success(intl.formatMessage(messages.saved));
    } catch {
      toast.error(intl.formatMessage(messages.saveError));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!entry || !window.confirm(intl.formatMessage(messages.removeConfirm)))
      return;
    setSaving(true);
    try {
      await axios.delete(`/api/v1/watch-history/${entry.id}`);
      await mutate(WATCH_HISTORY_SUMMARY_KEY);
      setOpen(false);
      toast.success(intl.formatMessage(messages.removed));
    } catch {
      toast.error(intl.formatMessage(messages.removeError));
    } finally {
      setSaving(false);
    }
  };

  const stopRewatch = async () => {
    if (!entry) return;
    setSaving(true);
    try {
      await axios.delete(`/api/v1/watch-history/${entry.id}/rewatch`);
      await mutate(WATCH_HISTORY_SUMMARY_KEY);
      await mutate('/api/v1/watch-history?active=1&take=24');
      setOpen(false);
    } catch {
      toast.error(intl.formatMessage(messages.saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button
        buttonType={entry ? 'default' : 'ghost'}
        className="z-20 mr-2"
        onClick={() => setOpen(true)}
        aria-label={intl.formatMessage(
          entry ? messages.edit : messages.watched
        )}
        title={intl.formatMessage(entry ? messages.edit : messages.watched)}
      >
        {entry ? <PencilSquareIcon /> : <EyeIcon />}
        <span className="hidden 2xl:inline">
          {entry
            ? intl.formatMessage(messages.edit)
            : intl.formatMessage(messages.watched)}
        </span>
      </Button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/75 sm:items-center sm:p-4">
            <div className="flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-xl bg-gray-800 shadow-2xl sm:max-h-[94dvh] sm:max-w-xl sm:rounded-xl">
              <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-700 bg-gray-800 px-4 py-3 sm:px-5 sm:py-4">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-white">
                    {intl.formatMessage(messages.heading)}
                  </h2>
                  <p className="truncate text-sm text-gray-400">{title}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-gray-300 hover:bg-gray-700"
                  aria-label={intl.formatMessage(messages.close)}
                >
                  <XMarkIcon className="h-6 w-6" />
                </button>
              </div>

              <div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 sm:p-5">
                {isRewatching(entry?.viewingProgress) && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-violet-400/40 bg-violet-900/20 p-3 text-sm text-violet-200">
                    <span>{intl.formatMessage(messages.rewatching)}</span>
                    <Button
                      buttonSize="sm"
                      disabled={saving}
                      onClick={() => void stopRewatch()}
                    >
                      {intl.formatMessage(messages.stopRewatch)}
                    </Button>
                  </div>
                )}
                <div>
                  <span className="mb-2 block text-sm font-medium text-gray-200">
                    {intl.formatMessage(messages.status)}
                  </span>
                  <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                    {(
                      [
                        [
                          'watching',
                          intl.formatMessage(messages.watching),
                          EyeIcon,
                        ],
                        [
                          'completed',
                          mediaType === 'movie'
                            ? intl.formatMessage(messages.completedMovie)
                            : intl.formatMessage(messages.completedSeries),
                          CheckCircleIcon,
                        ],
                        [
                          'dropped',
                          intl.formatMessage(messages.dropped),
                          NoSymbolIcon,
                        ],
                      ] as const
                    ).map(([value, label, Icon]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => selectStatus(value)}
                        className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg border px-1 py-2 text-center text-xs leading-tight sm:p-3 sm:text-sm ${
                          status === value
                            ? 'border-indigo-400 bg-indigo-600 text-white'
                            : 'border-gray-600 bg-gray-900 text-gray-300 hover:bg-gray-700'
                        }`}
                      >
                        <Icon className="h-5 w-5" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {mediaType === 'tv' && realSeasons.length > 0 && (
                  <div>
                    <span className="mb-2 block text-sm font-medium text-gray-200">
                      {intl.formatMessage(messages.lastEpisode)}
                    </span>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {realSeasons.map((season) => (
                        <label
                          key={season.seasonNumber}
                          className="rounded-lg border border-gray-700 bg-gray-900 p-3 text-sm text-gray-300"
                        >
                          <span className="mb-1 block">
                            {intl.formatMessage(messages.season, {
                              seasonNumber: season.seasonNumber,
                            })}
                          </span>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min="0"
                              max={season.episodeCount}
                              value={
                                seasonProgress[String(season.seasonNumber)] ?? 0
                              }
                              onChange={(event) =>
                                updateSeason(season, Number(event.target.value))
                              }
                              className="w-full min-w-0 rounded border border-gray-600 bg-gray-800 px-2 py-1 text-white"
                            />
                            <span>/ {season.episodeCount}</span>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  {mediaType === 'movie' && (
                    <label className="text-sm text-gray-300">
                      <span className="mb-1 block">
                        {intl.formatMessage(messages.watchCount)}
                      </span>
                      <input
                        type="number"
                        min="1"
                        value={watchCount}
                        onChange={(event) =>
                          setWatchCount(Number(event.target.value))
                        }
                        className="w-full rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-white"
                      />
                    </label>
                  )}
                  <label className="text-sm text-gray-300">
                    <span className="mb-1 block">
                      {intl.formatMessage(messages.lastWatched)}
                    </span>
                    <input
                      type="date"
                      value={watchedAt}
                      onChange={(event) => setWatchedAt(event.target.value)}
                      className="w-full rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-white"
                    />
                  </label>
                  <fieldset className="min-w-0 text-sm text-gray-300">
                    <legend className="mb-1 font-medium">
                      {intl.formatMessage(messages.rating)}
                    </legend>
                    <div className="flex min-h-10 flex-wrap items-center gap-1 rounded-md border border-gray-600 bg-gray-900 px-2 py-1">
                      <div
                        className="flex items-center"
                        onMouseLeave={() => setHoveredRating(0)}
                      >
                        {[1, 2, 3, 4, 5].map((value) => (
                          <label
                            key={value}
                            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md transition focus-within:ring-2 focus-within:ring-indigo-400 hover:bg-gray-700"
                            onMouseEnter={() => setHoveredRating(value)}
                            title={intl.formatMessage(messages.rateStars, {
                              rating: value,
                            })}
                          >
                            <input
                              type="radio"
                              name={`watch-rating-${mediaType}-${tmdbId}`}
                              value={value}
                              checked={rating === value}
                              onChange={() => setRating(value)}
                              className="sr-only"
                              aria-label={intl.formatMessage(
                                messages.rateStars,
                                { rating: value }
                              )}
                            />
                            <StarIcon
                              className={`h-7 w-7 ${
                                value <= (hoveredRating || Number(rating))
                                  ? 'fill-amber-400 text-amber-400'
                                  : 'fill-gray-600 text-gray-600'
                              }`}
                              aria-hidden="true"
                            />
                          </label>
                        ))}
                      </div>
                      <span
                        className="ml-1 text-xs text-gray-400"
                        aria-live="polite"
                      >
                        {rating === ''
                          ? intl.formatMessage(messages.notRated)
                          : `${rating}/5`}
                      </span>
                      {rating !== '' && (
                        <button
                          type="button"
                          onClick={() => setRating('')}
                          className="ml-auto rounded px-2 py-1 text-xs text-gray-300 hover:bg-gray-700 hover:text-white"
                        >
                          {intl.formatMessage(messages.clearRating)}
                        </button>
                      )}
                    </div>
                  </fieldset>
                </div>

                <label className="block text-sm text-gray-300">
                  <span className="mb-1 block">
                    {intl.formatMessage(messages.notes)}
                  </span>
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-white"
                  />
                </label>
              </div>

              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-gray-700 bg-gray-800 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5 sm:py-4">
                <div>
                  {entry && (
                    <Button
                      buttonType="danger"
                      onClick={remove}
                      disabled={saving}
                    >
                      <TrashIcon className="mr-1 h-4 w-4" />{' '}
                      {intl.formatMessage(messages.remove)}
                    </Button>
                  )}
                </div>
                <div className="flex flex-1 justify-end gap-2 sm:flex-none">
                  <Button onClick={() => setOpen(false)} disabled={saving}>
                    {intl.formatMessage(messages.cancel)}
                  </Button>
                  <Button buttonType="primary" onClick={save} disabled={saving}>
                    {saving
                      ? intl.formatMessage(messages.saving)
                      : intl.formatMessage(messages.save)}
                  </Button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

export default MediaWatchEditor;
