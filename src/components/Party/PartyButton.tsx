import type { PlayButtonLink } from '@app/components/Common/PlayButton';
import { useUser } from '@app/hooks/useUser';
import { prepareSession } from '@app/utils/jellyfinSession';
import { UserGroupIcon } from '@heroicons/react/24/outline';
import axios from 'axios';
import { useRouter } from 'next/router';
import { useState } from 'react';
import toast from 'react-hot-toast';

export default function PartyButton({ link }: { link: PlayButtonLink }) {
  const { user } = useUser();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  return (
    <button
      type="button"
      disabled={busy}
      title="Create a watch party"
      className="media-action inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-gray-600 px-3 py-2 text-sm text-white hover:border-indigo-300 focus:ring-2 focus:ring-indigo-400 disabled:opacity-50"
      onClick={async () => {
        setBusy(true);
        try {
          await prepareSession(user.id);
          const url = new URL(link.url, location.origin);
          const params = new URLSearchParams(
            url.hash.split('?')[1] || url.search
          );
          const itemId = params.get('id') || params.get('itemId');
          if (!itemId) throw new Error('Choose an available movie or episode.');
          const { data } = await axios.post('/api/v1/parties', { itemId });
          await router.push(`/party/${data.id}`);
        } catch (error) {
          toast.error(
            axios.isAxiosError(error)
              ? error.response?.data?.message || 'Could not create the party.'
              : (error as Error).message
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <UserGroupIcon className="h-5 w-5 shrink-0" />
      <span>{busy ? 'Creating…' : 'Watch party'}</span>
    </button>
  );
}
