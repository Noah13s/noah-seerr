import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

type Event = {
  id: number;
  userId: number;
  userName: string;
  category: string;
  action: string;
  device: string;
  title: string;
  createdAt: string;
  details: Record<string, string | number | boolean>;
};
const labels: Record<string, [string, string]> = {
  'playback.detected': ['Playback detected', 'Lecture détectée'],
  'playback.started': ['Playback started', 'Lecture commencée'],
  'playback.paused': ['Paused', 'Pause'],
  'playback.resumed': ['Resumed', 'Lecture reprise'],
  'playback.seeked': ['Timeline jump', 'Déplacement dans la vidéo'],
  'playback.audio': ['Audio changed', 'Piste audio modifiée'],
  'playback.subtitle': ['Subtitles changed', 'Sous-titres modifiés'],
  'playback.ended': ['Session ended', 'Session terminée'],
};
const categories: Record<string, [string, string]> = {
  playback: ['Playback', 'Lecture'],
  request: ['Requests', 'Demandes'],
  'watch-history': ['Watch history', 'Suivi'],
  watchlist: ['Watchlist', 'Liste à voir'],
  cleanup: ['Cleanup', 'Nettoyage'],
  account: ['Account', 'Compte'],
  settings: ['Settings', 'Paramètres'],
  user: ['Profiles', 'Profils'],
  issue: ['Issues', 'Problèmes'],
  issueComment: ['Issue comments', 'Commentaires'],
  blocklist: ['Blocklist', 'Blocages'],
  party: ['Watch parties', 'Watch parties'],
};
const actions: Record<string, [string, string]> = {
  created: ['Created', 'Création'],
  updated: ['Updated', 'Modification'],
  removed: ['Removed', 'Suppression'],
  approve: ['Approved', 'Approbation'],
  decline: ['Declined', 'Refus'],
  retry: ['Retried', 'Nouvelle tentative'],
  login: ['Signed in', 'Connexion'],
  logout: ['Signed out', 'Déconnexion'],
  keep: ['Kept', 'Conservation'],
  delete: ['Deletion approved', 'Suppression approuvée'],
  'delete-now': [
    'Immediate deletion approved',
    'Suppression immédiate approuvée',
  ],
  reconsider: ['Reconsidered', 'Réexamen'],
  rating: ['Rating changed', 'Note modifiée'],
};
function actionLabel(event: Event, french: boolean) {
  const i = french ? 1 : 0;
  if (labels[event.action]) return labels[event.action][i];
  const parts = event.action.split('.');
  const verb = actions[parts[1]]?.[i] || parts[1];
  return `${categories[event.category]?.[i] || event.category} · ${verb}${parts[2] === 'failed' ? (french ? ' · échec' : ' · failed') : ''}`;
}
const clock = (seconds: string | number | boolean) => {
  const n = typeof seconds === 'number' ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};
export default function AdminActivity({
  users,
}: {
  users: { id: number; name: string }[];
}) {
  const intl = useIntl();
  const french = intl.locale.startsWith('fr');
  const t = (en: string, fr: string) => (french ? fr : en);
  const [userId, setUserId] = useState('');
  const [category, setCategory] = useState('');
  const [pages, setPages] = useState<number[]>([]);
  const before = pages.at(-1);
  const params = new URLSearchParams({ take: '50' });
  if (userId) params.set('userId', userId);
  if (category) params.set('category', category);
  if (before) params.set('before', String(before));
  const { data, error, mutate, isValidating } = useSWR<{
    events: Event[];
    next: number | null;
    observation?: { available: boolean; lastSuccessAt: string | null };
  }>(`/api/v1/admin-tools/activity?${params}`, {
    refreshInterval: before ? 0 : 15000,
  });
  const select =
    'min-h-11 w-full rounded-lg border border-gray-600 bg-gray-800 text-sm text-white sm:w-auto';
  return (
    <section
      className="space-y-5"
      aria-label={t('Activity history', 'Historique d’activité')}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">
            {t('Activity history', 'Historique d’activité')}
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-gray-300">
            {t(
              'Account actions and playback observed across devices. Kept for 90 days, up to 100,000 events. Recording starts with this update; past actions cannot be reconstructed.',
              'Actions des comptes et lecture observée sur les appareils. Conservation : 90 jours, jusqu’à 100 000 événements. L’enregistrement commence avec cette mise à jour ; les anciennes actions ne peuvent pas être reconstituées.'
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void mutate()}
          disabled={isValidating}
          className="min-h-11 shrink-0 rounded-lg border border-gray-600 px-4 text-sm text-white disabled:opacity-50"
        >
          {t('Refresh', 'Actualiser')}
        </button>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-col gap-1 text-xs text-gray-400">
          {t('User', 'Utilisateur')}
          <select
            value={userId}
            className={select}
            onChange={(e) => {
              setUserId(e.target.value);
              setPages([]);
            }}
          >
            <option value="">{t('All users', 'Tous les utilisateurs')}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-400">
          {t('Category', 'Catégorie')}
          <select
            value={category}
            className={select}
            onChange={(e) => {
              setCategory(e.target.value);
              setPages([]);
            }}
          >
            <option value="">{t('All actions', 'Toutes les actions')}</option>
            {[
              'playback',
              'request',
              'watch-history',
              'watchlist',
              'cleanup',
              'account',
              'settings',
              'user',
              'issue',
              'blocklist',
            ].map((c) => (
              <option key={c} value={c}>
                {categories[c]?.[french ? 1 : 0] || c}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="text-red-300">
          {t(
            'Unable to load activity history.',
            'Impossible de charger l’historique.'
          )}
        </p>
      )}
      {!data && !error && (
        <p role="status" className="text-gray-400">
          {t('Loading…', 'Chargement…')}
        </p>
      )}
      {data?.observation && !data.observation.available && (
        <p
          role="status"
          className="rounded-lg border border-amber-700 bg-amber-950/20 p-3 text-sm text-amber-200"
        >
          {t(
            'Playback observation is starting or temporarily unavailable. Account actions are still recorded.',
            'L’observation de la lecture démarre ou est temporairement indisponible. Les actions des comptes restent enregistrées.'
          )}
        </p>
      )}
      <ol className="space-y-3">
        {data?.events.map((event) => (
          <li
            key={event.id}
            className="min-w-0 rounded-xl border border-gray-700 bg-gray-800/60 p-4 sm:p-5"
          >
            <div className="flex flex-col justify-between gap-2 sm:flex-row">
              <div className="min-w-0">
                <span className="font-semibold text-indigo-200">
                  {event.userName}
                </span>
                <span className="mx-2 text-gray-500">·</span>
                <span className="break-words text-white">
                  {actionLabel(event, french)}
                </span>
              </div>
              <time
                className="shrink-0 text-xs text-gray-400"
                dateTime={event.createdAt}
              >
                {intl.formatDate(event.createdAt, { dateStyle: 'medium' })}{' '}
                {intl.formatTime(event.createdAt, { timeStyle: 'medium' })}
              </time>
            </div>
            {event.title && (
              <p className="mt-2 break-words font-medium text-gray-100">
                {event.title}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-400">
              <span className="break-words">{event.device}</span>
              {typeof event.details.position === 'number' && (
                <span>{clock(event.details.position)}</span>
              )}
              {event.details.from !== undefined && (
                <span>
                  {typeof event.details.from === 'number'
                    ? clock(event.details.from)
                    : String(event.details.from)}{' '}
                  →{' '}
                  {typeof event.details.to === 'number'
                    ? clock(event.details.to)
                    : String(event.details.to)}
                </span>
              )}
              {event.details.audio && (
                <span>Audio: {String(event.details.audio)}</span>
              )}
              {event.details.subtitle && (
                <span>
                  {t('Subtitles', 'Sous-titres')}:{' '}
                  {String(event.details.subtitle)}
                </span>
              )}
              {event.details.method && (
                <span>{String(event.details.method)}</span>
              )}
              {event.details.resource && (
                <span>#{String(event.details.resource)}</span>
              )}
            </div>
          </li>
        ))}
      </ol>
      {data && !data.events.length && (
        <p className="rounded-xl border border-dashed border-gray-700 p-8 text-center text-gray-400">
          {t(
            'No recorded activity for these filters.',
            'Aucune activité enregistrée pour ces filtres.'
          )}
        </p>
      )}
      <div className="flex gap-3">
        <button
          className="min-h-11 rounded-lg border border-gray-600 px-4 text-sm text-white disabled:opacity-40"
          disabled={!pages.length}
          onClick={() => setPages((p) => p.slice(0, -1))}
        >
          {t('Newer', 'Plus récent')}
        </button>
        <button
          className="min-h-11 rounded-lg border border-gray-600 px-4 text-sm text-white disabled:opacity-40"
          disabled={!data?.next}
          onClick={() => data?.next && setPages((p) => [...p, data.next!])}
        >
          {t('Older', 'Plus ancien')}
        </button>
      </div>
      <p className="text-xs text-gray-400">
        {t(
          'Playback is observed every 5 seconds without sending controls. Very brief actions between samples can be missed; a jump can also reflect recovery. No passwords, tokens, IP addresses or chat content are recorded.',
          'La lecture est observée toutes les 5 secondes, sans commande envoyée au lecteur. Les actions très brèves peuvent ne pas apparaître ; un saut peut aussi provenir d’une récupération. Aucun mot de passe, jeton, adresse IP ou message de discussion n’est enregistré.'
        )}
      </p>
    </section>
  );
}
