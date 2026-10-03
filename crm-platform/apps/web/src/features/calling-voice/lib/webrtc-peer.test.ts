import { CALL_ERROR_CODES, type DialProgress } from '@crm/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { CALL_FAILURE_TEXT, CallError } from './calls';
import {
  CallPeer,
  RING_WINDOW_MS,
  type CallApi,
  type CallState,
  type PeerEnv,
} from './webrtc-peer';

// --- fakes -----------------------------------------------------------------------------------------------------------

const LF_SDP = 'v=0\no=- 1 2 IN IP4 127.0.0.1\ns=-\nt=0 0\nm=audio 9 UDP/TLS/RTP/SAVPF 111\n';
const META_ANSWER = `${LF_SDP}a=setup:actpass\na=mid:0\n`;
const LOCAL_SDP = LF_SDP.replace(/\n/g, '\r\n');

class FakeTrack {
  enabled = true;
  stopped = false;
  kind = 'audio';
  stop() {
    this.stopped = true;
  }
}
class FakeStream {
  tracks = [new FakeTrack()];
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks;
  }
}
class FakeTransceiver {
  prefs: Array<{ mimeType: string }> | null = null;
  receiver = { track: { kind: 'audio' } };
  sender = { track: null };
  setCodecPreferences(codecs: Array<{ mimeType: string }>) {
    this.prefs = codecs;
  }
}

class FakePc {
  log: string[];
  closed = false;
  iceGatheringState = 'complete';
  connectionState = 'new';
  localDescription: { type: string; sdp: string } | null = null;
  remote: Array<{ type: string; sdp: string }> = [];
  transceivers: FakeTransceiver[] = [];
  senders: Array<{ track: FakeTrack }> = [];
  ontrack: ((ev: { streams: FakeStream[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  private listeners = new Map<string, Set<() => void>>();
  constructor(log: string[]) {
    this.log = log;
  }
  addTrack(track: FakeTrack) {
    this.log.push('addTrack');
    this.senders.push({ track });
    this.transceivers.push(new FakeTransceiver());
  }
  getTransceivers() {
    return this.transceivers;
  }
  getSenders() {
    return this.senders;
  }
  createOffer() {
    this.log.push('createOffer');
    return Promise.resolve({ type: 'offer', sdp: LOCAL_SDP });
  }
  createAnswer() {
    this.log.push('createAnswer');
    return Promise.resolve({ type: 'answer', sdp: LOCAL_SDP });
  }
  setLocalDescription(d: { type: string; sdp: string }) {
    this.localDescription = d;
    return Promise.resolve();
  }
  setRemoteDescription(d: { type: string; sdp: string }) {
    this.log.push(`setRemote:${d.type}`);
    this.remote.push(d);
    if (d.type === 'offer') this.transceivers.push(new FakeTransceiver());
    return Promise.resolve();
  }
  addEventListener(type: string, fn: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: () => void) {
    this.listeners.get(type)?.delete(fn);
  }
  fire(type: string) {
    this.listeners.get(type)?.forEach((fn) => fn());
  }
  close() {
    this.closed = true;
  }
}

class FakeRecorder {
  state = 'inactive';
  payload = new Blob([new Uint8Array(300)], { type: 'audio/webm' });
  started = false;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  mime: string | undefined;
  start() {
    this.state = 'recording';
    this.started = true;
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: this.payload });
    this.onstop?.();
  }
}

const progress = (p: Partial<DialProgress> = {}): DialProgress => ({
  status: 'ringing',
  sdpAnswer: null,
  ended: false,
  endReason: null,
  ...p,
});

function setup(
  opts: { mic?: 'ok' | 'blocked'; recorderTypes?: string[]; recorder?: boolean } = {},
) {
  const log: string[] = [];
  const pc = new FakePc(log);
  const stream = new FakeStream();
  const remote = new FakeStream();
  const recorder = new FakeRecorder();
  const ctx = {
    state: 'suspended',
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    createMediaStreamDestination: () => ({ stream: {} }),
    createMediaStreamSource: () => ({ connect: () => undefined }),
  };
  const api = {
    dial: vi.fn<CallApi['dial']>(() =>
      Promise.resolve({ callId: 'c1', metaCallId: null, correlation: 'x' }),
    ),
    progress: vi.fn<CallApi['progress']>(() => Promise.resolve(progress())),
    accept: vi.fn<CallApi['accept']>(() => Promise.resolve()),
    reject: vi.fn<CallApi['reject']>(() => Promise.resolve()),
    terminate: vi.fn<CallApi['terminate']>(() => Promise.resolve()),
    uploadRecording: vi.fn<CallApi['uploadRecording']>(() => Promise.resolve({ url: '/u' })),
  } satisfies CallApi;
  const createPeerConnection = vi.fn((config: RTCConfiguration) => {
    void config;
    return pc as unknown as RTCPeerConnection;
  });
  const env: Partial<PeerEnv> = {
    createPeerConnection,
    getUserMedia: vi.fn(() => {
      log.push('getUserMedia');
      return opts.mic === 'blocked'
        ? Promise.reject(new DOMException('denied', 'NotAllowedError'))
        : Promise.resolve(stream as unknown as MediaStream);
    }),
    audioCodecs: () => [
      { mimeType: 'audio/opus' },
      { mimeType: 'audio/PCMU' },
      { mimeType: 'audio/G722' },
      { mimeType: 'audio/telephone-event' },
    ],
    createAudioContext: () => ctx as unknown as AudioContext,
    recorderSupported: () => opts.recorder !== false,
    recorderTypeSupported: (m) => (opts.recorderTypes ?? ['audio/webm;codecs=opus']).includes(m),
    createRecorder: (_s, mime) => {
      recorder.mime = mime;
      return recorder as unknown as MediaRecorder;
    },
  };
  const states: CallState[] = [];
  const remoteStreams: Array<MediaStream | null> = [];
  const saved = vi.fn();
  const peer = new CallPeer({
    api,
    env,
    onState: (s) => states.push(s),
    onRemoteStream: (s) => remoteStreams.push(s),
    onRecordingSaved: saved,
    onWarn: () => undefined,
  });
  return {
    peer,
    pc,
    api,
    stream,
    remote,
    recorder,
    ctx,
    log,
    states,
    remoteStreams,
    saved,
    createPeerConnection,
  };
}

const DIAL = { numberId: '11111111-1111-4111-8111-111111111111', to: '919876543210' };
/** Rejection of a promise that must not stay unhandled while fake timers run. */
const settle = <T>(p: Promise<T>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// --- dial ----------------------------------------------------------------------------------------------------------------

describe('dial', () => {
  it('sends an Opus-only CRLF offer, applies the answer once with setup:active, and goes active', async () => {
    const t = setup();
    t.api.progress
      .mockResolvedValueOnce(progress())
      .mockResolvedValue(progress({ status: 'active', sdpAnswer: META_ANSWER }));

    const dialled = t.peer.dial({ ...DIAL, contactId: 'ct', conversationId: 'cv' });
    await vi.advanceTimersByTimeAsync(1200);
    await dialled;

    expect(t.states).toEqual(['connecting', 'ringing', 'active']);
    expect(t.log.indexOf('getUserMedia')).toBeLessThan(t.log.indexOf('createOffer'));
    expect(t.pc.transceivers[0]!.prefs!.map((c) => c.mimeType)).toEqual([
      'audio/opus',
      'audio/telephone-event',
    ]);

    expect(t.api.dial).toHaveBeenCalledTimes(1);
    const sent = t.api.dial.mock.calls[0]![0];
    expect(sent).toMatchObject({ ...DIAL, contactId: 'ct', conversationId: 'cv' });
    expect(sent.sdpOffer.endsWith('\r\n')).toBe(true);
    expect(sent.sdpOffer).not.toMatch(/[^\r]\n/);

    const answers = t.pc.remote.filter((d) => d.type === 'answer');
    expect(answers).toHaveLength(1);
    expect(answers[0]!.sdp).toContain('a=setup:active\r\n');
    expect(answers[0]!.sdp).not.toContain('actpass');
    expect(answers[0]!.sdp).not.toMatch(/[^\r]\n/);
    expect(t.peer.state).toBe('active');
    expect(t.peer.callId).toBe('c1');

    // The 3 s remote-end watch keeps asking but never applies the answer again.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.pc.remote.filter((d) => d.type === 'answer')).toHaveLength(1);
    await t.peer.hangup();
  });

  it('uses the injected ICE servers, else the four public STUN servers', async () => {
    const turn = [{ urls: 'turn:t.example.com', username: 'u', credential: 'c' }];
    const a = setup();
    a.api.progress.mockResolvedValue(progress({ sdpAnswer: META_ANSWER }));
    await a.peer.dial(DIAL);
    expect(a.createPeerConnection.mock.calls[0]![0].iceServers).toHaveLength(4);
    await a.peer.hangup();

    const b = setup();
    b.api.progress.mockResolvedValue(progress({ sdpAnswer: META_ANSWER }));
    const peer = new CallPeer({
      api: b.api,
      iceServers: turn,
      env: {
        createPeerConnection: b.createPeerConnection,
        getUserMedia: () => Promise.resolve(b.stream as unknown as MediaStream),
        audioCodecs: () => null,
      },
    });
    await peer.dial(DIAL);
    expect(b.createPeerConnection.mock.calls[0]![0].iceServers).toEqual(turn);
    await peer.hangup();
  });

  it('waits for ICE gathering, at most 3 s, then sends what it has', async () => {
    const t = setup();
    t.pc.iceGatheringState = 'gathering';
    t.api.progress.mockResolvedValue(progress({ sdpAnswer: META_ANSWER }));
    const dialled = t.peer.dial(DIAL);
    await vi.advanceTimersByTimeAsync(2900);
    expect(t.api.dial).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    await dialled;
    expect(t.api.dial).toHaveBeenCalledTimes(1);
    await t.peer.hangup();
  });

  it('sends as soon as gathering completes', async () => {
    const t = setup();
    t.pc.iceGatheringState = 'gathering';
    t.api.progress.mockResolvedValue(progress({ sdpAnswer: META_ANSWER }));
    const dialled = t.peer.dial(DIAL);
    await vi.advanceTimersByTimeAsync(100);
    expect(t.api.dial).not.toHaveBeenCalled();
    t.pc.iceGatheringState = 'complete';
    t.pc.fire('icegatheringstatechange');
    await vi.advanceTimersByTimeAsync(0);
    await dialled;
    expect(t.api.dial).toHaveBeenCalledTimes(1);
    await t.peer.hangup();
  });

  it('leaves no peer open when the server sent a permission request instead', async () => {
    const t = setup();
    t.api.dial.mockRejectedValue(
      new ApiError(
        422,
        CALL_ERROR_CODES.CALL_PERMISSION_REQUESTED,
        'A permission request was sent.',
      ),
    );
    await expect(t.peer.dial(DIAL)).rejects.toMatchObject({ code: 'CALL_PERMISSION_REQUESTED' });
    expect(t.pc.closed).toBe(true);
    expect(t.stream.tracks.every((x) => x.stopped)).toBe(true);
    expect(t.peer.state).toBe('ended');
    expect(t.peer.callId).toBeNull();
    expect(t.api.progress).not.toHaveBeenCalled();
    expect(t.api.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.api.progress).not.toHaveBeenCalled();
  });

  it('aborts with the exact message and no server request when the microphone is blocked', async () => {
    const t = setup({ mic: 'blocked' });
    const err = await settle(t.peer.dial(DIAL));
    expect(err).toBeInstanceOf(CallError);
    expect((err as CallError).kind).toBe('MIC_BLOCKED');
    expect((err as CallError).message).toBe(
      'Microphone access blocked - the caller will not hear you. Grant mic permission in your browser and retry.',
    );
    expect(t.api.dial).not.toHaveBeenCalled();
    expect(t.api.progress).not.toHaveBeenCalled();
    expect(t.api.terminate).not.toHaveBeenCalled();
    expect(t.pc.closed).toBe(true);
    expect(t.peer.state).toBe('ended');
  });

  it("stops with the customer's reason when the call ends while ringing", async () => {
    const t = setup();
    t.api.progress.mockResolvedValue(
      progress({ status: 'ended', ended: true, endReason: 'REJECTED' }),
    );
    const err = await settle(t.peer.dial(DIAL));
    expect((err as CallError).kind).toBe('REJECTED');
    expect((err as CallError).message).toBe('The customer declined the call.');
    expect(t.states).toEqual(['connecting', 'ringing', 'ended']);
    expect(t.pc.closed).toBe(true);
    expect(t.api.terminate).not.toHaveBeenCalled();
  });

  it('says "Call ended before it connected." for an unknown reason', async () => {
    const t = setup();
    t.api.progress.mockResolvedValue(progress({ ended: true, endReason: null }));
    const err = await settle(t.peer.dial(DIAL));
    expect((err as CallError).message).toBe(CALL_FAILURE_TEXT.ENDED_EARLY);
  });

  it('keeps asking through a failed poll', async () => {
    const t = setup();
    t.api.progress
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(progress({ sdpAnswer: META_ANSWER }));
    const dialled = t.peer.dial(DIAL);
    await vi.advanceTimersByTimeAsync(1200);
    await dialled;
    expect(t.peer.state).toBe('active');
    await t.peer.hangup();
  });

  it('gives up after 60 s of ringing: terminates and says nobody picked up', async () => {
    const t = setup();
    const result = settle(t.peer.dial(DIAL));
    await vi.advanceTimersByTimeAsync(RING_WINDOW_MS - 1000);
    expect(t.api.terminate).not.toHaveBeenCalled();
    expect(t.peer.state).toBe('ringing');
    await vi.advanceTimersByTimeAsync(2500);
    const err = await result;
    expect((err as CallError).kind).toBe('NO_ANSWER');
    expect((err as CallError).message).toBe('No answer - the customer did not pick up.');
    expect(t.api.terminate).toHaveBeenCalledTimes(1);
    expect(t.api.terminate).toHaveBeenCalledWith('c1');
    expect(t.pc.closed).toBe(true);
    expect(t.peer.state).toBe('ended');
    // About one poll every 1.2 s for 60 s.
    expect(t.api.progress.mock.calls.length).toBeGreaterThanOrEqual(49);
    expect(t.api.progress.mock.calls.length).toBeLessThanOrEqual(52);
  });

  it('fails with the browser reason when the answer cannot be applied', async () => {
    const t = setup();
    t.api.progress.mockResolvedValue(progress({ sdpAnswer: META_ANSWER }));
    t.pc.setRemoteDescription = () => Promise.reject(new Error('Invalid SDP line'));
    const err = await settle(t.peer.dial(DIAL));
    expect((err as CallError).kind).toBe('ANSWER_FAILED');
    expect((err as CallError).message).toBe('Failed to apply WhatsApp answer: Invalid SDP line');
    expect(t.pc.closed).toBe(true);
  });

  it('does not leave the customer ringing when hung up while the dial request is in flight', async () => {
    const t = setup();
    let release!: () => void;
    t.api.dial.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ callId: 'late', metaCallId: null, correlation: 'x' });
        }),
    );
    const dialled = t.peer.dial(DIAL);
    await vi.advanceTimersByTimeAsync(0);
    await t.peer.hangup(); // no call id yet: nothing to terminate
    expect(t.api.terminate).not.toHaveBeenCalled();
    release();
    await dialled; // quiet, not an error
    expect(t.api.terminate).toHaveBeenCalledWith('late');
    expect(t.api.progress).not.toHaveBeenCalled();
  });

  it('resolves quietly when the operator hangs up while it rings', async () => {
    const t = setup();
    const dialled = t.peer.dial(DIAL);
    await vi.advanceTimersByTimeAsync(1300);
    await t.peer.hangup();
    await vi.advanceTimersByTimeAsync(1300); // the poll loop wakes, sees the peer is gone and stops
    await dialled;
    expect(t.api.terminate).toHaveBeenCalledWith('c1');
    expect(t.peer.state).toBe('idle');
  });
});

// --- answer ----------------------------------------------------------------------------------------------------------------

describe('answer', () => {
  it('attaches the microphone before creating the answer, then accepts with the CRLF SDP', async () => {
    const t = setup();
    await t.peer.answer('c9', META_ANSWER);
    expect(t.log).toEqual(['setRemote:offer', 'getUserMedia', 'addTrack', 'createAnswer']);
    expect(t.pc.remote[0]!.sdp).toBe(META_ANSWER.replace(/\n/g, '\r\n'));
    // The offer keeps actpass: only an answer is pinned.
    expect(t.pc.remote[0]!.sdp).toContain('a=setup:actpass');
    expect(t.pc.transceivers.every((x) => x.prefs?.length === 2)).toBe(true);
    expect(t.api.accept).toHaveBeenCalledTimes(1);
    const [id, sdp] = t.api.accept.mock.calls[0]!;
    expect(id).toBe('c9');
    expect(sdp).toBe(LOCAL_SDP);
    expect(t.states).toEqual(['connecting', 'active']);
    await t.peer.hangup();
  });

  it('refuses a short offer before doing anything', async () => {
    const t = setup();
    await expect(t.peer.answer('c9', 'v=0')).rejects.toMatchObject({ kind: 'INVALID_SDP' });
    expect(t.states).toEqual([]);
    expect(t.createPeerConnection).not.toHaveBeenCalled();
    expect(t.api.accept).not.toHaveBeenCalled();
  });

  it('aborts and accepts nothing when the microphone is blocked', async () => {
    const t = setup({ mic: 'blocked' });
    await expect(t.peer.answer('c9', META_ANSWER)).rejects.toMatchObject({ kind: 'MIC_BLOCKED' });
    expect(t.api.accept).not.toHaveBeenCalled();
    expect(t.pc.closed).toBe(true);
    expect(t.peer.state).toBe('ended');
  });

  it('tears down without a terminate when a teammate took the call (409)', async () => {
    const t = setup();
    t.api.accept.mockRejectedValue(
      new ApiError(409, CALL_ERROR_CODES.CALL_STATE_CONFLICT, 'taken'),
    );
    await expect(t.peer.answer('c9', META_ANSWER)).rejects.toMatchObject({ status: 409 });
    expect(t.pc.closed).toBe(true);
    expect(t.peer.state).toBe('ended');
    expect(t.api.terminate).not.toHaveBeenCalled();
  });
});

// --- ending ------------------------------------------------------------------------------------------------------------

async function activeCall() {
  const t = setup();
  t.api.progress.mockResolvedValue(progress({ status: 'active', sdpAnswer: META_ANSWER }));
  await t.peer.dial(DIAL);
  return t;
}

describe('remote end', () => {
  it('is noticed by the 3 s watch, with no terminate', async () => {
    const t = await activeCall();
    t.api.progress.mockResolvedValue(
      progress({ status: 'ended', ended: true, endReason: 'CANCELLED' }),
    );
    await vi.advanceTimersByTimeAsync(3100);
    expect(t.peer.state).toBe('ended');
    expect(t.pc.closed).toBe(true);
    expect(t.api.terminate).not.toHaveBeenCalled();
    expect(t.remoteStreams.at(-1)).toBeNull();
  });

  it.each(['failed', 'disconnected', 'closed'])(
    'is noticed from the connection state %s',
    async (s) => {
      const t = await activeCall();
      t.pc.connectionState = s;
      t.pc.onconnectionstatechange?.();
      expect(t.peer.state).toBe('ended');
      expect(t.pc.closed).toBe(true);
      await t.peer.hangup();
      expect(t.api.terminate).not.toHaveBeenCalled();
    },
  );

  it('ignores a connection state that is not an end', async () => {
    const t = await activeCall();
    t.pc.connectionState = 'connected';
    t.pc.onconnectionstatechange?.();
    expect(t.peer.state).toBe('active');
    await t.peer.hangup();
  });
});

describe('hangup', () => {
  it('posts terminate while active, then tears down', async () => {
    const t = await activeCall();
    await t.peer.hangup();
    expect(t.api.terminate).toHaveBeenCalledWith('c1');
    expect(t.pc.closed).toBe(true);
    expect(t.stream.tracks.every((x) => x.stopped)).toBe(true);
    expect(t.peer.state).toBe('idle');
  });

  it('posts terminate while ringing (cancels the call)', async () => {
    const t = setup();
    const dialled = t.peer.dial(DIAL);
    await vi.advanceTimersByTimeAsync(10);
    expect(t.peer.state).toBe('ringing');
    await t.peer.hangup();
    await vi.advanceTimersByTimeAsync(1300);
    await dialled;
    expect(t.api.terminate).toHaveBeenCalledWith('c1');
  });

  it('does not post terminate when there is nothing live', async () => {
    const t = setup();
    await t.peer.hangup();
    expect(t.api.terminate).not.toHaveBeenCalled();
    expect(t.peer.state).toBe('idle');
  });

  it('never lets a failed terminate block the teardown', async () => {
    const t = await activeCall();
    t.api.terminate.mockRejectedValue(new Error('boom'));
    await expect(t.peer.hangup()).resolves.toBeUndefined();
    expect(t.pc.closed).toBe(true);
    expect(t.peer.state).toBe('idle');
  });
});

describe('mute', () => {
  it('disables and re-enables the local audio track only', async () => {
    const t = await activeCall();
    t.peer.mute(true);
    expect(t.stream.tracks[0]!.enabled).toBe(false);
    t.peer.mute(false);
    expect(t.stream.tracks[0]!.enabled).toBe(true);
    expect(t.api.terminate).not.toHaveBeenCalled();
    await t.peer.hangup();
  });
});

// --- recording -------------------------------------------------------------------------------------------------------------

describe('recording', () => {
  const withRemote = (t: Awaited<ReturnType<typeof activeCall>>) =>
    t.pc.ontrack?.({ streams: [t.remote] });

  it('refuses to arm when the browser cannot record', async () => {
    const t = setup({ recorder: false });
    expect(t.peer.startRecording()).toBe(false);
    expect(t.peer.recording).toBe(false);
  });

  it('records the mix, resumes the audio context and uploads on hang-up', async () => {
    const t = await activeCall();
    withRemote(t);
    expect(t.peer.startRecording()).toBe(true);
    expect(t.recorder.started).toBe(true);
    expect(t.recorder.mime).toBe('audio/webm;codecs=opus');
    expect(t.ctx.resume).toHaveBeenCalledTimes(1);

    await t.peer.hangup();
    await t.peer.settled();
    expect(t.api.uploadRecording).toHaveBeenCalledTimes(1);
    const [id, blob, name] = t.api.uploadRecording.mock.calls[0]!;
    expect(id).toBe('c1');
    expect(blob.size).toBe(300);
    expect(name).toBe('call-c1.webm');
    expect(t.saved).toHaveBeenCalledTimes(1);
    expect(t.ctx.close).toHaveBeenCalled();
  });

  it('starts when the customer audio arrives after it was armed', async () => {
    const t = await activeCall();
    t.peer.startRecording();
    expect(t.recorder.started).toBe(false);
    withRemote(t);
    expect(t.recorder.started).toBe(true);
    await t.peer.hangup();
  });

  it('falls back to audio/webm, then to the browser default', async () => {
    const a = await activeCall();
    const b = setup({ recorderTypes: ['audio/webm'] });
    b.api.progress.mockResolvedValue(progress({ sdpAnswer: META_ANSWER }));
    await b.peer.dial(DIAL);
    b.pc.ontrack?.({ streams: [b.remote] });
    b.peer.startRecording();
    expect(b.recorder.mime).toBe('audio/webm');
    await b.peer.hangup();

    const c = setup({ recorderTypes: ['audio/ogg;codecs=opus'] });
    c.api.progress.mockResolvedValue(progress({ sdpAnswer: META_ANSWER }));
    await c.peer.dial(DIAL);
    c.pc.ontrack?.({ streams: [c.remote] });
    c.peer.startRecording();
    expect(c.recorder.mime).toBe('audio/ogg;codecs=opus');
    await c.peer.hangup();

    const d = setup({ recorderTypes: [] });
    d.api.progress.mockResolvedValue(progress({ sdpAnswer: META_ANSWER }));
    await d.peer.dial(DIAL);
    d.pc.ontrack?.({ streams: [d.remote] });
    d.peer.startRecording();
    expect(d.recorder.mime).toBeUndefined();
    await d.peer.hangup();
    await a.peer.hangup();
  });

  it('does not upload a recording under 256 bytes', async () => {
    const t = await activeCall();
    withRemote(t);
    t.peer.startRecording();
    t.recorder.payload = new Blob([new Uint8Array(255)], { type: 'audio/webm' });
    await t.peer.hangup();
    await t.peer.settled();
    expect(t.api.uploadRecording).not.toHaveBeenCalled();
    expect(t.saved).not.toHaveBeenCalled();
  });

  it('uploads exactly 256 bytes', async () => {
    const t = await activeCall();
    withRemote(t);
    t.peer.startRecording();
    t.recorder.payload = new Blob([new Uint8Array(256)], { type: 'audio/webm' });
    await t.peer.hangup();
    await t.peer.settled();
    expect(t.api.uploadRecording).toHaveBeenCalledTimes(1);
  });

  it('uploads nothing when it was never armed', async () => {
    const t = await activeCall();
    withRemote(t);
    await t.peer.hangup();
    await t.peer.settled();
    expect(t.recorder.started).toBe(false);
    expect(t.api.uploadRecording).not.toHaveBeenCalled();
  });

  it('also uploads when the other side ended the call', async () => {
    const t = await activeCall();
    withRemote(t);
    t.peer.startRecording();
    t.pc.connectionState = 'failed';
    t.pc.onconnectionstatechange?.();
    await t.peer.settled();
    expect(t.api.uploadRecording).toHaveBeenCalledTimes(1);
  });

  it('keeps the teardown going when the upload fails', async () => {
    const t = await activeCall();
    withRemote(t);
    t.peer.startRecording();
    t.api.uploadRecording.mockRejectedValue(new Error('413'));
    await t.peer.hangup();
    await t.peer.settled();
    expect(t.saved).not.toHaveBeenCalled();
    expect(t.peer.state).toBe('idle');
  });
});
