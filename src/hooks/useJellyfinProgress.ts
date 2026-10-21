import axios from 'axios';
import useSWR from 'swr';

interface JellyfinSession { userId: string; accessToken: string }
interface JellyfinItem { RunTimeTicks?: number; MediaSources?: { RunTimeTicks?: number }[]; UserData?: { PlaybackPositionTicks?: number; PlayedPercentage?: number; Played?: boolean } }

const itemIdFromUrl = (url?: string) => {
  if (!url) return undefined;
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.searchParams.get('id') ?? new URLSearchParams(parsed.hash.split('?')[1] ?? '').get('id') ?? undefined;
  } catch { return undefined; }
};

const useJellyfinProgress = (url?: string) => {
  const itemId = itemIdFromUrl(url);
  const { data: session } = useSWR<JellyfinSession>(itemId ? '/api/v1/auth/jellyfin-session' : null);
  const { data, mutate } = useSWR<JellyfinItem>(
    session && itemId ? ['jellyfin-progress', session.userId, itemId, session.accessToken] : null,
    async ([, userId, id, token]: [string, string, string, string]) =>
      (await axios.get(`/player/Users/${userId}/Items/${id}?api_key=${encodeURIComponent(token)}&_=${Date.now()}`, { headers: { 'X-Emby-Token': token, Authorization: `MediaBrowser Token="${token}"`, 'Cache-Control': 'no-cache' } })).data,
    { refreshInterval: 30_000 }
  );
  const ticks = Number(data?.UserData?.PlaybackPositionTicks ?? 0);
  const total = Number(data?.RunTimeTicks ?? data?.MediaSources?.[0]?.RunTimeTicks ?? 0);
  const percent = Math.max(0, Math.min(100, Number(total > 0 ? ticks / total * 100 : data?.UserData?.PlayedPercentage ?? 0)));
  return { percent, hasProgress: ticks > 0 && percent < 95, played: data?.UserData?.Played === true, refresh: () => mutate() };
};

export default useJellyfinProgress;
