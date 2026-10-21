import { useUser } from '@app/hooks/useUser';
import {
  getOfflineDownloads,
  resumeOfflineDownloads,
  subscribeOfflineDownloads,
} from '@app/utils/offlineMedia';
import { useEffect } from 'react';

const OfflineDownloadBootstrap = () => {
  const { user } = useUser();
  const profileId = user?.id;

  useEffect(() => {
    if (!profileId) return;
    const resume = () => resumeOfflineDownloads(profileId);
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!getOfflineDownloads(profileId).some((download) => !download.error)) return;
      event.preventDefault();
      event.returnValue = ' ';
    };
    let warningAttached = false;
    const updateWarning = () => {
      const active = getOfflineDownloads(profileId).some((download) => !download.error);
      if (active && !warningAttached) {
        window.addEventListener('beforeunload', warnBeforeUnload);
        warningAttached = true;
      } else if (!active && warningAttached) {
        window.removeEventListener('beforeunload', warnBeforeUnload);
        warningAttached = false;
      }
    };
    const unsubscribe = subscribeOfflineDownloads(updateWarning);
    resume();
    updateWarning();
    window.addEventListener('online', resume);
    return () => {
      unsubscribe();
      window.removeEventListener('online', resume);
      window.removeEventListener('beforeunload', warnBeforeUnload);
    };
  }, [profileId]);

  return null;
};

export default OfflineDownloadBootstrap;
