export interface PlayerSnapshot {
  itemId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  position: number;
  duration: number;
  paused?: boolean;
  state?: string;
  code?: string;
}

type Pending = {
  resolve: (state: PlayerSnapshot) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** One protocol endpoint per iframe. No DOM access or Jellyfin globals. */
export class PlayerBridge {
  private pending = new Map<string, Pending>();
  private sequence = 0;
  private closed = false;
  private ready = false;
  private playPromise: Promise<PlayerSnapshot> | null = null;
  private readyWaiters: (() => void)[] = [];
  private readonly deadline: ReturnType<typeof setTimeout>;

  constructor(
    readonly frame: Window,
    private readonly frameId: string,
    private readonly onEvent: (event: string, state?: PlayerSnapshot) => void
  ) {
    window.addEventListener('message', this.receive);
    this.deadline = setTimeout(() => {
      if (!this.ready && !this.closed) {
        this.onEvent('error', {
          position: 0,
          duration: 0,
          code: 'PLAYER_HANDSHAKE_TIMEOUT',
        });
        this.close();
      }
    }, 20_000);
    this.send({ kind: 'hello' });
  }

  private send(message: Record<string, unknown>) {
    this.frame.postMessage(
      { channel: 'noah-player', version: 1, frameId: this.frameId, ...message },
      window.location.origin
    );
  }

  private receive = (event: MessageEvent) => {
    const message = event.data;
    if (
      this.closed ||
      event.source !== this.frame ||
      event.origin !== window.location.origin ||
      message?.channel !== 'noah-player' ||
      message.version !== 1 ||
      message.frameId !== this.frameId
    )
      return;
    if (message.kind === 'reply' && typeof message.id === 'string') {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.state);
      else pending.reject(new Error(message.code || 'PLAYER_COMMAND_FAILED'));
    } else if (message.kind === 'event' && typeof message.event === 'string') {
      const state = message.state;
      if (
        state &&
        ((state.position !== undefined &&
          (!Number.isFinite(state.position) ||
            state.position < 0 ||
            state.position > 86400)) ||
          (state.duration !== undefined &&
            (!Number.isFinite(state.duration) || state.duration < 0)))
      )
        return;
      if (message.event === 'ready') {
        this.ready = true;
        clearTimeout(this.deadline);
        const waiting = this.readyWaiters.splice(0);
        waiting.forEach((start) => start());
      }
      this.onEvent(message.event, state);
    }
  };

  command(action: string, payload: Record<string, unknown> = {}) {
    return new Promise<PlayerSnapshot>((resolve, reject) => {
      if (this.closed) return reject(new Error('PLAYER_STOPPED'));
      const id = `${this.frameId}:${++this.sequence}`;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('PLAYER_COMMAND_TIMEOUT'));
      }, action === 'play' ? 85_000 : 10_000);
      this.pending.set(id, { resolve, reject, timer });
      const dispatch = () => {
        if (!this.closed && this.pending.has(id))
          this.send({ kind: 'command', id, action, payload });
      };
      if (this.ready || action === 'stop') dispatch();
      else this.readyWaiters.push(dispatch);
    });
  }

  play(resumeTicks?: number) {
    return (this.playPromise ??= this.command('play', { resumeTicks }));
  }

  close() {
    if (this.closed) return;
    this.send({
      kind: 'command',
      id: `${this.frameId}:stop:${++this.sequence}`,
      action: 'stop',
    });
    this.closed = true;
    clearTimeout(this.deadline);
    window.removeEventListener('message', this.receive);
    this.readyWaiters = [];
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('PLAYER_STOPPED'));
    }
    this.pending.clear();
  }
}
