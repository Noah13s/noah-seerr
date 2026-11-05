import type { TrackerHealth as Health } from '@server/lib/requestPipeline';
import { useIntl } from 'react-intl';

export default function TrackerHealth({ trackers }: { trackers: Health[] }) {
  const french = useIntl().locale.startsWith('fr');
  const amount = (bytes: number) =>
    `${new Intl.NumberFormat(french ? 'fr-FR' : 'en-GB', { maximumFractionDigits: 1 }).format(bytes / 1024 ** 3)} ${french ? 'Gio' : 'GiB'}`;
  const labels: Record<string, string> = french
    ? {
        'tracker-quota-exhausted': 'Crédit de téléchargement épuisé',
        'tracker-credit-stale':
          'Crédit non vérifié ; nouveaux téléchargements suspendus',
        'tracker-access-denied': 'Accès refusé ; compte à vérifier',
        'tracker-credentials-invalid': 'Identifiants du tracker à vérifier',
        'tracker-rate-limited': 'Limite de requêtes atteinte',
        'trackers-unreachable': 'Tracker temporairement inaccessible',
        'profile-token-required': 'Accès API de lecture du profil à configurer',
        'profile-scope-required': 'Permission de lecture du profil manquante',
        'profile-unavailable': 'Vérification du profil indisponible',
        'profile-invalid': 'Accès au profil à vérifier',
        'profile-rate-limited': 'Vérification du profil temporairement limitée',
      }
    : {
        'tracker-quota-exhausted': 'Download allowance exhausted',
        'tracker-credit-stale': 'Credit unverified; new downloads held',
        'tracker-access-denied': 'Access denied; check tracker account',
        'tracker-credentials-invalid': 'Tracker credentials need attention',
        'tracker-rate-limited': 'Request limit reached',
        'trackers-unreachable': 'Tracker temporarily unreachable',
        'profile-token-required':
          'Read-only profile API access needs configuration',
        'profile-scope-required': 'Profile-read permission missing',
        'profile-unavailable': 'Profile verification unavailable',
        'profile-invalid': 'Profile access needs attention',
        'profile-rate-limited': 'Profile verification temporarily rate limited',
      };
  const shown = trackers.filter((t) => t.budgeted || t.reason);
  if (!shown.length) return null;
  return (
    <section
      className="mt-5"
      aria-label={
        french ? 'État des comptes trackers' : 'Tracker account health'
      }
    >
      <h3 className="font-semibold text-white">
        {french ? 'État des comptes trackers' : 'Tracker account health'}
      </h3>
      <p className="mt-1 text-xs text-gray-400">
        {french
          ? 'Le crédit est réservé avant les nouveaux téléchargements. Aucun Zen n’est dépensé automatiquement.'
          : 'Credit is reserved before new downloads. Zen is never spent automatically.'}
      </p>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {shown.map((t) => (
          <article
            key={t.id}
            className={`min-w-0 rounded-xl border p-4 ${t.reason ? 'border-amber-700/60 bg-amber-950/20' : 'border-gray-600 bg-gray-900/60'}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h4 className="break-words font-medium text-gray-100">
                {t.name}
              </h4>
              <span
                className={`text-xs ${t.reason ? 'text-amber-200' : 'text-emerald-300'}`}
              >
                {t.reason
                  ? labels[t.reason] ||
                    (french ? 'À vérifier' : 'Needs attention')
                  : french
                    ? 'Disponible'
                    : 'Available'}
              </span>
            </div>
            {t.budgeted && (
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-gray-400">
                    {french ? 'Marge du compte' : 'Account allowance'}
                  </dt>
                  <dd className="mt-1 tabular-nums text-white">
                    {t.availableBytes === undefined
                      ? '—'
                      : amount(t.availableBytes)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-400">
                    {french ? 'Crédit réservé' : 'Reserved credit'}
                  </dt>
                  <dd className="mt-1 tabular-nums text-white">
                    {amount(t.reservedBytes)}
                  </dd>
                </div>
              </dl>
            )}
            {t.reservations > 0 && (
              <p className="mt-2 text-xs text-gray-400">
                {french
                  ? `${t.reservations} réservation(s), conservées pendant la confirmation des débits du tracker.`
                  : `${t.reservations} reservation(s), retained while tracker accounting is confirmed.`}
              </p>
            )}
            {t.adapterError && (
              <p className="mt-2 text-xs text-amber-200">
                {labels[t.adapterError] ||
                  (french
                    ? 'Vérification à relancer'
                    : 'Verification needs attention')}
              </p>
            )}
            {t.checkedAt && (
              <p className="mt-2 text-xs text-gray-400">
                {french ? 'Vérifié' : 'Checked'}:{' '}
                {new Date(t.checkedAt).toLocaleString(
                  french ? 'fr-FR' : 'en-GB'
                )}
                {!t.fresh
                  ? french
                    ? ' · données anciennes'
                    : ' · stale data'
                  : ''}
              </p>
            )}
            {t.retryAt && (
              <p className="mt-1 text-xs text-gray-400">
                {french
                  ? 'Prochaine vérification au plus tôt'
                  : 'Next probe no earlier than'}
                :{' '}
                {new Date(t.retryAt).toLocaleString(french ? 'fr-FR' : 'en-GB')}
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
