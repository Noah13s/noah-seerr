import AdminCleanupReview from '@app/components/AdminCleanupReview';
import Header from '@app/components/Common/Header';
import useRouteGuard from '@app/hooks/useRouteGuard';
import { Permission, useUser } from '@app/hooks/useUser';
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  CircleStackIcon,
  FilmIcon,
  MagnifyingGlassIcon,
  TvIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import type { NextPage } from 'next';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

type Insights = {
  generatedAt: string;
  retentionDays: number;
  cleanupMode: 'approval-required';
  disk: {
    volumes: { mount: string; total: number; free: number }[];
    libraries: { name: string; bytes: number }[];
  };
  totals: {
    users: number;
    requests: number;
    watched: number;
    watching: number;
  };
  users: {
    id: number;
    name: string;
    completed: number;
    watching: number;
    dropped: number;
    rated: number;
    requests: number;
  }[];
  candidates: {
    mediaType: 'movie' | 'tv';
    tmdbId: number;
    title: string;
    seasonNumber?: number;
    requesterCount: number;
    eligibleAt: string;
    eligible: boolean;
  }[];
};

const formatBytes = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${(bytes / 1024 ** 2).toFixed(0)} MB`;

const DiskCard = ({
  title,
  total,
  free,
  accent,
}: {
  title: string;
  total: number;
  free: number;
  accent: string;
}) => {
  const used = Math.max(0, total - free);
  const percentage = total ? Math.round((used / total) * 100) : 0;
  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/70 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-white">{title}</span>
        <span className="text-sm font-semibold text-white">{percentage}%</span>
      </div>
      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-gray-700">
        <div
          className={`h-full rounded-full ${accent}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between text-xs text-gray-300">
        <span>{formatBytes(used)} used</span>
        <span>{formatBytes(free)} free</span>
      </div>
    </div>
  );
};

const services = [
  {
    name: 'Sonarr',
    path: '/admin-tools/sonarr/',
    description: 'Series and anime',
    icon: TvIcon,
  },
  {
    name: 'Radarr',
    path: '/admin-tools/radarr/',
    description: 'Movies',
    icon: FilmIcon,
  },
  {
    name: 'Prowlarr',
    path: '/admin-tools/prowlarr/',
    description: 'Indexers and search',
    icon: MagnifyingGlassIcon,
  },
  {
    name: 'qBittorrent',
    path: '/admin-tools/qbittorrent/',
    description: 'Download queue and seeding',
    icon: CircleStackIcon,
  },
];

const AdminToolsPage: NextPage = () => {
  useRouteGuard(Permission.ADMIN);
  const { user, hasPermission } = useUser();
  const intl = useIntl();
  const french = intl.locale.startsWith('fr');
  const [active, setActive] = useState(services[0]);
  const {
    data: insights,
    error: insightsError,
    mutate: refreshInsights,
    isValidating,
  } = useSWR<Insights>(
    user && hasPermission(Permission.ADMIN)
      ? '/api/v1/admin-tools/insights'
      : null,
    { refreshInterval: 5 * 60 * 1000 }
  );

  if (!user || !hasPermission(Permission.ADMIN)) return null;

  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-6 sm:px-6">
      <Header>{french ? 'Outils administrateur' : 'Admin tools'}</Header>
      <p className="mt-2 text-sm text-gray-300">
        {french
          ? 'Gérez vos médias, indexeurs et téléchargements ici.'
          : 'Manage media, indexers and downloads here.'}
      </p>
      <section aria-label="Media insights" className="mt-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-white">Media insights</h2>
          <button
            type="button"
            onClick={() => refreshInsights()}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-gray-600 px-3 text-xs text-gray-200 hover:bg-gray-700"
          >
            <ArrowPathIcon
              className={`h-4 w-4 ${isValidating ? 'animate-spin' : ''}`}
            />{' '}
            Refresh
          </button>
        </div>
        {insightsError && (
          <p
            role="alert"
            className="rounded-lg border border-red-700 bg-red-950/40 p-3 text-sm text-red-200"
          >
            Unable to load media insights.
          </p>
        )}
        {insights && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                ['Users', insights.totals.users],
                ['Requests', insights.totals.requests],
                ['Watched titles', insights.totals.watched],
                ['In progress', insights.totals.watching],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-xl border border-gray-700 bg-gradient-to-br from-gray-800 to-gray-900 p-4"
                >
                  <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
                    {label}
                  </div>
                  <div className="mt-2 text-2xl font-bold text-white">
                    {value}
                  </div>
                </div>
              ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-gray-700 bg-gray-900/60 p-4">
                <h3 className="mb-3 flex items-center gap-2 font-semibold text-white">
                  <CircleStackIcon className="h-5 w-5 text-indigo-300" /> Disk
                  space
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  {insights.disk.volumes.map((volume) => (
                    <DiskCard
                      key={volume.mount}
                      title={
                        volume.mount === '/media'
                          ? 'Media drive'
                          : 'System drive'
                      }
                      total={volume.total}
                      free={volume.free}
                      accent={
                        volume.mount === '/media'
                          ? 'bg-emerald-500'
                          : volume.total && volume.free / volume.total < 0.15
                            ? 'bg-rose-500'
                            : 'bg-indigo-500'
                      }
                    />
                  ))}
                </div>
                <div className="mt-4 space-y-2 border-t border-gray-700 pt-3">
                  {insights.disk.libraries.map((library) => (
                    <div
                      key={library.name}
                      className="flex justify-between text-sm"
                    >
                      <span className="capitalize text-gray-300">
                        {library.name}
                      </span>
                      <span className="font-medium text-white">
                        {formatBytes(library.bytes)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-gray-700 bg-gray-900/60 p-4">
                <h3 className="mb-3 flex items-center gap-2 font-semibold text-white">
                  <UsersIcon className="h-5 w-5 text-indigo-300" /> Watch
                  activity by user
                </h3>
                <div className="max-h-72 space-y-2 overflow-y-auto">
                  {insights.users.map((profile) => (
                    <div
                      key={profile.id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-gray-800/80 px-3 py-2"
                    >
                      <span className="min-w-0 truncate text-sm font-medium text-white">
                        {profile.name}
                      </span>
                      <span className="shrink-0 text-xs text-gray-300">
                        {profile.completed} watched · {profile.watching}{' '}
                        watching · {profile.requests} requests
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </section>
      <AdminCleanupReview
        candidates={insights?.candidates}
        onChanged={() => {
          void refreshInsights();
        }}
      />
      <div
        role="tablist"
        aria-label="Administrative services"
        className="mt-5 flex gap-2 overflow-x-auto pb-2"
      >
        {services.map(({ name, path, description, icon: Icon }) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={active.path === path}
            aria-controls="admin-service-panel"
            onClick={() =>
              setActive(
                services.find((service) => service.path === path) ?? services[0]
              )
            }
            title={description}
            className={`flex h-11 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400 ${active.path === path ? 'border-indigo-400 bg-indigo-600 text-white' : 'border-gray-600 bg-gray-800 text-gray-200 hover:border-gray-400 hover:bg-gray-700'}`}
          >
            <Icon className="h-5 w-5" />
            {name}
          </button>
        ))}
      </div>
      <div
        id="admin-service-panel"
        role="tabpanel"
        className="mt-2 overflow-hidden rounded-xl border border-gray-600 bg-gray-900"
      >
        <div className="flex items-center justify-between border-b border-gray-700 px-3 py-2 sm:px-4">
          <span className="font-medium text-white">{active.name}</span>
          <a
            href={active.path}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-indigo-200 hover:text-white"
          >
            {french ? 'Ouvrir en plein écran' : 'Open full screen'}
            <ArrowTopRightOnSquareIcon className="h-4 w-4" />
          </a>
        </div>
        <iframe
          key={active.path}
          src={active.path}
          title={active.name}
          className="h-[calc(100dvh-15rem)] min-h-[28rem] w-full bg-gray-900"
          referrerPolicy="same-origin"
        />
      </div>
    </div>
  );
};

export default AdminToolsPage;
