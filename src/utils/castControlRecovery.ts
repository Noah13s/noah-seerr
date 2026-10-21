export interface RecoverableCastBridge {
  snapshot: () => {
    connected: boolean;
    itemId?: string;
    audioIndex?: number;
    subtitleIndex?: number;
  };
  command: (name: string, value?: number) => unknown;
}

export const castDeadline = async <T>(
  operation: () => T | PromiseLike<T>,
  milliseconds: number
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              Object.assign(Error('The TV control connection timed out.'), {
                code: 'timeout',
              })
            ),
          milliseconds
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

export const isCastTransportError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: string; message?: string };
  return (
    ['timeout', 'channel_error', 'session_error'].includes(value.code || '') ||
    /Could not reconnect to the TV|TV control connection timed out|TV is still unreachable|No active session/i.test(
      value.message || ''
    )
  );
};

// The first command already includes the native SDK's bounded rejoin/retry.
// Replace the sender realm only after that fails; never reload the TV's media.
export const runCastCommand = async <T extends RecoverableCastBridge>(
  initial: T,
  name: string,
  value: number | undefined,
  current: () => T | undefined,
  renew: (failed: T) => Promise<T>,
  valid: () => boolean
) => {
  const itemId = initial.snapshot().itemId;
  const verify = (player: T) => {
    if (!valid()) throw Error('Casting connection changed.');
    const state = player.snapshot();
    if (!state.connected || (itemId && state.itemId !== itemId))
      throw Error('The episode changed. Try the control again.');
    return state;
  };
  try {
    if (!valid()) throw Error('Casting connection changed.');
    return await castDeadline(() => initial.command(name, value), 25000);
  } catch (error) {
    if (!valid() || !isCastTransportError(error)) throw error;
    const live = current();
    const player = live && live !== initial ? live : await renew(initial);
    const state = verify(player);
    // A timed-out track change may have reached the receiver. Its fresh status
    // confirms the selection; do not issue a duplicate burned-subtitle reload.
    if (
      (name === 'audio' && state.audioIndex === value) ||
      (name === 'subtitles' && state.subtitleIndex === value)
    )
      return state;
    return await castDeadline(() => player.command(name, value), 25000);
  }
};
