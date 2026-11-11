import Modal from '@app/components/Common/Modal';
import defineMessages from '@app/utils/defineMessages';
import { Transition } from '@headlessui/react';
import type { ReactNode } from 'react';
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useIntl } from 'react-intl';

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const messages = defineMessages('components.PWAInstallPrompt', {
  title: 'Install Noah Stream',
  close: 'Close',
  ios: 'In Safari, tap Share, then Add to Home Screen and confirm Add.',
  mac: 'In Safari, open File, then Add to Dock.',
  android:
    'Open your browser menu and choose Install app or Add to Home screen. If unavailable, open this site in Chrome or Edge.',
  desktop:
    'In Chrome or Edge, use the install icon in the address bar or open the browser menu and choose Apps → Install this site as an app.',
});

const PWAInstallContext = createContext({
  installed: false,
  canPrompt: false,
  installing: false,
  install: async () => {},
});

export const usePWAInstall = () => useContext(PWAInstallContext);

export const PWAInstallProvider = ({ children }: { children: ReactNode }) => {
  const intl = useIntl();
  const deferred = useRef<InstallEvent | undefined>(undefined);
  const busy = useRef(false);
  const [canPrompt, setCanPrompt] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [instructions, setInstructions] = useState<keyof typeof messages>();

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)');
    const updateMode = () => {
      setInstalled(
        standalone.matches ||
          (navigator as Navigator & { standalone?: boolean }).standalone ===
            true
      );
    };
    const capture = (event: Event) => {
      event.preventDefault();
      deferred.current = event as InstallEvent;
      setCanPrompt(true);
    };
    const complete = () => {
      deferred.current = undefined;
      setCanPrompt(false);
      setInstalled(true);
      setInstructions(undefined);
    };
    updateMode();
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', complete);
    standalone.addEventListener('change', updateMode);
    return () => {
      window.removeEventListener('beforeinstallprompt', capture);
      window.removeEventListener('appinstalled', complete);
      standalone.removeEventListener('change', updateMode);
    };
  }, []);

  const install = useCallback(async () => {
    if (busy.current || installed) return;
    const prompt = deferred.current;
    const ua = navigator.userAgent;
    const appleMobile =
      /iPad|iPhone|iPod/.test(ua) ||
      (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const platform = appleMobile
      ? 'ios'
      : /Android/.test(ua)
        ? 'android'
        : /Macintosh/.test(ua) &&
            /Safari/.test(ua) &&
            !/Chrome|Chromium|Edg/.test(ua)
          ? 'mac'
          : 'desktop';
    if (!prompt) {
      setInstructions(platform);
      return;
    }
    busy.current = true;
    setInstalling(true);
    deferred.current = undefined;
    setCanPrompt(false);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'dismissed') {
        try {
          localStorage.setItem('pwa-install-dismissed-at', String(Date.now()));
        } catch {
          // Installation remains available through the profile menu.
        }
      }
    } catch {
      // A consumed/expired browser event must still leave a useful manual path.
      setInstructions(platform);
    } finally {
      busy.current = false;
      setInstalling(false);
    }
  }, [installed]);

  return (
    <PWAInstallContext.Provider
      value={{ installed, canPrompt, installing, install }}
    >
      {children}
      {instructions && (
        <Transition show appear as={Fragment}>
          <Modal
            title={intl.formatMessage(messages.title)}
            onCancel={() => setInstructions(undefined)}
            cancelText={intl.formatMessage(messages.close)}
          >
            <p className="text-gray-200">
              {intl.formatMessage(messages[instructions])}
            </p>
          </Modal>
        </Transition>
      )}
    </PWAInstallContext.Provider>
  );
};
