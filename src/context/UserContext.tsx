import type { User } from '@app/hooks/useUser';
import { useUser } from '@app/hooks/useUser';
import axios from 'axios';
import { useRouter } from 'next/dist/client/router';
import { useEffect, useRef } from 'react';

interface UserContextProps {
  initialUser: User;
  children?: React.ReactNode;
}

/**
 * This UserContext serves the purpose of just preparing the useUser hooks
 * cache on server side render. It also will handle redirecting the user to
 * the login page if their session ever becomes invalid.
 */
export const UserContext = ({ initialUser, children }: UserContextProps) => {
  const { user, error, revalidate } = useUser({ initialData: initialUser });
  const router = useRouter();
  const routing = useRef(false);
  const activitySent = useRef({ userId: 0, at: 0 });
  const userId = user?.id;

  useEffect(() => {
    if (
      !userId ||
      router.pathname.match(
        /(login|setup|resetpassword)|^\/(party(?:\/|$)|pair-device$)/
      )
    )
      return;

    const recordActivity = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (activitySent.current.userId !== userId) {
        activitySent.current = { userId, at: 0 };
      }
      if (now - activitySent.current.at < 5 * 60 * 1000) return;
      activitySent.current.at = now;
      void axios
        .post('/api/v1/auth/activity')
        .then(() => {
          window.dispatchEvent(new Event('seerr-user-activity-recorded'));
        })
        .catch(() => {
          activitySent.current.at = 0;
        });
    };

    recordActivity();
    window.addEventListener('pointerdown', recordActivity, { passive: true });
    window.addEventListener('keydown', recordActivity);
    document.addEventListener('visibilitychange', recordActivity);
    router.events.on('routeChangeComplete', recordActivity);
    return () => {
      window.removeEventListener('pointerdown', recordActivity);
      window.removeEventListener('keydown', recordActivity);
      document.removeEventListener('visibilitychange', recordActivity);
      router.events.off('routeChangeComplete', recordActivity);
    };
  }, [userId, router.pathname, router.events]);

  useEffect(() => {
    revalidate();
  }, [router.pathname, revalidate]);

  useEffect(() => {
    if (
      !router.pathname.match(
        /(login|setup|resetpassword)|^\/(party(?:\/|$)|pair-device$)/
      ) &&
      (!user || error) &&
      !routing.current
    ) {
      routing.current = true;
      location.href = '/login';
    }
  }, [router, user, error]);

  return <>{children}</>;
};
