import Spinner from '@app/assets/spinner.svg';
import Button from '@app/components/Common/Button';
import Modal from '@app/components/Common/Modal';
import useToasts from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import { formatBytes } from '@app/utils/numberHelpers';
import { Transition } from '@headlessui/react';
import {
  ArrowPathIcon,
  ArrowTrendingUpIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import type { MediaType } from '@server/constants/media';
import axios from 'axios';
import { Fragment, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.MediaUpgrade', {
  requestError: 'Unable to request the upgrade right now.',
  checking: 'Checking 4K',
  check: 'Check for a quality upgrade',
  requested: 'Upgrade requested',
  retry: 'Retry upgrade search',
  already4k: 'Already in 2160p+',
  unavailable: 'No 4K upgrade available',
  episodePlan: '{covered}/{total} episode(s), {releases} torrent(s)',
  moviePlan: '1 movie',
  available: 'Upgrade to {resolution}p available',
  title: 'Upgrade quality',
  download: 'Download upgrade',
  current: 'Current version',
  best: 'Best eligible release',
  plan: 'Upgrade plan: {plan}',
  criteria:
    'Only eligible torrent releases in 2160p or higher are compared. The release with the most seeders is selected first.',
  replacement:
    'After the download and successful import by {service}, the new file will automatically replace the lower-quality version.',
});

interface UpgradeResponse {
  available: boolean;
  minimumResolution: number;
  current: {
    label: string;
    resolution: number;
    lowQualityEpisodeCount: number;
  };
  best: null | {
    title: string;
    quality: string;
    resolution: number;
    seeders: number;
    size: number;
    indexer: string;
    seasonNumber?: number;
  };
  plan: {
    releaseCount: number;
    coveredEpisodeCount: number;
    lowQualityEpisodeCount: number;
    seasonCount: number;
  };
}

interface MediaUpgradeProps {
  tmdbId: number;
  mediaType: MediaType;
}

const MediaUpgrade = ({ tmdbId, mediaType }: MediaUpgradeProps) => {
  const intl = useIntl();
  const endpoint = `/api/v1/upgrade/${mediaType}/${tmdbId}`;
  const [searchTarget, setSearchTarget] = useState<string | null>(null);
  const searchRequested = searchTarget === endpoint;
  const { data, error, isLoading, mutate } = useSWR<UpgradeResponse>(
    searchRequested ? `${endpoint}?search=1` : endpoint,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
    }
  );
  const { addToast } = useToasts();
  const [showModal, setShowModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [queued, setQueued] = useState(false);

  const requestUpgrade = async () => {
    setIsSubmitting(true);
    try {
      const response = await axios.post<{ message: string }>(endpoint);
      setQueued(true);
      setShowModal(false);
      addToast(response.data.message, {
        appearance: 'success',
        autoDismiss: true,
      });
    } catch (requestError) {
      const message = axios.isAxiosError(requestError)
        ? requestError.response?.data?.message
        : undefined;
      addToast(message ?? intl.formatMessage(messages.requestError), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <Button
        buttonType="ghost"
        buttonSize="md"
        className="media-action media-action-compact z-20"
        disabled
        title={intl.formatMessage(messages.checking)}
        aria-label={intl.formatMessage(messages.checking)}
      >
        <Spinner className="h-5 w-5 2xl:mr-2" />
        <span className="hidden 2xl:inline">
          {intl.formatMessage(messages.checking)}
        </span>
      </Button>
    );
  }

  if (error || !data) {
    return null;
  }

  if (queued) {
    return (
      <Button
        buttonType="success"
        buttonSize="md"
        className="media-action media-action-compact z-20"
        disabled
        title={intl.formatMessage(messages.requested)}
        aria-label={intl.formatMessage(messages.requested)}
      >
        <CheckCircleIcon className="h-5 w-5 2xl:mr-2" />
        <span className="hidden 2xl:inline">
          {intl.formatMessage(messages.requested)}
        </span>
      </Button>
    );
  }

  if (!data.available) {
    const already4k = data.current.resolution >= data.minimumResolution;
    return (
      <Button
        buttonType="ghost"
        buttonSize="md"
        className="media-action media-action-compact z-20"
        onClick={() =>
          searchRequested ? void mutate() : setSearchTarget(endpoint)
        }
        title={intl.formatMessage(messages.retry)}
        aria-label={
          already4k
            ? intl.formatMessage(messages.already4k)
            : intl.formatMessage(
                searchRequested ? messages.unavailable : messages.check
              )
        }
      >
        {already4k ? (
          <CheckCircleIcon className="h-5 w-5 text-green-400 2xl:mr-2" />
        ) : (
          <ArrowPathIcon className="h-5 w-5 2xl:mr-2" />
        )}
        <span className="hidden 2xl:inline">
          {already4k
            ? intl.formatMessage(messages.already4k)
            : intl.formatMessage(
                searchRequested ? messages.unavailable : messages.check
              )}
        </span>
      </Button>
    );
  }

  const best = data.best;
  if (!best) return null;

  const tvPlan =
    mediaType === 'tv'
      ? intl.formatMessage(messages.episodePlan, {
          covered: data.plan.coveredEpisodeCount,
          total: data.plan.lowQualityEpisodeCount,
          releases: data.plan.releaseCount,
        })
      : intl.formatMessage(messages.moviePlan);

  return (
    <>
      <Button
        buttonType="success"
        buttonSize="md"
        className="media-action media-action-compact z-20"
        onClick={() => setShowModal(true)}
        title={intl.formatMessage(messages.available, {
          resolution: best.resolution,
        })}
        aria-label={intl.formatMessage(messages.available, {
          resolution: best.resolution,
        })}
      >
        <ArrowTrendingUpIcon className="h-5 w-5 2xl:mr-2" />
        <span className="hidden 2xl:inline">
          {intl.formatMessage(messages.available, {
            resolution: best.resolution,
          })}
        </span>
      </Button>

      <Transition appear show={showModal} as={Fragment}>
        <Modal
          title={intl.formatMessage(messages.title)}
          subTitle={`${best.quality} · ${best.seeders} seeders`}
          onCancel={() => setShowModal(false)}
          cancelText="Annuler"
          onOk={() => void requestUpgrade()}
          okText={intl.formatMessage(messages.download)}
          okButtonType="success"
          okDisabled={isSubmitting}
          backgroundClickable={!isSubmitting}
          loading={isSubmitting}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-gray-700 bg-gray-900/50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {intl.formatMessage(messages.current)}
                </div>
                <div className="mt-1 font-medium text-white">
                  {data.current.label}
                </div>
              </div>
              <div className="rounded-md border border-green-500/50 bg-green-900/20 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-green-300">
                  {intl.formatMessage(messages.best)}
                </div>
                <div className="mt-1 font-medium text-white">
                  {best.quality} · {formatBytes(best.size)}
                </div>
                <div className="mt-1 text-xs text-gray-300">
                  {best.seeders} seeders · {best.indexer}
                  {best.seasonNumber !== undefined
                    ? ` · saison ${best.seasonNumber}`
                    : ''}
                </div>
              </div>
            </div>

            <div className="rounded-md bg-gray-700/40 p-3 text-gray-200">
              <div className="font-medium">
                {intl.formatMessage(messages.plan, { plan: tvPlan })}
              </div>
              <p className="mt-1 text-xs text-gray-300">
                {intl.formatMessage(messages.criteria)}
              </p>
            </div>

            <p className="font-medium text-amber-200">
              {intl.formatMessage(messages.replacement, {
                service: mediaType === 'movie' ? 'Radarr' : 'Sonarr',
              })}
            </p>
          </div>
        </Modal>
      </Transition>
    </>
  );
};

export default MediaUpgrade;
