/** A decoded, sample-looped track, independent of the game's rendering loop. */
export class LoopingMusic {
  private context?: AudioContext;
  private source?: AudioBufferSourceNode;
  private gain?: GainNode;
  private buffer?: Promise<AudioBuffer>;
  private requested = false;
  private revision = 0;
  private pageActive = true;
  private disposed = false;
  private resuming?: Promise<void>;

  constructor(private url: string, private volume = 0.24) {
    window.addEventListener('pagehide', this.pageHide);
    window.addEventListener('pageshow', this.pageShow);
    document.addEventListener('visibilitychange', this.visibilityChange);
  }

  get enabled(): boolean { return this.requested; }

  async setEnabled(enabled: boolean): Promise<boolean> {
    if (this.disposed) return false;
    const revision = ++this.revision;
    this.requested = enabled;
    if (!enabled) {
      if (this.context && this.context.state !== 'closed') await this.context.suspend();
      return this.requested;
    }

    try {
      if (!this.context || this.context.state === 'closed') {
        const AudioContextClass = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextClass) throw new Error('Web Audio is unavailable in this browser.');
        this.context = new AudioContextClass();
        this.context.addEventListener('statechange', this.recover);
        this.gain = this.context.createGain();
        this.gain.gain.value = this.volume;
        this.gain.connect(this.context.destination);
        this.source = undefined;
        this.buffer = undefined;
      }
      const context = this.context;
      // Unlock audio during the button's user gesture, before fetching/decoding.
      const resumed = context.resume();
      this.buffer ??= fetch(this.url).then(async response => {
        if (!response.ok) throw new Error(`Music could not be loaded (${response.status}).`);
        return context.decodeAudioData(await response.arrayBuffer());
      }).catch(error => { this.buffer = undefined; throw error; });
      const [buffer] = await Promise.all([this.buffer, resumed]);
      if (this.disposed || revision !== this.revision || !this.requested) return this.requested;
      if (!this.source) {
        const source = context.createBufferSource();
        source.buffer = buffer;
        // Loop in the audio engine itself; no MP3 end event or frame timer is needed.
        source.loop = true;
        source.loopStart = 0;
        source.loopEnd = buffer.duration;
        source.connect(this.gain!);
        source.start();
        this.source = source;
      }
      return true;
    } catch (error) {
      if (revision !== this.revision || this.disposed) return this.requested;
      this.requested = false;
      throw error;
    }
  }

  private recover = (): void => {
    const context = this.context;
    if (!this.requested || !this.pageActive || document.visibilityState === 'hidden' || !context || context.state === 'running' || context.state === 'closed' || this.resuming) return;
    this.resuming = context.resume().catch(() => {
      // Browsers may require another user gesture following a system interruption.
    }).finally(() => { this.resuming = undefined; });
  };
  private pageHide = (): void => {
    this.pageActive = false;
    if (this.context && this.context.state !== 'closed') void this.context.suspend().catch(() => {});
  };
  private pageShow = (): void => { this.pageActive = true; this.recover(); };
  private visibilityChange = (): void => { if (document.visibilityState === 'visible') this.recover(); };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.requested = false;
    ++this.revision;
    window.removeEventListener('pagehide', this.pageHide);
    window.removeEventListener('pageshow', this.pageShow);
    document.removeEventListener('visibilitychange', this.visibilityChange);
    this.context?.removeEventListener('statechange', this.recover);
    this.source?.stop();
    this.source?.disconnect();
    this.gain?.disconnect();
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
  }
}
