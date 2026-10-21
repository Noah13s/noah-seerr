import Button from '@app/components/Common/Button';
import defineMessages from '@app/utils/defineMessages';
import { ArrowDownTrayIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const messages = defineMessages('components.PWAInstallPrompt', {
  title: 'Install Noah Stream',
  description: 'Open faster and use the app like a native application.',
  install: 'Install',
  later: 'Not now',
});

const DISMISSED_AT_KEY = 'pwa-install-dismissed-at';
const DISMISS_DURATION = 14 * 24 * 60 * 60 * 1000;

const PWAInstallPrompt = () => {
  const intl = useIntl();
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent>();

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in navigator &&
        (navigator as Navigator & { standalone?: boolean }).standalone);
    const dismissedAt = Number(localStorage.getItem(DISMISSED_AT_KEY) ?? 0);

    if (standalone || Date.now() - dismissedAt < DISMISS_DURATION) return;

    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    return () =>
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
  }, []);

  if (!installPrompt) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED_AT_KEY, String(Date.now()));
    setInstallPrompt(undefined);
  };

  const install = async () => {
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'dismissed') {
      localStorage.setItem(DISMISSED_AT_KEY, String(Date.now()));
    }
    setInstallPrompt(undefined);
  };

  return (
    <div className="fixed bottom-4 left-4 right-4 z-[10000] rounded-xl border border-gray-600 bg-gray-900/95 p-4 shadow-2xl backdrop-blur sm:left-auto sm:w-96">
      <button
        type="button"
        onClick={dismiss}
        className="absolute right-3 top-3 rounded-md p-1 text-gray-400 hover:bg-gray-700 hover:text-white"
        aria-label={intl.formatMessage(messages.later)}
      >
        <XMarkIcon className="h-5 w-5" />
      </button>
      <div className="pr-8">
        <p className="font-semibold text-white">
          {intl.formatMessage(messages.title)}
        </p>
        <p className="mt-1 text-sm text-gray-300">
          {intl.formatMessage(messages.description)}
        </p>
      </div>
      <div className="mt-3 flex gap-2">
        <Button buttonType="primary" buttonSize="sm" onClick={install}>
          <ArrowDownTrayIcon />
          <span>{intl.formatMessage(messages.install)}</span>
        </Button>
        <Button buttonType="default" buttonSize="sm" onClick={dismiss}>
          {intl.formatMessage(messages.later)}
        </Button>
      </div>
    </div>
  );
};

export default PWAInstallPrompt;
