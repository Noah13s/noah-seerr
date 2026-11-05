import RequestPipelineStatus from '@app/components/RequestPipelineStatus';
import TrackerHealth from '@app/components/TrackerHealth';
import { Permission, useUser } from '@app/hooks/useUser';
import { MediaType } from '@server/constants/media';
import type { PipelineSnapshot } from '@server/lib/requestPipeline';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

export default function AdminRequestPipeline() {
  const [visible, setVisible] = useState(20);
  const { hasPermission } = useUser();
  const french = useIntl().locale.startsWith('fr');
  const { data, error } = useSWR<PipelineSnapshot>(
    hasPermission(Permission.ADMIN) ? '/api/v1/admin-tools/pipeline' : null,
    { refreshInterval: 15000 }
  );
  if (!hasPermission(Permission.ADMIN)) return null;
  const problems =
    data?.records.filter(
      (row) => row.reason && row.reason !== 'manual-or-held-pause'
    ) ?? [];
  const jobs = data?.jobs ?? [];
  return (
    <section
      className="mt-6 rounded-xl border border-gray-700 bg-gray-800/60 p-4"
      aria-label={french ? 'Suivi des demandes' : 'Request monitoring'}
    >
      <h2 className="text-lg font-semibold text-white">
        {french ? 'Suivi des demandes' : 'Request monitoring'}
      </h2>
      <p className="mt-1 text-sm text-gray-300">
        {error || (data && (!data.fresh || data.clientAvailable === false))
          ? french
            ? 'Le suivi est temporairement indisponible.'
            : 'Monitoring is temporarily unavailable.'
          : french
            ? 'Suivi automatique des recherches, téléchargements et imports.'
            : 'Automatic monitoring of searches, downloads and imports.'}
      </p>
      {data?.generatedAt && (
        <p className="mt-1 text-xs text-gray-400">
          {french ? 'Dernière mise à jour' : 'Last update'}:{' '}
          {new Date(data.generatedAt).toLocaleString(
            french ? 'fr-FR' : 'en-GB'
          )}
        </p>
      )}
      {problems.length > 0 && (
        <p className="mt-3 text-sm text-amber-200">
          {french
            ? `${problems.length} demande(s) en attente ou à vérifier`
            : `${problems.length} request(s) waiting or needing attention`}
        </p>
      )}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          [
            french ? 'Demandes suivies' : 'Tracked requests',
            data?.records.length ?? 0,
          ],
          [french ? 'À vérifier' : 'Needs attention', problems.length],
          [
            french ? 'En téléchargement' : 'Downloading',
            data?.records.filter((r) => r.stage === 'downloading').length ?? 0,
          ],
          [french ? 'Anciennes tentatives' : 'Retained attempts', jobs.length],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-gray-900/60 p-4">
            <p className="text-xs text-gray-400">{label}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
          </div>
        ))}
      </div>
      <TrackerHealth trackers={data?.trackerHealth ?? []} />
      <ul className="mt-3 divide-y divide-gray-700">
        {(data?.records ?? []).slice(0, visible).map((row) => (
          <li
            key={`${row.mediaType}:${row.serverId}:${row.externalId}:${row.seasonNumber}:${row.downloadId}`}
            className="py-3 text-sm text-gray-200"
          >
            <p className="mb-1 break-words font-medium text-gray-100">
              {row.title || `${row.mediaType} #${row.externalId}`}
              {row.seasonNumber ? ` · S${row.seasonNumber}` : ''}
            </p>
            <RequestPipelineStatus
              details
              item={{
                ...row,
                mediaType:
                  row.mediaType === 'tv' ? MediaType.TV : MediaType.MOVIE,
                title: row.title || '',
                status: row.stage || '',
                timeLeft: '',
                estimatedCompletionTime: new Date(NaN),
              }}
            />
            <p className="mt-2 text-xs text-gray-400">
              {french ? 'Tentatives de récupération' : 'Recovery attempts'}:{' '}
              {row.recoveryAttempts ?? 0} / 3
              {row.lastProgressAt
                ? ` · ${french ? 'Dernière progression' : 'Last progress'}: ${new Date(row.lastProgressAt).toLocaleString(french ? 'fr-FR' : 'en-GB')}`
                : ''}
            </p>
          </li>
        ))}
      </ul>
      {data && data.records.length > visible && (
        <button
          type="button"
          className="my-3 min-h-11 rounded-lg border border-gray-600 px-4 text-sm text-white"
          onClick={() => setVisible((v) => v + 20)}
        >
          {french ? 'Afficher plus de demandes' : 'Show more requests'}
        </button>
      )}
      {data?.fresh && !data.records.length && (
        <p className="py-5 text-sm text-gray-400">
          {french ? 'Aucune demande en cours.' : 'No active requests.'}
        </p>
      )}
      <details
        className="mt-3"
        open={jobs.some((job) => job.stage === 'blocked')}
      >
        <summary className="cursor-pointer text-sm font-medium text-gray-100">
          {french
            ? 'Tentatives anciennes et suspendues'
            : 'Old and held attempts'}{' '}
          ({jobs.length})
        </summary>
        <ul className="mt-2 divide-y divide-gray-700">
          {jobs.map((job) => (
            <li
              key={job.downloadId}
              className="flex min-w-0 flex-col gap-1 py-3 text-sm sm:flex-row sm:justify-between sm:gap-4"
            >
              <span className="min-w-0 break-words text-gray-200">
                {job.title || job.downloadId.slice(0, visible)}
                {job.seasonNumber ? ` · S${job.seasonNumber}` : ''}
              </span>
              <span className="shrink-0 text-xs text-gray-400">
                {job.reason === 'already-available-import-conflict'
                  ? french
                    ? 'Remplacement bloqué · épisodes déjà disponibles'
                    : 'Blocked replacement · episodes already available'
                  : job.stage === 'superseded'
                    ? french
                      ? 'Ancienne tentative · entrée conservée'
                      : 'Superseded attempt · record retained'
                    : job.stage === 'reused'
                      ? french
                        ? 'Réutilisée par une demande actuelle'
                        : 'Reused by a current request'
                      : french
                        ? 'Suspendue · entrée conservée'
                        : 'Held · record retained'}
              </span>
            </li>
          ))}
          {!jobs.length && (
            <li className="py-2 text-xs text-gray-400">
              {french
                ? 'Aucune ancienne tentative retenue.'
                : 'No retained old attempts.'}
            </li>
          )}
        </ul>
      </details>
    </section>
  );
}
