'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import { useToast } from '@crm/ui';
import type { PendingCall } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { callApi, useIceServers } from '../api/calling';
import { CallError, digitsOf, elapsedText, isStateConflict, parseIceServers } from '../lib/calls';
import { isUsableSdp } from '../lib/sdp';
import { CallPeer, type CallState } from '../lib/webrtc-peer';
import { useErrorText } from './use-error-text';

export interface ActiveCall {
  direction: 'outbound' | 'inbound';
  /** Contact name, or the number. */
  name: string;
  state: CallState;
  /** When audio connected; the timer starts here and not while an outbound call rings. */
  connectedAt: number | null;
  muted: boolean;
  /** Recording is armed: it cannot be stopped mid-call. */
  recording: boolean;
}

export interface OutboundCallInput {
  numberId: string;
  to: string;
  contactId?: string;
  conversationId?: string;
  displayName?: string;
}

export interface CallingApi {
  /** The one call of this tab; null when idle. */
  active: ActiveCall | null;
  /** The tab's call slot is taken (claimed before dialling): no second call, no incoming-call poll. */
  busy: boolean;
  /** `M:SS`, empty until the call connects. */
  elapsed: string;
  startOutboundCall(input: OutboundCallInput): Promise<void>;
  acceptIncoming(call: PendingCall): Promise<void>;
  rejectIncoming(call: PendingCall, reason?: string): Promise<void>;
  hangup(): Promise<void>;
  toggleMute(): void;
  record(): void;
}

const CallingContext = createContext<CallingApi | null>(null);

export function useCalling(): CallingApi {
  const ctx = useContext(CallingContext);
  if (!ctx) throw new Error('useCalling must be used inside <CallingProvider>');
  return ctx;
}

/**
 * Holds the ONE call of this browser tab (WD-CALL-007 rule 1): the slot is claimed before dialling, so an incoming-call toast
 * never pops over a dial, and a second call is refused. Owns the peer and the hidden audio element that plays the customer.
 * Must sit inside a `ToastProvider` and the session provider. Mount it above everything that starts, shows or answers calls;
 * leaving it unmounts the call (the call is hung up).
 */
export function CallingProvider({
  children,
  iceServers,
}: {
  children: ReactNode;
  /** An ICE list to use instead of the operator's (a list or its JSON text; TURN included). By default the provider asks the server for the operator's list; the four public STUN servers when there is none. */
  iceServers?: unknown;
}) {
  const t = useTranslations('calling-voice');
  const { toast } = useToast();
  const errorText = useErrorText();
  const audioRef = useRef<HTMLAudioElement>(null);
  const peerRef = useRef<CallPeer | null>(null);
  const [active, setActive] = useState<ActiveCall | null>(null);
  const [now, setNow] = useState(0);
  const canCall = useCan('call.calls.use');
  const served = useIceServers(canCall && iceServers === undefined);
  const source = iceServers ?? served.data?.servers;
  const ice = useMemo(() => parseIceServers(source), [source]);

  const connectedAt = active?.connectedAt ?? null;
  useEffect(() => {
    if (connectedAt === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [connectedAt]);

  const attachAudio = useCallback((stream: MediaStream | null) => {
    const el = audioRef.current;
    if (!el) return;
    el.srcObject = stream;
    if (!stream) return;
    // Autoplay can still be blocked after the click that started the call: say so instead of a silent one-way call.
    el.play().catch((e: unknown) => console.warn('[wa-call] remote audio play() blocked', e));
  }, []);

  const makePeer = useCallback((): CallPeer => {
    const peer: CallPeer = new CallPeer({
      api: callApi,
      iceServers: ice,
      onRemoteStream: attachAudio,
      onRecordingSaved: () => toast(t('toast.recordingSaved'), 'success'),
      onState: (state) => {
        if (peerRef.current !== peer) return;
        if (state === 'ended' || state === 'idle') {
          peerRef.current = null;
          setActive(null);
        } else if (state === 'ringing' || state === 'active') {
          setActive((a) =>
            a
              ? {
                  ...a,
                  state,
                  connectedAt: state === 'active' ? (a.connectedAt ?? Date.now()) : a.connectedAt,
                }
              : a,
          );
        }
      },
    });
    peerRef.current = peer;
    return peer;
  }, [ice, attachAudio, toast, t]);

  const startOutboundCall = useCallback(
    async (input: OutboundCallInput) => {
      if (peerRef.current) throw new CallError('BUSY_SLOT');
      const to = digitsOf(input.to);
      const peer = makePeer(); // claims the slot synchronously
      setActive({
        direction: 'outbound',
        name: input.displayName?.trim() || `+${to}`,
        state: 'connecting',
        connectedAt: null,
        muted: false,
        recording: false,
      });
      await peer.dial({
        numberId: input.numberId,
        to,
        contactId: input.contactId,
        conversationId: input.conversationId,
      });
    },
    [makePeer],
  );

  const rejectIncoming = useCallback(async (call: PendingCall, reason = 'REJECTED') => {
    try {
      await callApi.reject(call.id, reason);
    } catch {
      /* swallowed: Meta's webhook reconciles */
    }
  }, []);

  const acceptIncoming = useCallback(
    async (call: PendingCall) => {
      if (peerRef.current) return;
      // An empty offer means the connect event arrived without its session body: say so instead of an opaque browser error.
      if (!isUsableSdp(call.sdpOffer)) {
        toast(t('toast.acceptInvalid'), 'danger');
        await rejectIncoming(call, 'INVALID_SDP');
        return;
      }
      const peer = makePeer();
      setActive({
        direction: 'inbound',
        name:
          call.contactName?.trim() || t('incoming.caller', { digits: digitsOf(call.fromPhone) }),
        state: 'connecting',
        connectedAt: null,
        muted: false,
        recording: false,
      });
      try {
        await peer.answer(call.id, call.sdpOffer);
        if (peer.state !== 'active') return;
        // Inbound calls are recorded from the start; the panel says so for as long as it lasts.
        if (peer.startRecording()) setActive((a) => (a ? { ...a, recording: true } : a));
      } catch (e) {
        // A teammate took it: their call is live, so do not reject it at Meta.
        if (isStateConflict(e)) {
          toast(t('toast.alreadyAccepted'), 'info');
          return;
        }
        toast(t('toast.acceptFailed', { message: errorText(e) }), 'danger');
        await rejectIncoming(call, 'OPERATOR_ERROR');
      }
    },
    [makePeer, rejectIncoming, toast, t, errorText],
  );

  const hangup = useCallback(async () => {
    await peerRef.current?.hangup();
  }, []);

  const muted = active?.muted ?? false;
  const toggleMute = useCallback(() => {
    const peer = peerRef.current;
    if (!peer?.localStream) return;
    peer.mute(!muted);
    setActive((a) => (a ? { ...a, muted: !muted } : a));
  }, [muted]);

  const record = useCallback(() => {
    const peer = peerRef.current;
    if (!peer) {
      toast(t('toast.noActiveCall'), 'danger');
      return;
    }
    if (peer.recording) return;
    if (!peer.startRecording()) {
      toast(t('toast.recordUnsupported'), 'danger');
      return;
    }
    setActive((a) => (a ? { ...a, recording: true } : a));
    toast(t('toast.recordingStarted'), 'success');
  }, [toast, t]);

  // Leaving the provider ends the call: a peer must never outlive the screen that can hang it up.
  useEffect(
    () => () => {
      void peerRef.current?.hangup();
    },
    [],
  );

  const value = useMemo<CallingApi>(
    () => ({
      active,
      busy: active !== null,
      elapsed: elapsedText(connectedAt, Math.max(now, connectedAt ?? 0)),
      startOutboundCall,
      acceptIncoming,
      rejectIncoming,
      hangup,
      toggleMute,
      record,
    }),
    [
      active,
      connectedAt,
      now,
      startOutboundCall,
      acceptIncoming,
      rejectIncoming,
      hangup,
      toggleMute,
      record,
    ],
  );

  return (
    <CallingContext.Provider value={value}>
      {children}
      <audio ref={audioRef} autoPlay playsInline hidden />
    </CallingContext.Provider>
  );
}
