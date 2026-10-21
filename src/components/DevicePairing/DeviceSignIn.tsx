import Button from '@app/components/Common/Button';
import axios from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';

interface Pair {
  code: string;
  deviceSecret: string;
  expiresAt: number;
  approvalUrl: string;
  interval: number;
}
export default function DeviceSignIn({
  onAuthenticated,
}: {
  onAuthenticated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pair, setPair] = useState<Pair>();
  const [error, setError] = useState('');
  const [time, setTime] = useState(Date.now());
  const generation = useRef(0);
  const active = useRef<Pair | undefined>(undefined);
  const authenticated = useRef(onAuthenticated);
  authenticated.current = onAuthenticated;
  const cancel = useCallback(() => {
    ++generation.current;
    const value = active.current;
    active.current = undefined;
    if (value)
      void axios
        .post('/api/v1/device-pairing/cancel', {
          deviceSecret: value.deviceSecret,
        })
        .catch(() => {});
  }, []);
  useEffect(() => () => cancel(), [cancel]);
  const start = async () => {
    cancel();
    setOpen(true);
    setPair(undefined);
    setError('');
    const current = generation.current;
    try {
      const { data } = await axios.post<Pair>('/api/v1/device-pairing/start', {
        deviceName: 'Seerr web browser',
      });
      if (current !== generation.current) {
        void axios
          .post('/api/v1/device-pairing/cancel', {
            deviceSecret: data.deviceSecret,
          })
          .catch(() => {});
        return;
      }
      active.current = data;
      setPair(data);
      setTime(Date.now());
    } catch {
      if (current === generation.current)
        setError('Could not create a code. Please try again.');
    }
  };
  useEffect(() => {
    if (!pair) return;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const tick = setInterval(() => setTime(Date.now()), 1000);
    const poll = async () => {
      if (stopped || Date.now() >= pair.expiresAt) return;
      try {
        const { data } = await axios.post('/api/v1/device-pairing/poll', {
          deviceSecret: pair.deviceSecret,
        });
        if (!stopped && data.status === 'authenticated') {
          stopped = true;
          active.current = undefined;
          authenticated.current();
          return;
        }
      } catch (failure) {
        if (
          axios.isAxiosError(failure) &&
          [400, 410].includes(failure.response?.status ?? 0)
        ) {
          if (!stopped)
            setError(
              'This code expired or was cancelled. Generate a new code.'
            );
          return;
        }
      }
      if (!stopped) timer = setTimeout(poll, Math.max(4, pair.interval) * 1000);
    };
    timer = setTimeout(poll, 4000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, [pair]);
  if (!open)
    return (
      <Button className="mt-5 w-full" onClick={() => void start()}>
        Sign in using another device
      </Button>
    );
  const remaining = pair
    ? Math.max(0, Math.ceil((pair.expiresAt - time) / 1000))
    : 0;
  return (
    <section
      className="mt-5 rounded-lg border border-indigo-500/50 bg-gray-900/80 p-4 text-center text-gray-100"
      aria-label="Connect this browser"
    >
      <h3 className="text-lg font-semibold">Connect this browser</h3>
      <p className="my-3 text-sm text-gray-300">
        On a signed-in phone or computer, open your profile menu → Pair a
        device.
      </p>
      {pair && remaining > 0 && !error && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="mx-auto h-44 w-44 rounded bg-white p-2"
            src={`/api/v1/device-pairing/qr?code=${pair.code}`}
            alt="Scan this code with your signed-in device"
          />
          <p className="my-3 select-all font-mono text-3xl font-bold tracking-widest">
            {pair.code}
          </p>
          <p className="text-sm text-gray-400">
            Scan the QR code or enter this code. Expires in{' '}
            {Math.floor(remaining / 60)}:{`${remaining % 60}`.padStart(2, '0')}.
          </p>
          <p className="mt-2 text-sm text-indigo-300" role="status">
            Waiting for approval…
          </p>
        </>
      )}
      {!pair && !error && (
        <p className="my-4" role="status">
          Creating a code…
        </p>
      )}
      {(error || (pair && remaining === 0)) && (
        <>
          <p className="my-4 text-amber-300" role="alert">
            {error || 'This code expired.'}
          </p>
          <Button onClick={() => void start()}>New code</Button>
        </>
      )}
      <Button
        className="mt-4 w-full"
        onClick={() => {
          cancel();
          setOpen(false);
        }}
      >
        Use password instead
      </Button>
    </section>
  );
}
