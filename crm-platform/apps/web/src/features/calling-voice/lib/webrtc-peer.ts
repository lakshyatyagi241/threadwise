import type { DialInput, DialProgress, DialResult, RecordingResult } from '@crm/contracts';
import { CallError, DEFAULT_ICE_SERVERS, endReasonKind } from './calls';
import { foldToCrlf, isUsableSdp, keepOpusCodecs, normalizeRemoteSdp } from './sdp';

/**
 * The operator's browser side of a WhatsApp call (TW-CALL-009, 010, 016, 019): owns the RTCPeerConnection, captures the
 * microphone, makes and applies SDP and talks to the call routes through an injected `CallApi`. Signalling is plain HTTPS with
 * non-trickle ICE. Headless: the screens drive it and read its state through callbacks, and every browser object comes from
 * `PeerEnv`, so tests run it with fakes.
 */

export type CallState = 'idle' | 'connecting' | 'ringing' | 'active' | 'ended';

export type DialRequest = Omit<DialInput, 'sdpOffer'>;

export interface CallApi {
  dial(input: DialInput): Promise<DialResult>;
  progress(callId: string): Promise<DialProgress>;
  accept(callId: string, sdpAnswer: string): Promise<void>;
  reject(callId: string, reason?: string): Promise<void>;
  terminate(callId: string): Promise<void>;
  uploadRecording(callId: string, blob: Blob, filename: string): Promise<RecordingResult>;
}

/** Everything the peer takes from the browser. */
export interface PeerEnv {
  createPeerConnection(config: RTCConfiguration): RTCPeerConnection;
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  /** The audio codecs this browser can send (`RTCRtpSender.getCapabilities('audio')`); null when it cannot say. */
  audioCodecs(): Array<{ mimeType: string }> | null;
  createAudioContext(): AudioContext | null;
  recorderSupported(): boolean;
  recorderTypeSupported(mimeType: string): boolean;
  createRecorder(stream: MediaStream, mimeType: string | undefined): MediaRecorder;
}

export function browserEnv(): PeerEnv {
  return {
    createPeerConnection: (config) => new RTCPeerConnection(config),
    getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
    audioCodecs: () =>
      typeof RTCRtpSender !== 'undefined' && typeof RTCRtpSender.getCapabilities === 'function'
        ? (RTCRtpSender.getCapabilities('audio')?.codecs ?? null)
        : null,
    createAudioContext: () => {
      const w = window as unknown as {
        AudioContext?: typeof AudioContext;
        webkitAudioContext?: typeof AudioContext;
      };
      const Ctor = w.AudioContext ?? w.webkitAudioContext;
      return Ctor ? new Ctor() : null;
    },
    recorderSupported: () => typeof MediaRecorder !== 'undefined',
    recorderTypeSupported: (m) =>
      typeof MediaRecorder !== 'undefined' &&
      typeof MediaRecorder.isTypeSupported === 'function' &&
      MediaRecorder.isTypeSupported(m),
    createRecorder: (stream, mimeType) =>
      mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream),
  };
}

export interface CallPeerOptions {
  api: CallApi;
  /** Full ICE list (TURN included); the four public STUN servers when omitted. Reference read a window global for this. */
  iceServers?: RTCIceServer[];
  onState?: (state: CallState) => void;
  /** The customer's audio, to play; null when the call is torn down. */
  onRemoteStream?: (stream: MediaStream | null) => void;
  /** The recording reached the server (the "Call recording saved to Call logs." toast). */
  onRecordingSaved?: () => void;
  onWarn?: (message: string, error?: unknown) => void;
  env?: Partial<PeerEnv>;
}

/** Meta rings the customer's phone up to about 60 s; the operator's browser waits that long, asking every 1.2 s. */
export const RING_WINDOW_MS = 60_000;
export const RING_POLL_MS = 1200;
/** After the answer is applied, a light poll catches a hang-up whose ICE lingers. */
export const REMOTE_END_POLL_MS = 3000;
/** Non-trickle ICE: ship what has been gathered after this long. */
export const ICE_GATHER_TIMEOUT_MS = 3000;
/** A recording smaller than this is empty: nothing is saved. */
export const MIN_RECORDING_BYTES = 256;
export const RECORDING_MIME_PREFERENCE = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
] as const;

/** The call was torn down while an await was pending (the operator hung up): stop quietly. */
class Aborted extends Error {}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class CallPeer {
  state: CallState = 'idle';
  callId: string | null = null;
  localStream: MediaStream | null = null;

  private pc: RTCPeerConnection | null = null;
  private remoteStream: MediaStream | null = null;
  private readonly api: CallApi;
  private readonly iceServers: RTCIceServer[];
  private readonly env: PeerEnv;
  private readonly opts: CallPeerOptions;

  private recordArmed = false;
  private recorder: MediaRecorder | null = null;
  private recCtx: AudioContext | null = null;
  private recChunks: Blob[] = [];
  private recCallId: string | null = null;
  private upload: Promise<void> = Promise.resolve();

  constructor(opts: CallPeerOptions) {
    this.opts = opts;
    this.api = opts.api;
    this.iceServers = opts.iceServers?.length ? opts.iceServers : DEFAULT_ICE_SERVERS;
    this.env = { ...browserEnv(), ...opts.env };
  }

  get recording(): boolean {
    return this.recordArmed;
  }

  /** Resolves when a recording upload started by the last teardown has finished (for tests and orderly unload). */
  settled(): Promise<void> {
    return this.upload;
  }

  /**
   * Answer an inbound call. Order matters (TW-CALL-009 rule 6): apply the offer, attach the microphone BEFORE the answer is
   * created (else the answer is recvonly and the caller hears silence), Opus only, wait for ICE, then accept. A failure tears
   * everything down and is rethrown.
   */
  async answer(callId: string, sdpOffer: string): Promise<void> {
    if (!isUsableSdp(sdpOffer)) throw new CallError('INVALID_SDP');
    this.callId = callId;
    this.setState('connecting');
    const pc = this.setup();
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: normalizeRemoteSdp(sdpOffer, 'offer') });
      this.live(pc);
      await this.attachMic(pc);
      this.preferOpus(pc);
      const answer = await pc.createAnswer();
      this.live(pc);
      await pc.setLocalDescription(answer);
      this.live(pc);
      const sdp = await this.gatherIce(pc);
      this.live(pc);
      if (!isUsableSdp(sdp)) throw new CallError('LOCAL_SDP_EMPTY');
      await this.api.accept(callId, foldToCrlf(sdp));
      this.live(pc);
      this.setState('active');
      void this.watchRemoteEnd(pc);
    } catch (e) {
      if (e instanceof Aborted) return;
      this.finish(pc);
      throw e;
    }
  }

  /**
   * Place a call: microphone first (a blocked one aborts with no server request), Opus-only offer, wait for ICE, dial, then wait
   * for the customer. Resolves once audio is bridged; throws (after tearing down) when the customer declines, never answers
   * or the request is refused. A refusal that sent a permission request instead leaves no peer open.
   */
  async dial(input: DialRequest): Promise<void> {
    this.setState('connecting');
    const pc = this.setup();
    try {
      await this.attachMic(pc);
      this.preferOpus(pc);
      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      this.live(pc);
      await pc.setLocalDescription(offer);
      this.live(pc);
      const sdp = await this.gatherIce(pc);
      this.live(pc);
      if (!isUsableSdp(sdp)) throw new CallError('LOCAL_SDP_EMPTY');

      const placed = await this.api.dial({ ...input, sdpOffer: foldToCrlf(sdp) });
      if (this.pc !== pc) {
        // Hung up while the request was in flight: do not leave the customer's phone ringing.
        void this.api
          .terminate(placed.callId)
          .catch((err) => this.warn('terminate after cancelled dial failed', err));
        return;
      }
      this.callId = placed.callId;
      this.setState('ringing');
      await this.waitForAnswer(pc);
    } catch (e) {
      if (e instanceof Aborted) return;
      this.finish(pc);
      throw e;
    }
  }

  /**
   * End the call. The server is told only while connecting, ringing or active; a failed terminate never blocks the local
   * teardown (Meta's terminate webhook reconciles). The recording, if armed, is uploaded.
   */
  async hangup(): Promise<void> {
    const id = this.callId;
    if (
      id &&
      (this.state === 'connecting' || this.state === 'ringing' || this.state === 'active')
    ) {
      try {
        await this.api.terminate(id);
      } catch (e) {
        this.warn('terminate failed', e);
      }
    }
    this.teardown(true);
  }

  /** Mute only disables the local audio track; nothing is sent to the server. */
  mute(muted: boolean): void {
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
  }

  /**
   * Arm the recording of this call (the Record button, or automatically for an inbound call). Once armed it cannot be stopped
   * mid-call, so a truncated file never passes for a whole one. False when the browser cannot record.
   */
  startRecording(): boolean {
    if (!this.env.recorderSupported()) return false;
    this.recordArmed = true;
    if (this.remoteStream) this.startRecorder();
    return true;
  }

  // --- internals --------------------------------------------------------------------------------------------------------

  private setState(s: CallState): void {
    this.state = s;
    try {
      this.opts.onState?.(s);
    } catch {
      /* a screen's callback must not break the call */
    }
  }

  private warn(message: string, error?: unknown): void {
    if (this.opts.onWarn) this.opts.onWarn(message, error);
    else console.warn(`[wa-call] ${message}`, error ?? '');
  }

  /** Throws `Aborted` when the peer was torn down while an await was pending. */
  private live(pc: RTCPeerConnection): void {
    if (this.pc !== pc) throw new Aborted();
  }

  private setup(): RTCPeerConnection {
    const pc = this.env.createPeerConnection({ iceServers: this.iceServers });
    this.pc = pc;
    pc.ontrack = (ev) => {
      const stream = ev.streams?.[0];
      if (!stream || this.pc !== pc) return;
      this.remoteStream = stream;
      this.opts.onRemoteStream?.(stream);
      // Both legs are present now: record the mix, but only if the operator armed it.
      if (this.recordArmed) this.startRecorder();
    };
    pc.onconnectionstatechange = () => {
      // failed | disconnected | closed ends the call locally, with no server terminate (Meta's webhook reconciles).
      const s = pc.connectionState;
      if (s === 'failed' || s === 'disconnected' || s === 'closed') this.finish(pc);
    };
    return pc;
  }

  /** The microphone is required: a call without it would be one-way, which is worse than no call. */
  private async attachMic(pc: RTCPeerConnection): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await this.env.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      if (this.pc !== pc) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Aborted();
      }
      this.localStream = stream;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    } catch (e) {
      if (e instanceof Aborted) throw e;
      throw new CallError('MIC_BLOCKED');
    }
  }

  /** Meta's validator rejects the browser's default multi-codec offer: keep Opus and telephone-event (best effort). */
  private preferOpus(pc: RTCPeerConnection): void {
    try {
      const keep = keepOpusCodecs(this.env.audioCodecs() ?? []);
      if (keep.length === 0) return;
      for (const tx of pc.getTransceivers()) {
        const kind = tx.receiver?.track?.kind ?? tx.sender?.track?.kind;
        if (kind !== 'audio' || typeof tx.setCodecPreferences !== 'function') continue;
        try {
          tx.setCodecPreferences(keep as RTCRtpCodec[]);
        } catch {
          /* this transceiver cannot take the preference */
        }
      }
    } catch (e) {
      this.warn('preferOpus failed (sending the default SDP)', e);
    }
  }

  /** Non-trickle ICE: wait for gathering to complete, or 3 s, then send what is there. */
  private gatherIce(pc: RTCPeerConnection): Promise<string> {
    if (pc.iceGatheringState === 'complete') return Promise.resolve(pc.localDescription?.sdp ?? '');
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', onChange);
        resolve(pc.localDescription?.sdp ?? '');
      };
      const onChange = () => {
        if (pc.iceGatheringState === 'complete') done();
      };
      pc.addEventListener('icegatheringstatechange', onChange);
      const timer = setTimeout(done, ICE_GATHER_TIMEOUT_MS);
    });
  }

  /** Outbound: ask every 1.2 s for 60 s; apply Meta's answer once; stop on a terminal state. */
  private async waitForAnswer(pc: RTCPeerConnection): Promise<void> {
    const deadline = Date.now() + RING_WINDOW_MS;
    while (Date.now() < deadline) {
      this.live(pc);
      let p: DialProgress | null = null;
      try {
        p = await this.api.progress(this.callId as string);
      } catch {
        /* a transient failure: keep asking */
      }
      this.live(pc);
      if (p) {
        if (p.ended) {
          this.finish(pc);
          throw new CallError(endReasonKind(p.endReason) ?? 'ENDED_EARLY');
        }
        if (isUsableSdp(p.sdpAnswer)) {
          try {
            await pc.setRemoteDescription({
              type: 'answer',
              sdp: normalizeRemoteSdp(p.sdpAnswer, 'answer'),
            });
          } catch (e) {
            this.warn('setRemoteDescription(answer) failed', e);
            this.finish(pc);
            throw new CallError('ANSWER_FAILED', e instanceof Error ? e.message : undefined);
          }
          this.live(pc);
          this.setState('active');
          if (this.recordArmed && this.remoteStream) this.startRecorder();
          void this.watchRemoteEnd(pc);
          return;
        }
      }
      await sleep(RING_POLL_MS);
    }
    // The ring window is over: cancel the call on the server and tear down.
    await this.hangup();
    this.setState('ended');
    throw new CallError('NO_ANSWER');
  }

  /** Backstop for a remote hang-up whose ICE lingers: Meta's terminate webhook flips the row, this poll sees it. */
  private async watchRemoteEnd(pc: RTCPeerConnection): Promise<void> {
    while (this.pc === pc && this.state === 'active') {
      await sleep(REMOTE_END_POLL_MS);
      if (this.pc !== pc || this.state !== 'active') return;
      let p: DialProgress;
      try {
        p = await this.api.progress(this.callId as string);
      } catch {
        continue;
      }
      if (p.ended) {
        this.finish(pc);
        return;
      }
    }
  }

  /** Ended from the other side (or by failure): no server terminate. */
  private finish(pc: RTCPeerConnection): void {
    if (this.pc !== pc) return;
    this.setState('ended');
    this.teardown(false);
  }

  private startRecorder(): void {
    try {
      if (this.recorder || !this.env.recorderSupported()) return;
      if (!this.localStream || !this.remoteStream) return;
      const ctx = this.env.createAudioContext();
      if (!ctx) return;
      this.recCtx = ctx;
      // A suspended context feeds zero samples to the destination (an empty recording): resume it explicitly.
      if (ctx.state !== 'running') {
        ctx.resume().catch((e: unknown) => this.warn('audio context resume failed', e));
      }
      const dest = ctx.createMediaStreamDestination();
      try {
        ctx.createMediaStreamSource(this.localStream).connect(dest);
      } catch {
        /* the operator's leg could not be mixed */
      }
      try {
        ctx.createMediaStreamSource(this.remoteStream).connect(dest);
      } catch {
        /* the customer's leg could not be mixed */
      }
      const mime = RECORDING_MIME_PREFERENCE.find((m) => this.env.recorderTypeSupported(m));
      this.recChunks = [];
      this.recCallId = this.callId;
      const rec = this.env.createRecorder(dest.stream, mime);
      this.recorder = rec;
      rec.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size) this.recChunks.push(e.data);
      };
      rec.start(1000);
    } catch (e) {
      this.warn('recording start failed', e);
    }
  }

  /**
   * The person refused (or withdrew): disarm the recorder and throw away everything it caught. Nothing is uploaded, ever, for this call
   * (BL-144: a refusal leaves no recording). The call itself goes on.
   */
  discardRecording(): void {
    this.recordArmed = false;
    const rec = this.recorder;
    const ctx = this.recCtx;
    this.recorder = null;
    this.recCtx = null;
    this.recCallId = null;
    this.recChunks = [];
    try {
      if (rec && rec.state !== 'inactive') {
        rec.ondataavailable = null;
        rec.onstop = null;
        rec.stop();
      }
    } catch (e) {
      this.warn('recording discard failed', e);
    }
    void ctx?.close().catch(() => undefined);
  }

  /**
   * Stop the recorder and upload the mix. The chunk list is kept until the recorder's own final flush so the tail of the call
   * is not lost; a blob under 256 bytes is empty and is dropped.
   */
  private stopRecordingAndUpload(): void {
    const rec = this.recorder;
    const ctx = this.recCtx;
    const callId = this.recCallId;
    this.recorder = null;
    this.recCtx = null;
    this.recCallId = null;
    const closeCtx = () => {
      void ctx?.close().catch(() => undefined);
    };
    if (!rec) {
      closeCtx();
      return;
    }
    const finish = () => {
      closeCtx();
      const chunks = this.recChunks;
      this.recChunks = [];
      if (!callId || chunks.length === 0) return;
      const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
      if (blob.size < MIN_RECORDING_BYTES) return;
      this.upload = this.api
        .uploadRecording(callId, blob, `call-${callId}.webm`)
        .then(() => this.opts.onRecordingSaved?.())
        .catch((e: unknown) => this.warn('recording upload failed', e));
    };
    try {
      if (rec.state !== 'inactive') {
        rec.onstop = finish;
        rec.stop();
      } else {
        finish();
      }
    } catch (e) {
      this.warn('recording stop failed', e);
      closeCtx();
    }
  }

  private teardown(setIdle: boolean): void {
    // Flush and upload the recording BEFORE the microphone stops, so the last frames are not lost.
    this.stopRecordingAndUpload();
    const pc = this.pc;
    try {
      pc?.getSenders().forEach((s) => s.track?.stop());
    } catch {
      /* already gone */
    }
    try {
      this.localStream?.getTracks().forEach((t) => t.stop());
    } catch {
      /* already gone */
    }
    try {
      pc?.close();
    } catch {
      /* already closed */
    }
    this.pc = null;
    this.localStream = null;
    this.remoteStream = null;
    this.callId = null;
    this.opts.onRemoteStream?.(null);
    if (setIdle) this.setState('idle');
  }
}
