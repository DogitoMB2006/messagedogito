import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { useAuth } from './AuthContext';
import { supabase } from '../lib/supabase';
import { VoiceWebRtcSession } from '../lib/voiceCall';
import {
  type VoiceCallRow,
  type VoiceCallStatus,
  VOICE_CALL_UPDATE_INBOX_EVENT,
  VOICE_INBOX_EVENT,
  VOICE_RING_TIMEOUT_MS,
  VOICE_SIGNAL_ANSWER,
  VOICE_SIGNAL_HANGUP,
  VOICE_SIGNAL_ICE,
  VOICE_SIGNAL_OFFER,
  VOICE_SIGNAL_READY,
  type VoiceIncomingCallPayload,
  type VoiceSignalAnswerPayload,
  type VoiceSignalHangupPayload,
  type VoiceSignalIcePayload,
  type VoiceSignalOfferPayload,
  type VoiceSignalReadyPayload,
  voiceSignalingTopic,
} from '../lib/voiceCall';
import { IncomingCallModal } from '../components/voice/IncomingCallModal';
import { whenRealtimeSubscribed } from '../lib/whenRealtimeSubscribed';
import { sendMobilePushNotification } from '../lib/mobilePush';

type VoicePhase = 'idle' | 'ringing-outgoing' | 'ringing-incoming' | 'active';

const STALE_RINGING_CALL_MS = VOICE_RING_TIMEOUT_MS + 15_000;
const STALE_ACTIVE_CALL_MS = 4 * 60 * 60 * 1000;
const voiceInboxTopic = (userId: string) => `user-voice-inbox:${userId}`;

type VoiceCallContextType = {
  phase: VoicePhase;
  activeCall: VoiceCallRow | null;
  activeChatId: string | null;
  peerName: string;
  peerUserId: string | null;
  muted: boolean;
  elapsedSec: number;
  inputDevices: MediaDeviceInfo[];
  outputDevices: MediaDeviceInfo[];
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  outputSwitchSupported: boolean;
  callError: string | null;
  startCall: (chatId: string, calleeUserId: string, calleeName: string) => Promise<{ ok: boolean; error: string | null }>;
  acceptIncomingCall: () => Promise<void>;
  declineIncomingCall: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMute: () => void;
  setInputDevice: (deviceId: string) => Promise<void>;
  setOutputDevice: (deviceId: string) => Promise<void>;
  clearError: () => void;
};

const VoiceCallContext = createContext<VoiceCallContextType | undefined>(undefined);

function nowIso() {
  return new Date().toISOString();
}

function getCallActivityAt(row: Pick<VoiceCallRow, 'updated_at' | 'created_at'>): number {
  const updatedAt = new Date(row.updated_at).getTime();
  if (Number.isFinite(updatedAt)) return updatedAt;
  const createdAt = new Date(row.created_at).getTime();
  return Number.isFinite(createdAt) ? createdAt : Date.now();
}

export function VoiceCallProvider({ children }: { children: React.ReactNode }) {
  const { user, profile } = useAuth();

  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [activeCall, setActiveCall] = useState<VoiceCallRow | null>(null);
  const [peerName, setPeerName] = useState('');
  const [peerUserId, setPeerUserId] = useState<string | null>(null);
  const [incomingCall, setIncomingCall] = useState<VoiceIncomingCallPayload | null>(null);
  const [muted, setMuted] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null);
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [inputDeviceId, setInputDeviceId] = useState<string | null>(null);
  const [outputDeviceId, setOutputDeviceId] = useState<string | null>(null);
  const [outputSwitchSupported, setOutputSwitchSupported] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);

  const sessionRef = useRef<VoiceWebRtcSession | null>(null);
  const signalingRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const ringTimeoutRef = useRef<number | null>(null);
  const callRef = useRef<VoiceCallRow | null>(null);
  const incomingCallRef = useRef<VoiceIncomingCallPayload | null>(null);
  const phaseRef = useRef<VoicePhase>('idle');
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const selectedInputDeviceRef = useRef<string | null>(null);
  const selectedOutputDeviceRef = useRef<string | null>(null);

  useEffect(() => {
    callRef.current = activeCall;
  }, [activeCall]);

  useEffect(() => {
    incomingCallRef.current = incomingCall;
  }, [incomingCall]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const clearRingTimeout = useCallback(() => {
    if (ringTimeoutRef.current != null) {
      window.clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
  }, []);

  const cleanupRealtime = useCallback(async () => {
    const ch = signalingRef.current;
    signalingRef.current = null;
    if (ch) {
      await supabase.removeChannel(ch);
    }
  }, []);

  const cleanupSession = useCallback(() => {
    sessionRef.current?.cleanup();
    sessionRef.current = null;
  }, []);

  const resetUiState = useCallback(() => {
    setMuted(false);
    setElapsedSec(0);
    setCallStartedAt(null);
    setInputDeviceId(null);
    setOutputDeviceId(null);
    selectedInputDeviceRef.current = null;
    selectedOutputDeviceRef.current = null;
  }, []);

  const notifyIncomingIfHidden = useCallback(async (fromName: string) => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
    try {
      let granted = await isPermissionGranted();
      if (!granted) {
        const p = await requestPermission();
        granted = p === 'granted';
      }
      if (!granted) return;
      sendNotification({
        title: 'Incoming call',
        body: `${fromName} is calling you`,
      });
    } catch {
      /* Web/dev environments may not have Tauri notifications. */
    }
  }, []);

  const refreshAudioDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setInputDevices(devices.filter((d) => d.kind === 'audioinput'));
      setOutputDevices(devices.filter((d) => d.kind === 'audiooutput'));
    } catch {
      setInputDevices([]);
      setOutputDevices([]);
    }
  }, []);

  const sendInboxCallUpdate = useCallback(
    async (targetUserId: string, payload: { call_id: string; chat_id: string; status: VoiceCallStatus }) => {
      const ch = supabase.channel(voiceInboxTopic(targetUserId), { config: { broadcast: { self: true } } });
      try {
        await ch.httpSend(VOICE_CALL_UPDATE_INBOX_EVENT, payload);
      } finally {
        await supabase.removeChannel(ch);
      }
    },
    [],
  );

  const resolveStaleBlockingCall = useCallback(async (chatId: string) => {
    const { data } = await supabase
      .from('voice_calls')
      .select('id,status,created_at,updated_at,caller_id,callee_id')
      .eq('chat_id', chatId)
      .in('status', ['ringing', 'active'])
      .order('created_at', { ascending: false })
      .limit(1);

    const row = (data?.[0] ?? null) as Pick<
      VoiceCallRow,
      'id' | 'status' | 'created_at' | 'updated_at' | 'caller_id' | 'callee_id'
    > | null;

    if (!row) return null;

    const ageMs = Math.max(0, Date.now() - getCallActivityAt(row));
    const staleStatus =
      row.status === 'ringing'
        ? ageMs > STALE_RINGING_CALL_MS
          ? 'missed'
          : null
        : ageMs > STALE_ACTIVE_CALL_MS
          ? 'failed'
          : null;

    if (!staleStatus) {
      return row;
    }

    await supabase
      .from('voice_calls')
      .update({ status: staleStatus, updated_at: nowIso(), ended_at: nowIso() })
      .eq('id', row.id);

    const { data: remaining } = await supabase
      .from('voice_calls')
      .select('id,status,created_at,updated_at,caller_id,callee_id')
      .eq('chat_id', chatId)
      .in('status', ['ringing', 'active'])
      .order('created_at', { ascending: false })
      .limit(1);

    return (remaining?.[0] ?? null) as Pick<
      VoiceCallRow,
      'id' | 'status' | 'created_at' | 'updated_at' | 'caller_id' | 'callee_id'
    > | null;
  }, []);

  const showIncomingCall = useCallback(
    async (row: VoiceCallRow) => {
      let callerDisplayName = 'Someone';
      const { data: caller } = await supabase
        .from('users')
        .select('display_name, username')
        .eq('id', row.caller_id)
        .maybeSingle();

      if (caller) {
        callerDisplayName =
          (typeof caller.display_name === 'string' && caller.display_name.trim()) ||
          (typeof caller.username === 'string' && caller.username.trim()) ||
          'Someone';
      }

      const incoming: VoiceIncomingCallPayload = {
        call_id: row.id,
        chat_id: row.chat_id,
        caller_id: row.caller_id,
        caller_display_name: callerDisplayName,
      };

      setActiveCall(row);
      setIncomingCall(incoming);
      setPeerName(callerDisplayName);
      setPeerUserId(row.caller_id);
      setPhase('ringing-incoming');
      await notifyIncomingIfHidden(callerDisplayName);
    },
    [notifyIncomingIfHidden],
  );

  const markCallStatus = useCallback(
    async (callId: string, status: VoiceCallStatus) => {
      const patch: Partial<VoiceCallRow> & { status: VoiceCallStatus; updated_at: string; ended_at?: string | null } = {
        status,
        updated_at: nowIso(),
      };
      if (status === 'ended' || status === 'declined' || status === 'missed' || status === 'failed') {
        patch.ended_at = nowIso();
      }
      const { data } = await supabase.from('voice_calls').update(patch).eq('id', callId).select('*').maybeSingle();
      if (data) setActiveCall(data as VoiceCallRow);
      return data as VoiceCallRow | null;
    },
    [],
  );

  const sendSignaling = useCallback(
    async (event: string, payload: Record<string, unknown>) => {
      const ch = signalingRef.current;
      if (!ch) return;
      await ch.send({ type: 'broadcast', event, payload });
    },
    [],
  );

  const openSignalingChannel = useCallback(
    async (callRow: VoiceCallRow) => {
      await cleanupRealtime();
      const channel = supabase
        .channel(voiceSignalingTopic(callRow.id), { config: { broadcast: { self: true } } })
        .on('broadcast', { event: VOICE_SIGNAL_READY }, async ({ payload }) => {
          const p = payload as Partial<VoiceSignalReadyPayload> | null;
          if (!p?.from_user_id || p.from_user_id === user?.id || p.call_id !== callRow.id) return;
          if (user?.id !== callRow.caller_id) return;
          if (!sessionRef.current) return;
          try {
            const offer = await sessionRef.current.createOffer();
            await sendSignaling(VOICE_SIGNAL_OFFER, {
              call_id: callRow.id,
              from_user_id: user.id,
              sdp: offer,
            } satisfies VoiceSignalOfferPayload);
          } catch (e) {
            console.warn('offer failed', e);
          }
        })
        .on('broadcast', { event: VOICE_SIGNAL_OFFER }, async ({ payload }) => {
          const p = payload as Partial<VoiceSignalOfferPayload> | null;
          if (!p?.from_user_id || p.from_user_id === user?.id || p.call_id !== callRow.id || !p.sdp) return;
          if (!sessionRef.current || !user?.id) return;
          try {
            await sessionRef.current.applyOffer(p.sdp);
            const answer = await sessionRef.current.createAnswer(p.sdp);
            await sendSignaling(VOICE_SIGNAL_ANSWER, {
              call_id: callRow.id,
              from_user_id: user.id,
              sdp: answer,
            } satisfies VoiceSignalAnswerPayload);
          } catch (e) {
            console.warn('answer failed', e);
          }
        })
        .on('broadcast', { event: VOICE_SIGNAL_ANSWER }, async ({ payload }) => {
          const p = payload as Partial<VoiceSignalAnswerPayload> | null;
          if (!p?.from_user_id || p.from_user_id === user?.id || p.call_id !== callRow.id || !p.sdp) return;
          if (!sessionRef.current) return;
          try {
            await sessionRef.current.applyAnswer(p.sdp);
          } catch (e) {
            console.warn('apply answer failed', e);
          }
        })
        .on('broadcast', { event: VOICE_SIGNAL_ICE }, async ({ payload }) => {
          const p = payload as Partial<VoiceSignalIcePayload> | null;
          if (!p?.from_user_id || p.from_user_id === user?.id || p.call_id !== callRow.id || !p.candidate) return;
          if (!sessionRef.current) return;
          await sessionRef.current.addIceCandidate(p.candidate);
        })
        .on('broadcast', { event: VOICE_SIGNAL_HANGUP }, async ({ payload }) => {
          const p = payload as Partial<VoiceSignalHangupPayload> | null;
          if (!p?.from_user_id || p.from_user_id === user?.id || p.call_id !== callRow.id) return;
          clearRingTimeout();
          cleanupSession();
          await cleanupRealtime();
          setIncomingCall(null);
          setPhase('idle');
          setActiveCall(null);
          setPeerName('');
          setPeerUserId(null);
          resetUiState();
        });

      await whenRealtimeSubscribed(channel);
      signalingRef.current = channel;
    },
    [cleanupRealtime, cleanupSession, clearRingTimeout, resetUiState, sendSignaling, user?.id],
  );

  const ensureSession = useCallback(
    async (callRow: VoiceCallRow) => {
      if (!sessionRef.current) {
        sessionRef.current = new VoiceWebRtcSession({
          onIceCandidate: async (candidate) => {
            if (!user?.id) return;
            await sendSignaling(VOICE_SIGNAL_ICE, {
              call_id: callRow.id,
              from_user_id: user.id,
              candidate,
            } satisfies VoiceSignalIcePayload);
          },
          onRemoteStream: (stream) => {
            const audioEl = remoteAudioRef.current;
            if (!audioEl) return;
            audioEl.srcObject = stream;
            void audioEl.play().catch(() => undefined);
          },
          onConnectionStateChange: (state) => {
            if (state === 'connected') {
              setPhase('active');
              if (!callStartedAt) setCallStartedAt(Date.now());
            }
            if (state === 'failed' || state === 'disconnected' || state === 'closed') {
              setCallError('Connection ended.');
            }
          },
        });
      }

      await sessionRef.current.ensureLocalAudio(selectedInputDeviceRef.current ?? undefined);
      return sessionRef.current;
    },
    [callStartedAt, sendSignaling, user?.id],
  );

  const hardReset = useCallback(async () => {
    clearRingTimeout();
    cleanupSession();
    await cleanupRealtime();
    setIncomingCall(null);
    setActiveCall(null);
    setPeerName('');
    setPeerUserId(null);
    setPhase('idle');
    resetUiState();
  }, [cleanupRealtime, cleanupSession, clearRingTimeout, resetUiState]);

  const startCall = useCallback(
    async (chatId: string, calleeUserId: string, calleeName: string) => {
      const fail = (message: string) => {
        setCallError(message);
        return { ok: false as const, error: message };
      };

      if (!user?.id || !chatId || !calleeUserId) return fail('Sign in to start a call.');
      if (phaseRef.current !== 'idle') {
        return fail('You already have an ongoing call.');
      }

      setCallError(null);
      const blockingCall = await resolveStaleBlockingCall(chatId);
      if (blockingCall) {
        return fail('A call is already active or ringing in this chat.');
      }

      const { data, error } = await supabase
        .from('voice_calls')
        .insert({
          chat_id: chatId,
          caller_id: user.id,
          callee_id: calleeUserId,
          status: 'ringing',
          updated_at: nowIso(),
        })
        .select('*')
        .single();
      if (error || !data) {
        return fail(error?.message || 'Could not start the call.');
      }

      const row = data as VoiceCallRow;
      setActiveCall(row);
      setPeerName(calleeName || 'User');
      setPeerUserId(calleeUserId);
      setPhase('ringing-outgoing');
      await refreshAudioDevices();

      try {
        await ensureSession(row);
      } catch (e) {
        console.warn(e);
        await markCallStatus(row.id, 'failed');
        await hardReset();
        return fail('Microphone access is required to start a call.');
      }

      try {
        await openSignalingChannel(row);

        const callerDisplayName =
          (typeof profile?.display_name === 'string' && profile.display_name.trim()) ||
          (typeof profile?.username === 'string' && profile.username.trim()) ||
          'Someone';

         const inbox = supabase.channel(voiceInboxTopic(calleeUserId), { config: { broadcast: { self: true } } });
         try {
           await inbox.httpSend(VOICE_INBOX_EVENT, {
             call_id: row.id,
            chat_id: chatId,
            caller_id: user.id,
            caller_display_name: callerDisplayName,
          } satisfies VoiceIncomingCallPayload);
        } finally {
          await supabase.removeChannel(inbox);
        }

        await sendMobilePushNotification(supabase, {
          chatId,
          recipientUserIds: [calleeUserId],
          title: 'Incoming call',
          body: `${callerDisplayName} is calling you on DogitoChat`,
          kind: 'incoming_call',
        });

        clearRingTimeout();
        ringTimeoutRef.current = window.setTimeout(async () => {
          if (phaseRef.current !== 'ringing-outgoing' || callRef.current?.id !== row.id) return;
          await markCallStatus(row.id, 'missed');
          await sendSignaling(VOICE_SIGNAL_HANGUP, {
            call_id: row.id,
            from_user_id: user.id,
            reason: 'timeout',
          } satisfies VoiceSignalHangupPayload);
          await sendInboxCallUpdate(calleeUserId, { call_id: row.id, chat_id: chatId, status: 'missed' });
          await hardReset();
        }, VOICE_RING_TIMEOUT_MS);
      } catch (e) {
        console.warn(e);
        await markCallStatus(row.id, 'failed').catch(() => undefined);
        await sendSignaling(VOICE_SIGNAL_HANGUP, {
          call_id: row.id,
          from_user_id: user.id,
          reason: 'failed',
        } satisfies VoiceSignalHangupPayload).catch(() => undefined);
        await hardReset();
        const message = e instanceof Error ? e.message : 'Call could not be started.';
        return fail(message);
      }

      setCallError(null);
      return { ok: true as const, error: null };
    },
    [
      clearRingTimeout,
      ensureSession,
      hardReset,
      markCallStatus,
      openSignalingChannel,
      profile?.display_name,
      profile?.username,
      refreshAudioDevices,
      resolveStaleBlockingCall,
      sendInboxCallUpdate,
      sendSignaling,
      user?.id,
    ],
  );

  const acceptIncomingCall = useCallback(async () => {
    if (!incomingCall || !user?.id) return;
    if (phaseRef.current !== 'ringing-incoming') return;

    setCallError(null);
    const { data: callRowData } = await supabase.from('voice_calls').select('*').eq('id', incomingCall.call_id).maybeSingle();
    if (!callRowData) {
      setCallError('Call no longer available.');
      await hardReset();
      return;
    }
    const row = callRowData as VoiceCallRow;
    if (row.status !== 'ringing') {
      setCallError('Call already ended.');
      await hardReset();
      return;
    }

    await openSignalingChannel(row);
    try {
      await ensureSession(row);
    } catch {
      await markCallStatus(row.id, 'failed');
      await sendSignaling(VOICE_SIGNAL_HANGUP, {
        call_id: row.id,
        from_user_id: user.id,
        reason: 'mic_denied',
      } satisfies VoiceSignalHangupPayload);
      setCallError('Microphone access is required to accept a call.');
      await hardReset();
      return;
    }

    const activated = await markCallStatus(row.id, 'active');
    if (activated) setActiveCall(activated);

    setPhase('active');
    setCallStartedAt(Date.now());
    setIncomingCall(null);
    await sendSignaling(VOICE_SIGNAL_READY, {
      call_id: row.id,
      from_user_id: user.id,
    } satisfies VoiceSignalReadyPayload);

    if (window.location.hash !== `#/?id=${row.chat_id}`) {
      window.location.hash = `#/?id=${row.chat_id}`;
    }
  }, [ensureSession, hardReset, incomingCall, markCallStatus, openSignalingChannel, sendSignaling, user?.id]);

  const declineIncomingCall = useCallback(async () => {
    if (!incomingCall || !user?.id) return;
    const callId = incomingCall.call_id;
    await markCallStatus(callId, 'declined');
    await sendSignaling(VOICE_SIGNAL_HANGUP, {
      call_id: callId,
      from_user_id: user.id,
      reason: 'declined',
    } satisfies VoiceSignalHangupPayload);
    await hardReset();
  }, [hardReset, incomingCall, markCallStatus, sendSignaling, user?.id]);

  const endCall = useCallback(async () => {
    const row = callRef.current;
    if (!row || !user?.id) {
      await hardReset();
      return;
    }
    const nextStatus: VoiceCallStatus =
      phaseRef.current === 'ringing-outgoing' || phaseRef.current === 'ringing-incoming' ? 'declined' : 'ended';
    await markCallStatus(row.id, nextStatus);
    await sendSignaling(VOICE_SIGNAL_HANGUP, {
      call_id: row.id,
      from_user_id: user.id,
      reason: nextStatus,
    } satisfies VoiceSignalHangupPayload);
    await hardReset();
  }, [hardReset, markCallStatus, sendSignaling, user?.id]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    sessionRef.current?.setMuted(next);
  }, [muted]);

  const setInputDevice = useCallback(async (deviceId: string) => {
    selectedInputDeviceRef.current = deviceId;
    setInputDeviceId(deviceId);
    if (!sessionRef.current) return;
    await sessionRef.current.ensureLocalAudio(deviceId);
    sessionRef.current.setMuted(muted);
  }, [muted]);

  const setOutputDevice = useCallback(async (deviceId: string) => {
    selectedOutputDeviceRef.current = deviceId;
    setOutputDeviceId(deviceId);
    if (!sessionRef.current || !remoteAudioRef.current) return;
    const ok = await sessionRef.current.setOutputDevice(remoteAudioRef.current, deviceId);
    if (!ok) {
      setCallError('This browser does not support output device switching.');
      return;
    }
    setCallError(null);
  }, []);

  const clearError = useCallback(() => setCallError(null), []);

  useEffect(() => {
    if (!callStartedAt || phase !== 'active') {
      setElapsedSec(0);
      return;
    }
    const tick = () => setElapsedSec(Math.max(0, Math.floor((Date.now() - callStartedAt) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [callStartedAt, phase]);

  useEffect(() => {
    void refreshAudioDevices();
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const onChange = () => void refreshAudioDevices();
    md.addEventListener('devicechange', onChange);
    return () => md.removeEventListener('devicechange', onChange);
  }, [refreshAudioDevices]);

  useEffect(() => {
    const el = remoteAudioRef.current;
    if (!el) return;
    setOutputSwitchSupported(typeof (el as HTMLMediaElement & { setSinkId?: unknown }).setSinkId === 'function');
  }, []);

  useEffect(() => {
    if (!user?.id) {
      void hardReset();
      return;
    }

     const inbox = supabase
       .channel(voiceInboxTopic(user.id), { config: { broadcast: { self: true } } })
       .on('broadcast', { event: VOICE_INBOX_EVENT }, ({ payload }) => {
         const p = payload as Partial<VoiceIncomingCallPayload> | undefined;
         if (!p?.call_id || !p?.chat_id || !p?.caller_id) return;
        if (phaseRef.current !== 'idle') {
          void supabase
            .from('voice_calls')
            .update({ status: 'failed', updated_at: nowIso(), ended_at: nowIso() })
            .eq('id', p.call_id)
            .eq('callee_id', user.id);
          return;
        }

         const incoming: VoiceIncomingCallPayload = {
           call_id: String(p.call_id),
           chat_id: String(p.chat_id),
           caller_id: String(p.caller_id),
           caller_display_name:
             (typeof p.caller_display_name === 'string' && p.caller_display_name.trim()) || 'Someone',
         };
         setIncomingCall(incoming);
         setPeerName(incoming.caller_display_name);
         setPeerUserId(incoming.caller_id);
         setPhase('ringing-incoming');
        void notifyIncomingIfHidden(incoming.caller_display_name);
      })
      .on('broadcast', { event: VOICE_CALL_UPDATE_INBOX_EVENT }, ({ payload }) => {
        const p = payload as Partial<{ call_id: string; status: VoiceCallStatus }> | undefined;
        if (!p?.call_id || !p.status) return;
        if (callRef.current?.id !== p.call_id) return;
        if (p.status === 'declined' || p.status === 'missed' || p.status === 'ended' || p.status === 'failed') {
          void hardReset();
        }
      })
      .subscribe();

    const callsChannel = supabase
      .channel(`voice_calls:${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'voice_calls', filter: `caller_id=eq.${user.id}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as Partial<VoiceCallRow> | null;
          if (!row?.id) return;
          if (callRef.current?.id !== row.id) return;
          if (payload.eventType !== 'DELETE' && payload.new) {
            setActiveCall(payload.new as VoiceCallRow);
            const nextStatus = (payload.new as VoiceCallRow).status;
            if (nextStatus === 'active' && phaseRef.current !== 'active') {
              setPhase('active');
              setCallStartedAt(Date.now());
            }
            if (nextStatus === 'ended' || nextStatus === 'declined' || nextStatus === 'missed' || nextStatus === 'failed') {
              void hardReset();
            }
          } else {
            void hardReset();
          }
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'voice_calls', filter: `callee_id=eq.${user.id}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as Partial<VoiceCallRow> | null;
          if (!row?.id) return;
          if (payload.eventType !== 'DELETE' && payload.new) {
            const nextRow = payload.new as VoiceCallRow;
            if (nextRow.status === 'ringing' && phaseRef.current === 'idle') {
              void showIncomingCall(nextRow);
              return;
            }
            if (
              nextRow.status === 'ringing' &&
              phaseRef.current !== 'idle' &&
              callRef.current?.id !== nextRow.id &&
              incomingCallRef.current?.call_id !== nextRow.id
            ) {
              void supabase
                .from('voice_calls')
                .update({ status: 'failed', updated_at: nowIso(), ended_at: nowIso() })
                .eq('id', nextRow.id)
                .eq('callee_id', user.id);
              return;
            }
          }
          if (callRef.current?.id !== row.id) return;
          if (payload.eventType !== 'DELETE' && payload.new) {
            setActiveCall(payload.new as VoiceCallRow);
            const nextStatus = (payload.new as VoiceCallRow).status;
            if (nextStatus === 'active' && phaseRef.current !== 'active') {
              setPhase('active');
              setCallStartedAt(Date.now());
            }
            if (nextStatus === 'ended' || nextStatus === 'declined' || nextStatus === 'missed' || nextStatus === 'failed') {
              void hardReset();
            }
          } else {
            void hardReset();
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(inbox);
      void supabase.removeChannel(callsChannel);
    };
   }, [hardReset, incomingCall?.call_id, notifyIncomingIfHidden, showIncomingCall, user?.id]);

  useEffect(() => {
    return () => {
      void hardReset();
    };
  }, [hardReset]);

  const ctxValue = useMemo<VoiceCallContextType>(
    () => ({
      phase,
      activeCall,
      activeChatId: activeCall?.chat_id ?? incomingCall?.chat_id ?? null,
      peerName,
      peerUserId,
      muted,
      elapsedSec,
      inputDevices,
      outputDevices,
      inputDeviceId,
      outputDeviceId,
      outputSwitchSupported,
      callError,
      startCall,
      acceptIncomingCall,
      declineIncomingCall,
      endCall,
      toggleMute,
      setInputDevice,
      setOutputDevice,
      clearError,
    }),
    [
      acceptIncomingCall,
      activeCall,
      callError,
      declineIncomingCall,
      elapsedSec,
      endCall,
      incomingCall?.chat_id,
      inputDeviceId,
      inputDevices,
      muted,
      outputDeviceId,
      outputDevices,
      outputSwitchSupported,
      peerName,
      peerUserId,
      phase,
      setInputDevice,
      setOutputDevice,
      startCall,
      toggleMute,
      clearError,
    ],
  );

  return (
    <VoiceCallContext.Provider value={ctxValue}>
      {children}
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
      <IncomingCallModal
        isOpen={phase === 'ringing-incoming' && incomingCall != null}
        callerName={incomingCall?.caller_display_name ?? 'Someone'}
        onAccept={() => void acceptIncomingCall()}
        onDecline={() => void declineIncomingCall()}
      />
    </VoiceCallContext.Provider>
  );
}

export function useVoiceCall() {
  const ctx = useContext(VoiceCallContext);
  if (!ctx) throw new Error('useVoiceCall must be used inside VoiceCallProvider');
  return ctx;
}
