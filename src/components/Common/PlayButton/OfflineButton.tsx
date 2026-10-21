import { useUser } from '@app/hooks/useUser';
import {
  canChooseOfflineFolder,
  chooseOfflineFolder,
  getOfflineFolder,
  hasFolderPermission,
} from '@app/utils/offlineDevice';
import {
  cancelOfflineDownload,
  getOfflineDownloads,
  offlineFileId,
  readOfflineEntries,
  startOfflineDownload,
  subscribeOfflineDownloads,
  type OfflineDownload,
} from '@app/utils/offlineMedia';
import { ArrowDownTrayIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import type { PlayButtonLink } from '.';

const itemIdFromLink = (link: PlayButtonLink) => {
  try {
    const url = new URL(
      link.url,
      typeof window === 'undefined' ? 'http://localhost' : window.location.origin
    );
    if (!url.pathname.includes('/player/web/')) return null;
    const query = url.hash.split('?')[1];
    const id = new URLSearchParams(query).get('id');
    return id && /^[a-f0-9]{32}$/i.test(id) ? id : null;
  } catch {
    return null;
  }
};

const OfflineButton = ({ link }: { link: PlayButtonLink }) => {
  const { user } = useUser();
  const intl = useIntl();
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [download, setDownload] = useState<OfflineDownload | null>(null);
  const [folder, setFolder] = useState<FileSystemDirectoryHandle | null>(null);
  const [folderLoaded, setFolderLoaded] = useState(false);
  const [folderError, setFolderError] = useState('');
  const profileId = user?.id;
  const itemId = itemIdFromLink(link);
  const context = link.watchProgress;
  const kind = context?.mediaType === 'tv' ? 'episode' : 'movie';
  const eligible =
    !!itemId &&
    !!context &&
    (context.mediaType === 'movie' ||
      (!!context.seasonNumber && !!context.episodeNumber));
  const french = intl.locale.startsWith('fr');

  useEffect(() => {
    if (!profileId) return;
    let active = true;
    setFolderLoaded(false);
    void getOfflineFolder(profileId).then((current) => {
      if (active) setFolder(current);
    }).catch(() => {
      if (active) setFolder(null);
    }).finally(() => {
      if (active) setFolderLoaded(true);
    });
    return () => { active = false; };
  }, [profileId]);

  useEffect(() => {
    if (!eligible || !profileId || !itemId || !navigator.storage?.getDirectory) return;
    let active = true;
    localStorage.setItem('noah-stream-offline-profile', String(profileId));
    localStorage.setItem('noah-stream-offline-locale', intl.locale);
    const id = offlineFileId(kind, itemId);
    const update = () => {
      const current = getOfflineDownloads(profileId).find((entry) => entry.id === id) ?? null;
      if (active) setDownload(current);
      if (!current) {
        void readOfflineEntries(profileId).then((entries) => {
          if (active) setSaved(entries.some((entry) => entry.id === id));
        }).catch(() => undefined);
      }
    };
    update();
    const unsubscribe = subscribeOfflineDownloads(update);
    return () => { active = false; unsubscribe(); };
  }, [eligible, profileId, itemId, kind, intl.locale]);

  if (!eligible || !itemId || !context || !user) return null;

  const progress = download && !download.error ? download.progress : null;

  const label = saved
    ? french ? 'Voir hors ligne' : 'Open offline library'
    : progress !== null
      ? progress === 100 ? french ? 'Enregistrement dans le dossier' : 'Saving to folder' : french ? `Téléchargement ${progress} %` : `Downloading ${progress}%`
      : !folder ? french ? 'Choisir un dossier' : 'Choose download folder'
      : french ? 'Disponible hors ligne' : 'Make available offline';
  const shortLabel = saved
    ? french ? 'Enregistré' : 'Saved'
    : progress !== null
      ? `${progress}%`
      : french ? 'Hors ligne' : 'Offline';

  const click = async () => {
    if (saved) {
      localStorage.setItem('noah-stream-offline-profile', String(user.id));
      localStorage.setItem('noah-stream-offline-locale', intl.locale);
      void router.push('/offline');
      return;
    }
    if (download && !download.error) {
      cancelOfflineDownload(user.id, download.id);
      return;
    }
    setFolderError('');
    if (!canChooseOfflineFolder()) {
      setFolderError(french
        ? 'Ce navigateur ne permet pas de choisir un dossier local. Utilisez Chrome ou Edge sur ordinateur.'
        : 'This browser cannot choose a local folder. Use Chrome or Edge on a computer.');
      return;
    }
    try {
      if (!folder) {
        const chosen = await chooseOfflineFolder(user.id);
        setFolder(chosen);
      } else if (!await hasFolderPermission(folder, 'readwrite', true)) {
        throw new Error(french ? 'Accès au dossier refusé.' : 'Folder access was denied.');
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setFolderError(error instanceof Error ? error.message : french ? 'Dossier indisponible.' : 'Folder unavailable.');
      }
      return;
    }
    void startOfflineDownload({
        profileId: user.id,
        itemId,
        kind,
        title:
          kind === 'episode'
            ? `${context.title} · S${String(context.seasonNumber).padStart(2, '0')}E${String(context.episodeNumber).padStart(2, '0')}`
            : context.title,
        confirmDownload: (bytes, available) => {
          const gb = (value: number) => (value / 1024 ** 3).toFixed(1);
          return window.confirm(
            french
              ? `Enregistrer ${gb(bytes)} Go sur cet appareil ? ${gb(available)} Go disponibles pour ce site.`
              : `Save ${gb(bytes)} GB on this device? ${gb(available)} GB available for this site.`
          );
        },
      });
  };

  return (
    <div className="inline-flex min-w-0 flex-col items-start gap-1">
      <button
        type="button"
        className="media-action inline-flex h-10 items-center gap-1.5 rounded-md border border-gray-600 bg-gray-900/70 px-3 text-sm font-medium text-white transition-colors hover:border-indigo-400 hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400"
        title={label}
        aria-label={label}
        disabled={!folderLoaded}
        onClick={() => void click()}
      >
        {progress !== null ? (
          <XMarkIcon className="h-5 w-5 shrink-0" />
        ) : saved ? (
          <CheckIcon className="h-5 w-5 shrink-0 text-emerald-300" />
        ) : (
          <ArrowDownTrayIcon className="h-5 w-5 shrink-0" />
        )}
        <span className="sm:hidden">{shortLabel}</span>
        <span className="hidden sm:inline">{label}</span>
      </button>
      {download?.error && <span className="max-w-52 text-xs text-red-300" role="alert">{download.error}</span>}
      {folderError && <span className="max-w-52 text-xs text-red-300" role="alert">{folderError}</span>}
    </div>
  );
};

export default OfflineButton;
