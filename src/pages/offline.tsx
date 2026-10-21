import Header from '@app/components/Common/Header';
import { useUser } from '@app/hooks/useUser';
import {
  canChooseOfflineFolder,
  chooseOfflineFolder,
  getOfflineEntryFolder,
  getOfflineFolder,
  hasFolderPermission,
} from '@app/utils/offlineDevice';
import {
  cancelOfflineDownload,
  getOfflineDownloads,
  moveOfflineMediaToDevice,
  readOfflineEntries,
  readOfflineFile,
  removeOfflineMedia,
  resumeOfflineDownload,
  subscribeOfflineDownloads,
  type OfflineDownload,
  type OfflineMediaEntry,
} from '@app/utils/offlineMedia';
import type { NextPage } from 'next';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';

const OfflinePage: NextPage = () => {
  const { user } = useUser();
  const intl = useIntl();
  const french = intl.locale.startsWith('fr');
  const t = useCallback((en: string, fr: string) => french ? fr : en, [french]);
  const [entries, setEntries] = useState<OfflineMediaEntry[]>([]);
  const [downloads, setDownloads] = useState<OfflineDownload[]>([]);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [playing, setPlaying] = useState<OfflineMediaEntry | null>(null);
  const [folder, setFolder] = useState<FileSystemDirectoryHandle | null>(null);
  const [entryFolders, setEntryFolders] = useState<Record<string, FileSystemDirectoryHandle>>({});
  const [folderSupported, setFolderSupported] = useState(false);
  const [moving, setMoving] = useState<{ title: string; progress: number } | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const objectUrl = useRef<string | null>(null);
  const profileId = user?.id;

  useEffect(() => {
    setFolderSupported(canChooseOfflineFolder());
  }, []);

  useEffect(() => {
    if (!profileId) return;
    let active = true;
    void getOfflineFolder(profileId).then((selected) => {
      if (active) setFolder(selected);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [profileId]);

  useEffect(() => {
    if (!profileId) return;
    let active = true;
    localStorage.setItem('noah-stream-offline-profile', String(profileId));
    localStorage.setItem('noah-stream-offline-locale', intl.locale);
    const refresh = () => {
      if (!navigator.storage?.getDirectory) {
        setMessage(t('Offline storage is not supported by this browser.', 'Le stockage hors ligne n’est pas pris en charge par ce navigateur.'));
        return;
      }
      void readOfflineEntries(profileId).then(async (items) => {
        const folders = await Promise.all(items.filter((item) => item.storage === 'device').map(async (item) =>
          [item.id, await getOfflineEntryFolder(profileId, item.id)] as const
        ));
        if (active) {
          setEntryFolders(Object.fromEntries(folders.filter(([, handle]) => !!handle)) as Record<string, FileSystemDirectoryHandle>);
          setEntries(items);
        }
      }).catch(() => {
        if (active) setMessage(t('Offline library could not be opened.', 'La bibliothèque hors ligne ne peut pas être ouverte.'));
      });
    };
    let activeIds = new Set(getOfflineDownloads(profileId).filter((item) => !item.error).map((item) => item.id));
    const update = () => {
      const current = getOfflineDownloads(profileId);
      if (active) setDownloads(current);
      const nextActiveIds = new Set(current.filter((item) => !item.error).map((item) => item.id));
      if ([...activeIds].some((id) => !nextActiveIds.has(id))) refresh();
      activeIds = nextActiveIds;
    };
    refresh();
    update();
    const unsubscribe = subscribeOfflineDownloads(update);
    return () => { active = false; unsubscribe(); };
  }, [profileId, intl.locale, t]);

  useEffect(() => () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
  }, []);

  const stop = () => {
    video.current?.pause();
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
    setPlaying(null);
  };

  const chooseFolder = async () => {
    if (!profileId) return;
    try {
      setMessage('');
      setNotice('');
      // The chooser is the first asynchronous browser action from this click.
      const selected = await chooseOfflineFolder(profileId);
      setFolder(selected);
      const existing = await readOfflineEntries(profileId);
      for (const entry of existing.filter((item) => item.storage !== 'device')) {
        setMoving({ title: entry.title, progress: 0 });
        await moveOfflineMediaToDevice(profileId, entry, selected, (progress) => {
          setMoving({ title: entry.title, progress });
        });
        setEntryFolders((current) => ({ ...current, [entry.id]: selected }));
      }
      setNotice(t('Saved browser copies were moved to the selected folder.', 'Les copies du navigateur ont été déplacées vers le dossier choisi.'));
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setMessage(error instanceof Error ? error.message : t('Could not use this folder.', 'Impossible d’utiliser ce dossier.'));
      }
    } finally {
      void readOfflineEntries(profileId).then(setEntries).catch(() => undefined);
      setMoving(null);
    }
  };

  const play = async (entry: OfflineMediaEntry) => {
    if (!profileId) return;
    stop();
    setMessage('');
    try {
      const file = await readOfflineFile(profileId, entry, entryFolders[entry.id]);
      objectUrl.current = URL.createObjectURL(file);
      setPlaying(entry);
      requestAnimationFrame(() => {
        if (video.current && objectUrl.current) {
          video.current.src = objectUrl.current;
          void video.current.play().catch((error: Error) => {
            setMessage(error.name === 'NotAllowedError'
              ? t('Press Play in the video controls to start this file.', 'Appuyez sur Lecture dans les commandes vidéo pour démarrer ce fichier.')
              : t('This browser cannot play the saved video format.', 'Ce navigateur ne peut pas lire le format vidéo enregistré.'));
          });
          video.current.scrollIntoView({ behavior: 'smooth' });
        }
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('This file cannot be played by this browser.', 'Ce fichier ne peut pas être lu par ce navigateur.'));
    }
  };

  const remove = async (entry: OfflineMediaEntry) => {
    if (!profileId) return;
    if (entry.storage === 'device') {
      const deviceFolder = entryFolders[entry.id];
      if (!deviceFolder || !await hasFolderPermission(deviceFolder, 'readwrite', true)) {
        setMessage(t('Allow access to the saved video folder to remove this file.', 'Autorisez l’accès au dossier de la vidéo pour supprimer ce fichier.'));
        return;
      }
    }
    if (!window.confirm(t('Remove this offline copy?', 'Supprimer cette copie hors ligne ?'))) return;
    if (playing?.id === entry.id) stop();
    try {
      await removeOfflineMedia(profileId, entry.id);
      setEntries(await readOfflineEntries(profileId));
    } catch {
      setMessage(t('Could not remove this offline copy.', 'Impossible de supprimer cette copie hors ligne.'));
    }
  };

  const retry = async (id: string) => {
    if (!profileId || !folder || !await hasFolderPermission(folder, 'readwrite', true)) {
      setMessage(t('Choose or allow access to your download folder first.', 'Choisissez votre dossier de téléchargement ou autorisez-y l’accès.'));
      return;
    }
    resumeOfflineDownload(profileId, id);
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl px-0 py-4 pb-20 text-white sm:px-4 sm:py-8">
      <Header>{t('Offline library', 'Bibliothèque hors ligne')}</Header>
      <p className="mt-2 text-sm text-gray-300">
        {t('Downloads and saved videos for this profile on this device.', 'Téléchargements et vidéos enregistrées pour ce profil sur cet appareil.')}
      </p>
      <section className="mt-6 min-w-0 rounded-xl border border-gray-600 bg-gray-800 p-4 sm:p-5">
        <h2 className="text-lg font-semibold">{t('Download folder', 'Dossier de téléchargement')}</h2>
        <p className="mt-2 break-words text-sm text-gray-300 [overflow-wrap:anywhere]">
          {folder
            ? `${t('Selected folder', 'Dossier choisi')}: ${folder.name}. ${t('Future downloads use this folder; files already saved in another device folder stay there.', 'Les prochains téléchargements utiliseront ce dossier ; les fichiers déjà enregistrés dans un autre dossier y restent.')}`
            : t('Choose a folder on this device. Saved browser copies will be moved there.', 'Choisissez un dossier sur cet appareil. Les copies enregistrées dans le navigateur y seront déplacées.')}
        </p>
        <button type="button" disabled={!folderSupported || !!moving} onClick={() => void chooseFolder()} className="mt-4 min-h-11 w-full rounded-md bg-indigo-600 px-3 py-2 text-sm hover:bg-indigo-500 disabled:opacity-50 sm:w-auto">
          {folder ? t('Change folder', 'Changer de dossier') : t('Choose folder', 'Choisir un dossier')}
        </button>
        {!folderSupported && <p className="mt-2 text-sm text-amber-200">{t('This browser cannot choose a device folder.', 'Ce navigateur ne permet pas de choisir un dossier local.')}</p>}
        {moving && <p role="status" className="mt-3 break-words text-sm text-gray-200 [overflow-wrap:anywhere]">{t('Moving', 'Déplacement')} {moving.title}: {moving.progress}%</p>}
      </section>
      {message && <p role="alert" className="mt-4 text-red-300">{message}</p>}
      {notice && <p role="status" className="mt-4 text-emerald-300">{notice}</p>}
      {playing && (
        <section className="mt-6">
          <h2 className="mb-2 break-words text-lg font-semibold [overflow-wrap:anywhere]">{playing.title}</h2>
          {/* Downloaded media has no separate caption file to attach. */}
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={video} controls playsInline onError={() => setMessage(t('This browser cannot play the saved video format.', 'Ce navigateur ne peut pas lire le format vidéo enregistré.'))} className="max-h-[75vh] w-full rounded-lg bg-black" />
        </section>
      )}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {downloads.map((download) => (
          <article key={download.id} className="min-w-0 rounded-xl border border-gray-600 bg-gray-800 p-4 sm:p-5">
            <div className="text-xs font-semibold uppercase text-indigo-300">{download.kind === 'episode' ? t('Episode', 'Épisode') : t('Movie', 'Film')}</div>
            <h2 className="mt-2 break-words text-lg font-semibold [overflow-wrap:anywhere]">{download.title}</h2>
            {download.error ? (
              <p role="alert" className="mt-3 break-words text-sm text-red-300 [overflow-wrap:anywhere]">{download.error}</p>
            ) : (
              <div className="mt-3">
                <div className="mb-1 text-sm text-gray-300">{download.progress === 100 ? t('Saving to folder', 'Enregistrement dans le dossier') : `${t('Downloading', 'Téléchargement')} ${download.progress}%`}</div>
                <progress aria-label={t('Download progress', 'Progression du téléchargement')} value={download.progress} max={100} className="w-full" />
              </div>
            )}
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {download.error && (
                <button type="button" onClick={() => void retry(download.id)} className="min-h-11 w-full rounded-md bg-indigo-600 px-3 py-2 text-sm hover:bg-indigo-500 sm:w-auto">
                  {t('Retry', 'Réessayer')}
                </button>
              )}
              <button type="button" onClick={() => profileId && cancelOfflineDownload(profileId, download.id)} className="min-h-11 w-full rounded-md border border-gray-500 px-3 py-2 text-sm hover:border-indigo-400 sm:w-auto">
                {download.error ? t('Remove partial download', 'Supprimer le téléchargement partiel') : t('Cancel download', 'Annuler le téléchargement')}
              </button>
            </div>
          </article>
        ))}
        {entries.map((entry) => (
          <article key={entry.id} className="min-w-0 rounded-xl border border-gray-600 bg-gray-800 p-4 sm:p-5">
            <div className="text-xs font-semibold uppercase text-indigo-300">{entry.kind === 'episode' ? t('Episode', 'Épisode') : t('Movie', 'Film')}</div>
            <h2 className="mt-2 break-words text-lg font-semibold [overflow-wrap:anywhere]">{entry.title}</h2>
            <p className="mt-2 break-words text-sm text-gray-300 [overflow-wrap:anywhere]">{(entry.bytes / 1024 ** 3).toFixed(2)} GB · {new Date(entry.savedAt).toLocaleDateString(french ? 'fr-FR' : 'en-US')} · {entry.storage === 'device' ? (entryFolders[entry.id]?.name ?? t('Device folder', 'Dossier local')) : t('Browser storage', 'Stockage du navigateur')}</p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button type="button" disabled={entry.storage === 'device' && !entryFolders[entry.id]} onClick={() => void play(entry)} className="min-h-11 w-full rounded-md bg-indigo-600 px-3 py-2 text-sm hover:bg-indigo-500 disabled:opacity-50 sm:w-auto">{t('Play', 'Lire')}</button>
              <button type="button" onClick={() => void remove(entry)} className="min-h-11 w-full rounded-md border border-gray-500 px-3 py-2 text-sm hover:border-red-400 sm:w-auto">{t('Remove', 'Supprimer')}</button>
            </div>
          </article>
        ))}
        {!downloads.length && !entries.length && !message && (
          <p className="rounded-xl border border-dashed border-gray-600 p-6 text-gray-300 sm:col-span-2 lg:col-span-3">
            {t('No saved videos yet. Open an available movie or episode and choose Make available offline.', 'Aucune vidéo enregistrée. Ouvrez un film ou un épisode disponible puis choisissez Disponible hors ligne.')}
          </p>
        )}
      </div>
    </div>
  );
};

export default OfflinePage;
