type VoiceSessionOpts = {
  onIceCandidate?: (candidate: RTCIceCandidateInit) => void;
  onRemoteStream?: (stream: MediaStream) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
};

const DEFAULT_STUN_URLS = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'];

function parseIceUrls(raw: string | undefined, fallback: string[]): string[] {
  const values = (raw ?? '')
    .split(/[\r\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);

  return values.length > 0 ? values : fallback;
}

function buildIceServers(): RTCIceServer[] {
  const stunUrls = parseIceUrls(import.meta.env.VITE_STUN_URLS, DEFAULT_STUN_URLS);
  const turnUrls = parseIceUrls(import.meta.env.VITE_TURN_URLS, []);
  const turnUsername = import.meta.env.VITE_TURN_USERNAME?.trim();
  const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL?.trim();

  const servers: RTCIceServer[] = [{ urls: stunUrls }];

  if (turnUrls.length > 0 && turnUsername && turnCredential) {
    servers.push({
      urls: turnUrls,
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return servers;
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = buildIceServers();

export class VoiceWebRtcSession {
  private pc: RTCPeerConnection;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream = new MediaStream();
  private activeInputDeviceId: string | null = null;

  constructor(private opts: VoiceSessionOpts = {}) {
    this.pc = new RTCPeerConnection({
      iceServers: DEFAULT_ICE_SERVERS,
      iceCandidatePoolSize: 4,
    });

    this.pc.onicecandidate = (event) => {
      if (event.candidate && this.opts.onIceCandidate) {
        this.opts.onIceCandidate(event.candidate.toJSON());
      }
    };

    this.pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) {
        this.remoteStream = stream;
        this.opts.onRemoteStream?.(stream);
        return;
      }
      this.remoteStream.addTrack(event.track);
      this.opts.onRemoteStream?.(this.remoteStream);
    };

    this.pc.onconnectionstatechange = () => {
      this.opts.onConnectionStateChange?.(this.pc.connectionState);
    };
  }

  getPeerConnection() {
    return this.pc;
  }

  getLocalStream() {
    return this.localStream;
  }

  getRemoteStream() {
    return this.remoteStream;
  }

  getInputDeviceId() {
    return this.activeInputDeviceId;
  }

  async ensureLocalAudio(inputDeviceId?: string) {
    if (this.localStream && !inputDeviceId) return this.localStream;
    if (this.localStream && inputDeviceId === this.activeInputDeviceId) return this.localStream;

    const constraints: MediaStreamConstraints = {
      audio: inputDeviceId
        ? {
            deviceId: { exact: inputDeviceId },
            echoCancellation: true,
            noiseSuppression: true,
          }
        : {
            echoCancellation: true,
            noiseSuppression: true,
          },
      video: false,
    };

    const next = await navigator.mediaDevices.getUserMedia(constraints);
    const [nextTrack] = next.getAudioTracks();
    if (!nextTrack) throw new Error('Could not get an audio track from microphone.');

    const sender = this.pc.getSenders().find((s) => s.track?.kind === 'audio');
    if (sender) {
      await sender.replaceTrack(nextTrack);
    } else {
      this.pc.addTrack(nextTrack, next);
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
    }
    this.localStream = next;
    this.activeInputDeviceId = inputDeviceId ?? null;
    return next;
  }

  async createOffer() {
    const offer = await this.pc.createOffer({
      offerToReceiveAudio: true,
    });
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  async createAnswer(remoteSdp: RTCSessionDescriptionInit) {
    if (!this.pc.currentRemoteDescription) {
      await this.pc.setRemoteDescription(remoteSdp);
    }
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer;
  }

  async applyAnswer(remoteSdp: RTCSessionDescriptionInit) {
    if (this.pc.currentRemoteDescription) return;
    await this.pc.setRemoteDescription(remoteSdp);
  }

  async applyOffer(remoteSdp: RTCSessionDescriptionInit) {
    if (!this.pc.currentRemoteDescription) {
      await this.pc.setRemoteDescription(remoteSdp);
      return;
    }
    if (this.pc.signalingState === 'stable') {
      await this.pc.setRemoteDescription(remoteSdp);
    }
  }

  async addIceCandidate(candidate: RTCIceCandidateInit) {
    try {
      await this.pc.addIceCandidate(candidate);
    } catch {
      // Ignore occasional race conditions where candidate arrives before remote description.
    }
  }

  setMuted(muted: boolean) {
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  async setOutputDevice(mediaEl: HTMLMediaElement, sinkId: string) {
    const withSink = mediaEl as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };
    if (!withSink.setSinkId) return false;
    await withSink.setSinkId(sinkId);
    return true;
  }

  cleanup() {
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.remoteStream.getTracks().forEach((t) => t.stop());
    this.remoteStream = new MediaStream();
    this.pc.close();
  }
}
