import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import DiscoverMovies from '@app/components/Discover/DiscoverMovies';
import DiscoverTv from '@app/components/Discover/DiscoverTv';
import { useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useIntl } from 'react-intl';

const messages = defineMessages('pages.DiscoverAnime', {
  series: 'Series',
  movies: 'Movies',
  hidden: 'Anime is hidden for this profile.',
  settings: 'Show anime in profile settings',
});

const DiscoverAnime = () => {
  const { user } = useUser();
  const router = useRouter();
  const intl = useIntl();

  if (!user) return <LoadingSpinner />;

  if (user.settings?.showAnime === false) {
    return (
      <div className="rounded-lg bg-gray-800 p-6 text-gray-200">
        <p>{intl.formatMessage(messages.hidden)}</p>
        <Link
          href="/profile/settings/main"
          className="mt-3 inline-block text-indigo-300 hover:underline"
        >
          {intl.formatMessage(messages.settings)}
        </Link>
      </div>
    );
  }

  const movieTab = router.query.type === 'movie';
  const tabClass = (active: boolean) =>
    `rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
      active
        ? 'bg-indigo-600 text-white'
        : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
    }`;

  return (
    <>
      <nav aria-label="Anime type" className="mb-5 flex gap-2">
        <Link
          href="/discover/anime?type=tv"
          className={tabClass(!movieTab)}
          aria-current={!movieTab ? 'page' : undefined}
        >
          {intl.formatMessage(messages.series)}
        </Link>
        <Link
          href="/discover/anime?type=movie"
          className={tabClass(movieTab)}
          aria-current={movieTab ? 'page' : undefined}
        >
          {intl.formatMessage(messages.movies)}
        </Link>
      </nav>
      {movieTab ? <DiscoverMovies anime /> : <DiscoverTv anime />}
    </>
  );
};

export default DiscoverAnime;
