import Button from '@app/components/Common/Button';
import PageTitle from '@app/components/Common/PageTitle';
import { useUser } from '@app/hooks/useUser';
import axios from 'axios';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useRef, useState } from 'react';

type Decoder = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: { inversionAttempts: string }
) => { data: string } | null;
declare global {
  interface Window {
    jsQR?: Decoder;
  }
}
const normalized = (code: string) => code.toUpperCase().replace(/[\s-]/g, '');
function scannedCode(value: string): string {
  const url = new URL(value, window.location.origin);
  if (url.origin !== window.location.origin || url.pathname !== '/pair-device')
    throw new Error(
      'Scan the QR code displayed by Seerr on your other device.'
    );
  const code = normalized(url.searchParams.get('code') ?? '');
  if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(code))
    throw new Error('That QR code does not contain a valid pairing code.');
  return code;
}
let decoderLoad: Promise<void> | undefined;
const loadDecoder = () =>
  (decoderLoad ??= new Promise<void>((resolve, reject) => {
    if (window.jsQR) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = '/device-pairing/jsQR-1.4.0.js';
    script.onload = () => resolve();
    script.onerror = () => {
      decoderLoad = undefined;
      reject(new Error('Could not load the scanner. Enter the code instead.'));
    };
    document.head.appendChild(script);
  }));
export default function PairDevice() {
  const { user } = useUser();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [device, setDevice] = useState<{
    deviceName: string;
    expiresAt: number;
  }>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [scanning, setScanning] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | undefined>(undefined);
  const scanGeneration = useRef(0);
  const inspectGeneration = useRef(0);
  const queryRead = useRef(false);
  const stopCamera = useCallback(() => {
    ++scanGeneration.current;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = undefined;
    if (video.current) video.current.srcObject = null;
    setScanning(false);
  }, []);
  useEffect(
    () => () => {
      ++inspectGeneration.current;
      stopCamera();
    },
    [stopCamera]
  );
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) stopCamera();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, [stopCamera]);
  const inspect = useCallback(async (value: string) => {
    const request = ++inspectGeneration.current;
    setCode(value);
    setError('');
    setDevice(undefined);
    setSuccess(false);
    setBusy(true);
    try {
      const { data } = await axios.post('/api/v1/device-pairing/inspect', {
        code: normalized(value),
      });
      if (request === inspectGeneration.current) setDevice(data);
    } catch (failure) {
      if (request === inspectGeneration.current)
        setError(
          axios.isAxiosError(failure)
            ? (failure.response?.data?.message ?? 'Could not check this code.')
            : 'Could not check this code.'
        );
    } finally {
      if (request === inspectGeneration.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (!user || !router.isReady || queryRead.current) return;
    queryRead.current = true;
    if (typeof router.query.code === 'string') void inspect(router.query.code);
  }, [user, router.isReady, router.query.code, inspect]);
  const startCamera = async () => {
    stopCamera();
    setError('');
    setScanning(true);
    const generation = scanGeneration.current;
    try {
      await loadDecoder();
      const camera = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      });
      if (generation !== scanGeneration.current) {
        camera.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = camera;
      if (!video.current) throw new Error('Camera preview is unavailable.');
      video.current.srcObject = camera;
      await video.current.play();
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const scan = () => {
        if (generation !== scanGeneration.current || !video.current || !context)
          return;
        if (video.current.readyState >= 2 && video.current.videoWidth > 0) {
          canvas.width = Math.min(640, video.current.videoWidth);
          canvas.height = Math.round(
            (canvas.width * video.current.videoHeight) /
              video.current.videoWidth
          );
          context.drawImage(video.current, 0, 0, canvas.width, canvas.height);
          const found = window.jsQR?.(
            context.getImageData(0, 0, canvas.width, canvas.height).data,
            canvas.width,
            canvas.height,
            { inversionAttempts: 'dontInvert' }
          );
          if (found) {
            try {
              const value = scannedCode(found.data);
              stopCamera();
              void inspect(value);
            } catch (failure) {
              setError((failure as Error).message);
            }
          }
        }
        if (generation === scanGeneration.current) setTimeout(scan, 250);
      };
      scan();
    } catch {
      if (generation === scanGeneration.current) {
        stopCamera();
        setError(
          'Camera unavailable. Allow camera access or enter the code below.'
        );
      }
    }
  };
  const approve = async () => {
    if (!device) return;
    setBusy(true);
    setError('');
    try {
      await axios.post('/api/v1/device-pairing/approve', {
        code: normalized(code),
      });
      setSuccess(true);
      setDevice(undefined);
    } catch (failure) {
      setError(
        axios.isAxiosError(failure)
          ? (failure.response?.data?.message ?? 'Could not connect. Try again.')
          : 'Could not connect. Try again.'
      );
    } finally {
      setBusy(false);
    }
  };
  const returnPath = `/pair-device${typeof router.query.code === 'string' ? `?code=${encodeURIComponent(router.query.code)}` : ''}`;
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-900 px-4 py-10 text-gray-100">
      <PageTitle title="Pair a device" />
      <section className="w-full max-w-xl rounded-2xl border border-gray-700 bg-gray-800 p-5 shadow-xl sm:p-8">
        <Link className="mb-6 inline-block text-sm text-indigo-300" href="/">
          ← Back to Seerr
        </Link>
        <h1 className="text-3xl font-bold">Pair a device</h1>
        {!user ? (
          <>
            <p className="my-6 text-gray-300">
              Sign in on this browser to approve your TV or another browser.
            </p>
            <Link
              className="inline-flex rounded-lg bg-indigo-600 px-5 py-3 font-semibold"
              href={`/login?returnTo=${encodeURIComponent(returnPath)}`}
            >
              Sign in to continue
            </Link>
          </>
        ) : success ? (
          <div className="py-8" role="status">
            <h2 className="text-xl font-semibold text-emerald-300">
              Device approved
            </h2>
            <p className="mt-3 text-gray-300">
              Your other device will sign in as {user.displayName}{' '}
              automatically.
            </p>
            <Button
              className="mt-6"
              onClick={() => {
                setSuccess(false);
                setCode('');
              }}
            >
              Pair another device
            </Button>
          </div>
        ) : (
          <>
            <p className="mt-3 text-gray-300">
              On your TV or sign-in page, choose{' '}
              <strong>Connect with another device</strong>. Scan its QR code
              here or enter its short code.
            </p>
            <Button
              className="my-5 w-full"
              onClick={() => (scanning ? stopCamera() : void startCamera())}
            >
              {scanning ? 'Stop camera' : 'Scan QR code'}
            </Button>
            <div
              className={
                scanning ? 'mb-5 overflow-hidden rounded-lg bg-black' : 'hidden'
              }
            >
              <video
                ref={video}
                playsInline
                muted
                aria-label="QR scanner camera preview"
                className="max-h-64 w-full object-contain"
              />
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                stopCamera();
                void inspect(code);
              }}
            >
              <label className="mb-2 block font-medium" htmlFor="pair-code">
                Device code
              </label>
              <div className="flex flex-wrap gap-3">
                <input
                  id="pair-code"
                  className="min-w-0 flex-1 rounded-lg border border-gray-600 bg-gray-900 px-4 py-3 font-mono text-xl uppercase tracking-widest"
                  value={code}
                  maxLength={12}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="ABCD-EF34"
                  onChange={(event) => {
                    ++inspectGeneration.current;
                    setBusy(false);
                    setCode(event.target.value);
                    setDevice(undefined);
                    setError('');
                  }}
                />
                <Button
                  type="submit"
                  buttonType="primary"
                  disabled={busy || normalized(code).length !== 8}
                >
                  Check code
                </Button>
              </div>
            </form>
            {error && (
              <p className="mt-4 text-amber-300" role="alert">
                {error}
              </p>
            )}
            {device && (
              <div className="mt-6 rounded-xl border border-indigo-400 bg-indigo-900/25 p-5">
                <h2 className="text-lg font-semibold">
                  Connect {device.deviceName}?
                </h2>
                <p className="mt-3 text-gray-300">
                  Account: <strong>{user.displayName}</strong> ({user.email})
                </p>
                <p className="mt-3 text-sm text-gray-400">
                  Only approve if this code is displayed on a device you are
                  signing in to.
                </p>
                <Button
                  className="mt-5 w-full"
                  buttonType="primary"
                  disabled={busy}
                  onClick={() => void approve()}
                >
                  {busy ? 'Connecting…' : `Connect as ${user.displayName}`}
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}
