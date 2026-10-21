import { PlayCircleIcon, UserGroupIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import useSWR from 'swr';

export default function Parties() {
  const { data, error } = useSWR<{
    results: {
      id: string;
      title: string;
      mediaTitle: string;
      isAdmin: boolean;
    }[];
  }>('/api/v1/parties', { refreshInterval: 15_000 });
  return (
    <section className="py-6">
      <div className="mb-7 flex items-center gap-4">
        <span className="rounded-2xl bg-indigo-500/20 p-4 text-indigo-300">
          <UserGroupIcon className="h-8 w-8" />
        </span>
        <div>
          <h1 className="text-2xl font-bold text-white">Watch parties</h1>
          <p className="mt-1 text-sm text-gray-400">
            Share a movie or episode with friends, including guests without an
            account.
          </p>
        </div>
      </div>
      <div className="mb-6 rounded-xl border border-gray-700 bg-gray-800/50 p-5">
        <h2 className="font-semibold text-white">Start watching together</h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-300">
          Open an available movie or an individual episode and choose{' '}
          <strong>Watch party</strong>. You become the admin and can share an
          invitation link. Guests choose a name and picture, then join your
          playback and chat.
        </p>
      </div>
      {!data && !error && (
        <p role="status" className="text-gray-400">
          Loading your parties…
        </p>
      )}
      {error && (
        <p role="alert" className="text-red-300">
          Your parties could not be loaded. Please try again.
        </p>
      )}
      {data?.results.length === 0 && (
        <p className="py-10 text-center text-gray-400">
          You haven’t joined any active parties yet.
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data?.results.map((room) => (
          <Link
            key={room.id}
            href={`/party/${room.id}`}
            className="group rounded-2xl border border-gray-700 bg-gradient-to-br from-indigo-950/60 to-gray-800 p-6 transition hover:border-indigo-400 focus:ring-2 focus:ring-indigo-400"
          >
            <div className="mb-4 flex items-center justify-between text-indigo-300">
              <UserGroupIcon className="h-7 w-7" />
              <span className="rounded-full bg-gray-700/70 px-3 py-1 text-xs">
                {room.isAdmin ? 'You are the admin' : 'Participant'}
              </span>
            </div>
            <h2 className="text-lg font-semibold text-white">
              {room.mediaTitle}
            </h2>
            <p className="mt-4 flex items-center gap-2 text-sm font-medium text-indigo-300">
              <PlayCircleIcon className="h-5 w-5" />
              Enter party
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
