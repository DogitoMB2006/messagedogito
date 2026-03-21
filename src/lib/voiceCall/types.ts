export type VoiceCallStatus = 'ringing' | 'active' | 'ended' | 'declined' | 'missed' | 'failed';

export type VoiceCallRow = {
  id: string;
  chat_id: string;
  caller_id: string;
  callee_id: string;
  status: VoiceCallStatus;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
};

export const VOICE_INBOX_EVENT = 'voice_call_incoming';
export const VOICE_CALL_UPDATE_INBOX_EVENT = 'voice_call_updated';

export const VOICE_SIGNALING_PREFIX = 'voice-signaling';
export const VOICE_SIGNAL_OFFER = 'offer';
export const VOICE_SIGNAL_ANSWER = 'answer';
export const VOICE_SIGNAL_ICE = 'ice-candidate';
export const VOICE_SIGNAL_HANGUP = 'hangup';
export const VOICE_SIGNAL_READY = 'peer-ready';

export const VOICE_RING_TIMEOUT_MS = 45_000;

export function voiceSignalingTopic(callId: string) {
  return `${VOICE_SIGNALING_PREFIX}:${callId}`;
}

export type VoiceIncomingCallPayload = {
  call_id: string;
  chat_id: string;
  caller_id: string;
  caller_display_name: string;
};

export type VoiceCallUpdatePayload = {
  call_id: string;
  chat_id: string;
  status: VoiceCallStatus;
};

export type VoiceSignalOfferPayload = {
  call_id: string;
  from_user_id: string;
  sdp: RTCSessionDescriptionInit;
};

export type VoiceSignalAnswerPayload = {
  call_id: string;
  from_user_id: string;
  sdp: RTCSessionDescriptionInit;
};

export type VoiceSignalIcePayload = {
  call_id: string;
  from_user_id: string;
  candidate: RTCIceCandidateInit;
};

export type VoiceSignalReadyPayload = {
  call_id: string;
  from_user_id: string;
};

export type VoiceSignalHangupPayload = {
  call_id: string;
  from_user_id: string;
  reason?: string;
};
