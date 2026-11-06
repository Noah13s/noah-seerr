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
        'profile-access-denied': 'Accès au profil refusé ; vérifier le compte',
        'website-access-required': 'Accès au site à configurer',
        'website-session-expired': 'Connexion au site à renouveler',
        'website-challenge-required':
          'Validation Cloudflare requise sur le site',
        'website-layout-changed': 'Structure du profil à vérifier',
        'ratio-low': 'Ratio proche du seuil de blocage',
        'hit-and-run': 'Obligations de seed à régulariser',
        'account-warning': 'Avertissement sur le compte',
        'automation-disabled':
          'Téléchargements automatisés désactivés sur le site',
        'seed-contracts': 'Contrats de seed en cours',
        'acknowledgements-required': 'Remerciements en attente sur le site',
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
        'profile-access-denied': 'Profile access denied; check tracker account',
        'website-access-required': 'Website access needs configuration',
        'website-session-expired': 'Website sign-in needs renewal',
        'website-challenge-required':
          'Cloudflare verification required on the website',
        'website-layout-changed': 'Profile page structure needs review',
        'ratio-low': 'Ratio approaching the download restriction threshold',
        'hit-and-run': 'Outstanding seeding obligations',
        'account-warning': 'Account warning',
        'automation-disabled': 'Automated downloads disabled on the website',
        'seed-contracts': 'Active seeding contracts',
        'acknowledgements-required':
          'Outstanding acknowledgements on the website',
      };
  const shown = trackers.filter(
    (t) => t.budgeted || t.monitored || t.reason || t.adapterError
  );
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
          : 'Credit is reserved before new downloads. Zen is never spent automatically.'}{' '}
        {french
          ? 'Les autres comptes sont surveillés sans inventer de crédit ni de droit de téléchargement.'
          : 'Other accounts are monitored without assuming credit or download permission.'}
      </p>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {shown.map((t) => {
          const health = t.health;
          const status =
            t.reason ||
            t.adapterError ||
            (t.monitored && !t.budgeted && !t.healthFresh
              ? 'profile-unavailable'
              : undefined);
          const attention = status || health?.warnings?.length;
          const checked = t.healthCheckedAt || t.checkedAt;
          const fresh = t.healthCheckedAt ? t.healthFresh : t.fresh;
          return (
            <article
              key={t.id}
              className={`min-w-0 rounded-xl border p-4 ${attention ? 'border-amber-700/60 bg-amber-950/20' : 'border-gray-600 bg-gray-900/60'}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h4 className="break-words font-medium text-gray-100">
                  {t.name}
                </h4>
                <span
                  className={`text-xs ${attention ? 'text-amber-200' : 'text-emerald-300'}`}
                >
                  {status
                    ? labels[status] ||
                      (french ? 'À vérifier' : 'Needs attention')
                    : french
                      ? t.budgeted
                        ? 'Disponible'
                        : 'Compte surveillé'
                      : t.budgeted
                        ? 'Available'
                        : 'Account monitored'}
                </span>
              </div>
              {health?.source && (
                <p className="mt-2 text-xs text-gray-400">
                  {health.source === 'api'
                    ? 'API'
                    : french
                      ? 'Profil du site · compteurs approximatifs'
                      : 'Website profile · approximate counters'}
                  {!t.budgeted &&
                    (french
                      ? ' · surveillance du compte'
                      : ' · account monitoring')}
                </p>
              )}
              {health && (
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                  {health.ratio !== undefined && (
                    <div>
                      <dt className="text-xs text-gray-400">Ratio</dt>
                      <dd className="tabular-nums text-white">
                        {health.ratio === null
                          ? '∞'
                          : health.ratio.toLocaleString(
                              french ? 'fr-FR' : 'en-GB',
                              { maximumFractionDigits: 2 }
                            )}
                      </dd>
                    </div>
                  )}
                  {health.credits !== undefined && (
                    <div>
                      <dt className="text-xs text-gray-400">
                        {french ? 'Points du site' : 'Site points'}
                      </dt>
                      <dd className="tabular-nums text-white">
                        {health.credits.toLocaleString(
                          french ? 'fr-FR' : 'en-GB',
                          { maximumFractionDigits: 1 }
                        )}
                      </dd>
                    </div>
                  )}
                  {health.bufferBytes !== undefined && (
                    <div>
                      <dt className="text-xs text-gray-400">
                        {french ? 'Marge estimée' : 'Estimated headroom'}
                      </dt>
                      <dd className="tabular-nums text-white">
                        {amount(health.bufferBytes)}
                      </dd>
                    </div>
                  )}
                  {health.hnrCount !== undefined && (
                    <div>
                      <dt className="text-xs text-gray-400">Hit &amp; Run</dt>
                      <dd className="tabular-nums text-white">
                        {health.hnrCount}
                      </dd>
                    </div>
                  )}
                  {health.activeContracts !== undefined && (
                    <div>
                      <dt className="text-xs text-gray-400">
                        {french ? 'Contrats de seed' : 'Seed contracts'}
                      </dt>
                      <dd className="tabular-nums text-white">
                        {health.activeContracts}
                      </dd>
                    </div>
                  )}
                  {(health.slotsUnlimited ||
                    health.slotLimit !== undefined) && (
                    <div>
                      <dt className="text-xs text-gray-400">
                        {french
                          ? 'Téléchargements simultanés'
                          : 'Download slots'}
                      </dt>
                      <dd className="tabular-nums text-white">
                        {health.slotsUnlimited ? '∞' : health.slotLimit}
                      </dd>
                    </div>
                  )}
                </dl>
              )}
              {health?.freeleech && (
                <p className="mt-2 text-xs text-emerald-300">
                  Freeleech
                  {health.freeleechUntil
                    ? ` · ${new Date(health.freeleechUntil).toLocaleString(french ? 'fr-FR' : 'en-GB')}`
                    : ''}
                </p>
              )}
              {health?.warnings?.map((warning) => (
                <p key={warning} className="mt-2 text-xs text-amber-200">
                  {labels[warning]}
                </p>
              ))}
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
              {t.adapterError && t.reason && (
                <p className="mt-2 text-xs text-amber-200">
                  {labels[t.adapterError] ||
                    (french
                      ? 'Vérification à relancer'
                      : 'Verification needs attention')}
                </p>
              )}
              {checked && (
                <p className="mt-2 text-xs text-gray-400">
                  {french ? 'Vérifié' : 'Checked'}:{' '}
                  {new Date(checked).toLocaleString(french ? 'fr-FR' : 'en-GB')}
                  {!fresh
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
                  {new Date(t.retryAt).toLocaleString(
                    french ? 'fr-FR' : 'en-GB'
                  )}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
