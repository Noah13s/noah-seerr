import Slider from '@app/components/Slider';
import TitleCard from '@app/components/TitleCard';
import { useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import type { MovieResult, TvResult } from '@server/models/Search';
import Link from 'next/link';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Discover.PersonalRecommendations', {
  title: 'Recommended for you',
  subtitle: 'Based on your watch history, ratings and watchlist',
  empty: 'Rate a few films or series in your watch history to get personal recommendations.',
  history: 'Go to My Watch History',
});

type Response = {
  results: (MovieResult | TvResult)[];
  hasProfileSignals: boolean;
};

const PersonalRecommendations = () => {
  const intl = useIntl();
  const { user } = useUser();
  const { data, error } = useSWR<Response>(
    user ? `/api/v1/discover/personal-recommendations?profile=${user.id}` : null,
    { revalidateOnFocus: true }
  );

  if (error || (data?.hasProfileSignals && !data.results.length)) return null;

  return (
    <section aria-label={intl.formatMessage(messages.title)}>
      <div className="slider-header">
        <div className="slider-title flex-col items-start gap-1">
          <span>{intl.formatMessage(messages.title)}</span>
          <span className="text-xs font-normal text-gray-400">
            {intl.formatMessage(messages.subtitle)}
          </span>
        </div>
      </div>
      {data && !data.hasProfileSignals ? (
        <div className="mx-2 mb-6 rounded-lg border border-gray-700 bg-gray-800 p-4 text-sm text-gray-300">
          {intl.formatMessage(messages.empty)}{' '}
          <Link href="/watch-history" className="text-indigo-300 hover:underline">
            {intl.formatMessage(messages.history)}
          </Link>
        </div>
      ) : (
        <Slider
          sliderKey="personal-recommendations"
          isLoading={!data}
          items={(data?.results ?? []).map((item) => (
            <TitleCard
              key={`${item.mediaType}-${item.id}`}
              id={item.id}
              image={item.posterPath}
              summary={item.overview}
              title={item.mediaType === 'movie' ? item.title : item.name}
              year={
                item.mediaType === 'movie' ? item.releaseDate : item.firstAirDate
              }
              userScore={item.voteAverage}
              mediaType={item.mediaType}
              status={item.mediaInfo?.status}
              isAddedToWatchlist={item.mediaInfo?.watchlists?.length ?? 0}
            />
          ))}
        />
      )}
    </section>
  );
};

export default PersonalRecommendations;
