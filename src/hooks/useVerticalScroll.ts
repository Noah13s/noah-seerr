import { debounce } from 'lodash';
import { useCallback, useEffect, useRef, useState } from 'react';

const IS_SCROLLING_CHECK_THROTTLE = 200;
const BUFFER_HEIGHT = 200;

/**
 * useVerticalScroll is a custom hook to handle infinite scrolling
 *
 * @param callback Callback is executed when page reaches bottom
 * @param shouldFetch Enables callback when true
 */
const useVerticalScroll = (
  callback: () => void,
  shouldFetch: boolean
): boolean => {
  const [isScrolling, setScrolling] = useState(false);

  const current = useRef({ callback, shouldFetch });
  const scrollingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    current.current = { callback, shouldFetch };
  }, [callback, shouldFetch]);

  const runCallback = useCallback(() => {
    const { callback, shouldFetch } = current.current;
    if (shouldFetch) {
      const scrollTop = Math.max(
        window.pageYOffset,
        document.documentElement.scrollTop,
        document.body.scrollTop
      );
      if (
        window.innerHeight + scrollTop >=
        document.documentElement.offsetHeight - BUFFER_HEIGHT
      ) {
        callback();
      }
    }
  }, []);

  useEffect(() => {
    runCallback();
  }, [callback, shouldFetch, runCallback]);

  useEffect(() => {
    const debouncedCallback = debounce(runCallback, 50);
    const onScroll = () => {
      if (scrollingTimer.current !== undefined) {
        clearTimeout(scrollingTimer.current);
      }
      setScrolling(true);

      scrollingTimer.current = setTimeout(() => {
        setScrolling(false);
      }, IS_SCROLLING_CHECK_THROTTLE);
      debouncedCallback();
    };

    const onResize = () => {
      debouncedCallback();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });

    return () => {
      debouncedCallback.cancel();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);

      if (scrollingTimer.current !== undefined) {
        clearTimeout(scrollingTimer.current);
      }
    };
  }, [runCallback]);

  return isScrolling;
};

export default useVerticalScroll;
