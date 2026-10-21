import Modal from '@app/components/Common/Modal';
import { Transition } from '@headlessui/react';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ClockIcon,
  EnvelopeIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import axios from 'axios';
import { useRouter } from 'next/router';
import { Fragment, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

type Action = 'delete' | 'delete-now' | 'keep' | 'reconsider';
type Review = {
  id: string;
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  seasonNumber: number | null;
  status: 'pending' | 'kept' | 'deleting' | 'deleted' | 'failed' | 'stale';
  eligibleAt: string;
  requesters: string[];
  notifiedAt: string | null;
  emailError: string | null;
  decidedAt: string | null;
  lastError: string | null;
  sourceCleanup?: {
    state: 'pending' | 'complete' | 'ready' | 'waiting_seeding' | 'blocked';
    remainingBytes: number;
    checkedAt?: string;
    reason?: string;
    torrents: { remainingSeconds?: number | null; reason?: string }[];
  } | null;
};
type Preview = {
  review: Review;
  action: Action;
  files: { path: string; bytes: number }[];
  bytes: number;
  token: string;
};
type FutureCandidate = {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  seasonNumber?: number;
  eligibleAt: string;
  eligible: boolean;
};
const bytesLabel = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;

export default function AdminCleanupReview({
  candidates = [],
  onChanged,
}: {
  candidates?: FutureCandidate[];
  onChanged: () => void;
}) {
  const intl = useIntl();
  const french = intl.locale.startsWith('fr');
  const t = (en: string, fr: string) => (french ? fr : en);
  const router = useRouter();
  const { data, error, mutate, isValidating } = useSWR<{
    reviews: Review[];
    manualCandidates: FutureCandidate[];
  }>('/api/v1/admin-tools/cleanup', { refreshInterval: 60000 });
  const [tab, setTab] = useState<
    'pending' | 'kept' | 'future' | 'manual' | 'history' | 'seeding'
  >('pending');
  const [selection, setSelection] = useState<{
    id?: string;
    action: Action;
    candidate?: FutureCandidate;
  } | null>(null);
  const [manualSearch, setManualSearch] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  const openedEmail = useRef('');
  useEffect(() => {
    if (
      !router.isReady ||
      typeof router.query.review !== 'string' ||
      !['delete', 'keep'].includes(String(router.query.intent))
    )
      return;
    const key = `${router.query.review}:${router.query.intent}`;
    if (openedEmail.current !== key) {
      openedEmail.current = key;
      setSelection({
        id: router.query.review,
        action: router.query.intent as Action,
      });
    }
  }, [router.isReady, router.query.review, router.query.intent]);
  useEffect(() => {
    if (!selection) return;
    const controller = new AbortController();
    setPreview(null);
    setFailure('');
    setMessage('');
    const request = selection.candidate
      ? axios.post<Preview>(
          '/api/v1/admin-tools/cleanup/override-preview',
          {
            mediaType: selection.candidate.mediaType,
            tmdbId: selection.candidate.tmdbId,
            seasonNumber: selection.candidate.seasonNumber,
          },
          { signal: controller.signal }
        )
      : axios.get<Preview>(
          `/api/v1/admin-tools/cleanup/${encodeURIComponent(selection.id!)}/preview`,
          { params: { intent: selection.action }, signal: controller.signal }
        );
    request
      .then((response) => setPreview(response.data))
      .catch((e) => {
        if (!axios.isCancel(e))
          setFailure(
            e.response?.data?.message ||
              t(
                'Unable to load this review.',
                'Impossible de charger cette vérification.'
              )
          );
      });
    return () => controller.abort();
  }, [selection]);
  const close = () => {
    if (busy) return;
    setSelection(null);
    setPreview(null);
    setFailure('');
    if (router.query.review)
      void router.replace('/admin-tools', undefined, {
        shallow: true,
        scroll: false,
      });
  };
  const confirm = async () => {
    if (!preview || busy) return;
    setBusy(true);
    setFailure('');
    try {
      await axios.post(
        `/api/v1/admin-tools/cleanup/${preview.review.id}/decision`,
        { action: preview.action, token: preview.token }
      );
      setMessage(
        ['delete', 'delete-now'].includes(preview.action)
          ? t(
              'Removed from the library. Download copies will be deleted automatically after required private seeding. Watch history is preserved.',
              'Retiré de la bibliothèque. Les copies seront supprimées automatiquement après le partage privé obligatoire. Votre suivi est conservé.'
            )
          : preview.action === 'keep'
            ? t(
                'Media kept. No files were deleted.',
                'Média conservé. Aucun fichier supprimé.'
              )
            : t(
                'Media returned to the approval queue.',
                'Média remis dans la file de vérification.'
              )
      );
      setSelection(null);
      setPreview(null);
      if (router.query.review)
        void router.replace('/admin-tools', undefined, {
          shallow: true,
          scroll: false,
        });
      await mutate();
      onChanged();
    } catch (e) {
      setFailure(
        e.response?.data?.message ||
          t(
            'The action could not complete. Refresh the review.',
            'L’action n’a pas abouti. Actualisez la vérification.'
          )
      );
    } finally {
      setBusy(false);
    }
  };
  const reviews = data?.reviews || [];
  const keyOf = (entry: {
    mediaType: string;
    tmdbId: number;
    seasonNumber?: number | null;
  }) => `${entry.mediaType}:${entry.tmdbId}:${entry.seasonNumber || 0}`;
  const libraryKeys = new Set((data?.manualCandidates || []).map(keyOf));
  const pending = reviews.filter(
    (review) =>
      ['pending', 'failed'].includes(review.status) &&
      libraryKeys.has(keyOf(review))
  );
  const kept = reviews.filter(
    (review) => review.status === 'kept' && libraryKeys.has(keyOf(review))
  );
  const history = reviews.filter((review) =>
    ['deleted', 'deleting', 'stale'].includes(review.status)
  );
  const future = candidates.filter(
    (candidate) => !candidate.eligible && libraryKeys.has(keyOf(candidate))
  );
  const seeding = reviews.filter(
    (review) =>
      review.status === 'deleted' && review.sourceCleanup?.state !== 'complete'
  );
  const rows =
    tab === 'pending'
      ? pending
      : tab === 'kept'
        ? kept
        : tab === 'seeding'
          ? seeding
          : history;
  const labels = {
    pending: t('Awaiting approval', 'À approuver'),
    failed: t('Needs review', 'À vérifier'),
    kept: t('Kept', 'Conservé'),
    deleted: t('Deleted', 'Supprimé'),
    deleting: t('Deleting', 'Suppression en cours'),
    stale: t('No longer eligible', 'Non éligible'),
  };
  return (
    <section
      id="cleanup-review"
      className="rounded-xl border border-amber-700/50 bg-amber-950/20 p-4"
      aria-label={t('Cleanup approvals', 'Approbations de suppression')}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-semibold text-white">
          <TrashIcon className="h-5 w-5 text-amber-300" />
          {t('Cleanup approvals', 'Approbations de suppression')}
        </h3>
        <button
          type="button"
          onClick={() => void mutate()}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-gray-600 px-3 text-sm text-gray-200"
        >
          <ArrowPathIcon
            className={`h-4 w-4 ${isValidating ? 'animate-spin' : ''}`}
          />
          {t('Refresh', 'Actualiser')}
        </button>
      </div>
      <p className="mt-2 text-sm text-gray-300">
        {t(
          'After all requesters finish a movie or season, or drop a season, it waits 14 days. Every deletion needs your approval.',
          'Après la fin du film ou de la saison par tous les demandeurs, ou l’abandon d’une saison, le délai est de 14 jours. Chaque suppression exige votre accord.'
        )}
      </p>
      {message && (
        <p
          role="status"
          className="mt-3 rounded-lg bg-emerald-950/60 p-3 text-sm text-emerald-200"
        >
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-rose-200">
          {t(
            'Unable to refresh cleanup reviews. Files are kept.',
            'Impossible d’actualiser les vérifications. Les fichiers sont conservés.'
          )}
        </p>
      )}
      <div
        className="mt-4 flex gap-2 overflow-x-auto pb-2"
        role="tablist"
        aria-label={t('Cleanup status', 'État de conservation')}
      >
        {(
          [
            ['pending', t('Pending', 'À approuver'), pending.length],
            ['kept', t('Kept', 'Conservés'), kept.length],
            ['future', t('Upcoming', 'À venir'), future.length],
            [
              'seeding',
              t('Source cleanup', 'Copies restantes'),
              seeding.length,
            ],
            [
              'manual',
              t('Delete now', 'Supprimer maintenant'),
              data?.manualCandidates?.length || 0,
            ],
            ['history', t('History', 'Historique'), history.length],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm ${tab === key ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-300'}`}
          >
            {label}
            <span className="rounded-full bg-black/20 px-2 text-xs">
              {count}
            </span>
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        className="mt-3 max-h-[34rem] space-y-3 overflow-y-auto"
      >
        {tab === 'manual' ? (
          <div className="space-y-3">
            <p className="rounded-lg border border-rose-700/50 bg-rose-950/30 p-3 text-sm text-rose-200">
              {t(
                'Admin override: delete a movie or season without waiting for watch completion or the 14-day delay. You will review the exact files and confirm. Active playback and downloads still block deletion.',
                'Dérogation administrateur : supprimer un film ou une saison sans attendre le visionnage ou les 14 jours. Vérifiez les fichiers et confirmez. Les lectures et téléchargements actifs restent protégés.'
              )}
            </p>
            <input
              type="search"
              aria-label={t(
                'Search available media',
                'Rechercher un média disponible'
              )}
              placeholder={t(
                'Search available media…',
                'Rechercher un média disponible…'
              )}
              value={manualSearch}
              onChange={(event) => setManualSearch(event.target.value)}
              className="w-full rounded-lg border border-gray-600 bg-gray-900 p-3 text-sm text-white"
            />
            {(data?.manualCandidates || [])
              .filter((candidate) =>
                candidate.title
                  .toLocaleLowerCase()
                  .includes(manualSearch.toLocaleLowerCase())
              )
              .map((candidate) => (
                <article
                  key={`${candidate.mediaType}:${candidate.tmdbId}:${candidate.seasonNumber || 0}`}
                  className="flex flex-col gap-3 rounded-lg border border-gray-700 bg-gray-900/60 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <p className="min-w-0 break-words font-medium text-white">
                    {candidate.title}
                    {candidate.seasonNumber
                      ? ` · ${t('Season', 'Saison')} ${candidate.seasonNumber}`
                      : ''}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      setSelection({ action: 'delete-now', candidate })
                    }
                    className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-rose-700 bg-rose-950/60 px-4 text-sm font-medium text-rose-100"
                  >
                    <TrashIcon className="h-5 w-5" />
                    {t('Delete now', 'Supprimer maintenant')}
                  </button>
                </article>
              ))}
            {data && !data.manualCandidates.length && (
              <p className="text-sm text-gray-400">
                {t(
                  'No available requested media.',
                  'Aucun média demandé disponible.'
                )}
              </p>
            )}
          </div>
        ) : tab === 'future' ? (
          future.length ? (
            future.map((candidate) => (
              <div
                key={`${candidate.mediaType}:${candidate.tmdbId}:${candidate.seasonNumber || 0}`}
                className="rounded-lg border border-gray-700 bg-gray-900/60 p-3"
              >
                <p className="break-words font-medium text-white">
                  {candidate.title}
                  {candidate.seasonNumber
                    ? ` · ${t('Season', 'Saison')} ${candidate.seasonNumber}`
                    : ''}
                </p>
                <p className="mt-2 flex items-center gap-2 text-xs text-gray-400">
                  <ClockIcon className="h-4 w-4" />
                  {t('Review after', 'À vérifier après le')}{' '}
                  {intl.formatDate(candidate.eligibleAt)}
                </p>
              </div>
            ))
          ) : (
            <p className="p-3 text-sm text-gray-400">
              {t(
                'No upcoming cleanup reviews.',
                'Aucune vérification à venir.'
              )}
            </p>
          )
        ) : rows.length ? (
          rows.map((review) => (
            <article
              key={review.id}
              data-review-id={review.id}
              className="rounded-lg border border-gray-700 bg-gray-900/70 p-3 sm:p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 break-words font-semibold text-white">
                  {review.title}
                  {review.seasonNumber
                    ? ` · ${t('Season', 'Saison')} ${review.seasonNumber}`
                    : ''}
                </p>
                <span className="rounded-full bg-gray-700 px-2 py-1 text-xs text-gray-200">
                  {review.status === 'deleted'
                    ? review.sourceCleanup?.state === 'complete'
                      ? t('Fully deleted', 'Entièrement supprimé')
                      : review.sourceCleanup?.state === 'waiting_seeding'
                        ? t('Waiting for seeding', 'Partage en cours')
                        : review.sourceCleanup?.state === 'blocked'
                          ? t('Source needs review', 'Copie à vérifier')
                          : t(
                              'Library removed · checking sources',
                              'Bibliothèque supprimée · vérification des copies'
                            )
                    : labels[review.status]}
                </span>
              </div>
              <p className="mt-2 break-words text-xs text-gray-300">
                {t('Requesters:', 'Demandeurs :')}{' '}
                {review.requesters.join(', ')}
              </p>
              <p className="mt-1 text-xs text-gray-400">
                {t('Eligible since', 'Éligible depuis le')}{' '}
                {intl.formatDate(review.eligibleAt)}
                {review.decidedAt
                  ? ` · ${t('Decision', 'Décision')} ${intl.formatDate(review.decidedAt)} ${intl.formatTime(review.decidedAt)}`
                  : ''}
              </p>
              {review.notifiedAt && (
                <p className="mt-2 flex items-center gap-2 text-xs text-gray-400">
                  <EnvelopeIcon className="h-4 w-4" />
                  {t('Approval email sent', 'Courriel envoyé')} ·{' '}
                  {intl.formatDate(review.notifiedAt)}{' '}
                  {intl.formatTime(review.notifiedAt)}
                </p>
              )}
              {review.emailError && (
                <p className="mt-2 text-xs text-amber-200">
                  {t(
                    'Email delivery failed; a retry is scheduled. You can act here.',
                    'Envoi du courriel échoué ; une nouvelle tentative est prévue. Vous pouvez agir ici.'
                  )}
                </p>
              )}
              {review.lastError && (
                <p role="alert" className="mt-2 text-sm text-amber-200">
                  {review.lastError}
                </p>
              )}
              {review.status === 'deleted' &&
                review.sourceCleanup?.state !== 'complete' && (
                  <div className="mt-3 rounded-lg border border-amber-700/50 bg-amber-950/30 p-3 text-sm text-amber-100">
                    <p>
                      {t(
                        'Removed from the library. Download copies are deleted automatically after required seeding.',
                        'Retiré de la bibliothèque. Les copies sont supprimées automatiquement après le partage obligatoire.'
                      )}
                    </p>
                    {!!review.sourceCleanup?.remainingBytes && (
                      <p className="mt-1 font-medium">
                        {bytesLabel(review.sourceCleanup.remainingBytes)}{' '}
                        {t('still on disk', 'encore sur le disque')}
                      </p>
                    )}
                    {review.sourceCleanup?.reason && (
                      <p className="mt-1">{review.sourceCleanup.reason}</p>
                    )}
                    {review.sourceCleanup?.torrents.map((torrent, index) => (
                      <p key={index} className="mt-1 text-xs text-amber-200">
                        {typeof torrent.remainingSeconds === 'number' &&
                        torrent.remainingSeconds > 0
                          ? `${t('Seeding time remaining:', 'Durée de partage restante :')} ${Math.ceil(torrent.remainingSeconds / 3600)} ${t('hours', 'heures')}`
                          : torrent.reason}
                      </p>
                    ))}
                    {!review.sourceCleanup && (
                      <p className="mt-1 text-xs">
                        {t(
                          'The cleanup worker is checking download copies. Refreshes automatically.',
                          'Vérification des copies en cours. Actualisation automatique.'
                        )}
                      </p>
                    )}
                  </div>
                )}
              {['pending', 'failed'].includes(review.status) && (
                <div className="mt-3 grid grid-cols-1 gap-2 sm:flex">
                  <button
                    type="button"
                    onClick={() =>
                      setSelection({ id: review.id, action: 'delete' })
                    }
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-rose-700 bg-rose-950/60 px-4 text-sm font-medium text-rose-100"
                  >
                    <TrashIcon className="h-5 w-5" />
                    {t('Confirm deletion', 'Confirmer la suppression')}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSelection({ id: review.id, action: 'keep' })
                    }
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-600 bg-gray-800 px-4 text-sm font-medium text-white"
                  >
                    <CheckCircleIcon className="h-5 w-5" />
                    {t('Cancel and keep', 'Annuler et conserver')}
                  </button>
                </div>
              )}
              {review.status === 'kept' && (
                <button
                  type="button"
                  onClick={() =>
                    setSelection({ id: review.id, action: 'reconsider' })
                  }
                  className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-600 px-4 text-sm text-gray-200"
                >
                  {t('Reconsider', 'Réexaminer')}
                </button>
              )}
            </article>
          ))
        ) : (
          <p className="p-3 text-sm text-gray-400">
            {t('No media in this list.', 'Aucun média dans cette liste.')}
          </p>
        )}
      </div>
      {selection && (
        <Transition appear show as={Fragment}>
          <Modal
            title={
              ['delete', 'delete-now'].includes(selection.action)
                ? t('Confirm deletion', 'Confirmer la suppression')
                : selection.action === 'keep'
                  ? t('Keep this media', 'Conserver ce média')
                  : t('Reconsider cleanup', 'Réexaminer la suppression')
            }
            onCancel={close}
            cancelText={t('Back', 'Retour')}
            backgroundClickable={!busy}
            onOk={() => void confirm()}
            okDisabled={!preview || busy || !!failure}
            cancelButtonProps={{ disabled: busy }}
            okText={
              busy
                ? t('Working…', 'En cours…')
                : ['delete', 'delete-now'].includes(selection.action)
                  ? t('Delete these files', 'Supprimer ces fichiers')
                  : selection.action === 'keep'
                    ? t('Keep media', 'Conserver le média')
                    : t('Return to pending', 'Remettre à approuver')
            }
            okButtonType={
              ['delete', 'delete-now'].includes(selection.action)
                ? 'danger'
                : 'primary'
            }
          >
            {selection.action === 'delete-now' && (
              <p className="mb-4 rounded-lg border border-rose-700 bg-rose-950/50 p-3 text-sm text-rose-200">
                {t(
                  'You are overriding watch completion and the 14-day retention delay. Confirm only if you want these library files removed now.',
                  'Vous dérogez au visionnage et au délai de conservation de 14 jours. Confirmez uniquement si vous souhaitez supprimer ces fichiers maintenant.'
                )}
              </p>
            )}
            {!preview && !failure && (
              <p role="status">
                {t(
                  'Checking eligibility and files…',
                  'Vérification des règles et des fichiers…'
                )}
              </p>
            )}
            {failure && (
              <p
                role="alert"
                className="rounded-lg bg-rose-950/60 p-3 text-rose-200"
              >
                {failure}
              </p>
            )}
            {preview && (
              <div className="space-y-4">
                <p className="break-words text-lg font-semibold text-white">
                  {preview.review.title}
                  {preview.review.seasonNumber
                    ? ` · ${t('Season', 'Saison')} ${preview.review.seasonNumber}`
                    : ''}
                </p>
                {['delete', 'delete-now'].includes(preview.action) ? (
                  <>
                    <p>
                      {t(
                        'The library files below will be removed. Matching download copies will be deleted automatically once required private seeding finishes. Watch history and requests remain.',
                        'Les fichiers de bibliothèque ci-dessous seront supprimés. Les copies correspondantes seront supprimées automatiquement après le partage privé obligatoire. Le suivi et les demandes restent.'
                      )}
                    </p>
                    <p className="font-medium text-amber-200">
                      {preview.files.length} {t('files', 'fichiers')} ·{' '}
                      {bytesLabel(preview.bytes)}
                    </p>
                    <ul className="max-h-48 space-y-2 overflow-y-auto rounded-lg bg-gray-900 p-3 text-xs">
                      {preview.files.map((file) => (
                        <li key={file.path} className="break-all">
                          {file.path}
                          <span className="ml-2 text-gray-400">
                            {bytesLabel(file.bytes)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-rose-200">
                      {t(
                        'Confirming removes these files from the server.',
                        'La confirmation supprime ces fichiers du serveur.'
                      )}
                    </p>
                  </>
                ) : (
                  <p>
                    {preview.action === 'keep'
                      ? t(
                          'Cancel this deletion and keep the media. It will stay in Kept until you choose Reconsider.',
                          'Annuler cette suppression et conserver le média. Il restera dans Conservés jusqu’à votre choix de le réexaminer.'
                        )
                      : t(
                          'Return this media to the approval queue. No files are deleted now.',
                          'Remettre ce média dans la file de vérification. Aucun fichier n’est supprimé maintenant.'
                        )}
                  </p>
                )}
              </div>
            )}
          </Modal>
        </Transition>
      )}
    </section>
  );
}
