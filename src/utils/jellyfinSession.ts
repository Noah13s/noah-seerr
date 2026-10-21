import axios from 'axios';

export interface JellyfinSession {
  serverId: string;
  serverName: string;
  userId: string;
  accessToken: string;
}

// One short-lived, authenticated preparation serves every episode button.
let preparedSession: {
  userId: number;
  expires: number;
  promise: Promise<JellyfinSession>;
} | null = null;
export const prepareSession = (userId: number): Promise<JellyfinSession> => {
  if (
    preparedSession?.userId === userId &&
    preparedSession.expires > Date.now()
  )
    return preparedSession.promise;
  const entry = {
    userId,
    expires: Date.now() + 30_000,
    promise: axios
      .get<JellyfinSession>('/api/v1/auth/jellyfin-session', { timeout: 10000 })
      .then(({ data }) => data),
  };
  preparedSession = entry;
  void entry.promise.catch(() => {
    if (preparedSession === entry) preparedSession = null;
  });
  return entry.promise;
};

export const isJellyfinUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.pathname.includes('/player/web/');
  } catch {
    return false;
  }
};

export const jellyfinAddress = (url: string): string => {
  const parsed = new URL(url, window.location.origin);
  const webIndex = parsed.pathname.indexOf('/web/');
  const basePath =
    webIndex >= 0 ? parsed.pathname.slice(0, webIndex) : '/player';
  return `${parsed.origin}${basePath}`;
};

export const installJellyfinSession = (
  link: { url: string },
  session: JellyfinSession
) => {
  const address = jellyfinAddress(link.url);
  localStorage.setItem(
    'jellyfin_credentials',
    JSON.stringify({
      Servers: [
        {
          DateLastAccessed: Date.now(),
          LastConnectionMode: 2,
          ManualAddress: address,
          LocalAddress: address,
          Name: session.serverName,
          Id: session.serverId,
          AccessToken: session.accessToken,
          UserId: session.userId,
        },
      ],
    })
  );
};
