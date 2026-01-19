// ============================================================================
// VOICE CHAT HOOK WITH LIVEKIT INTEGRATION
// ============================================================================
// This hook provides voice chat functionality using LiveKit, integrated with
// the server's token generation endpoint.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  Participant,
  RemoteParticipant,
  LocalParticipant,
  ConnectionState,
  DisconnectReason,
} from "livekit-client";
import { useCollaborationStore } from "../store";

// ============================================================================
// TYPES
// ============================================================================

export interface VoiceParticipant {
  identity: string;
  name: string;
  isSpeaking: boolean;
  isMuted: boolean;
  audioLevel: number;
}

export interface VoiceChatState {
  isConnected: boolean;
  isConnecting: boolean;
  connectionState: ConnectionState;
  isMuted: boolean;
  isSpeaking: boolean;
  localAudioLevel: number;
  participants: Map<string, VoiceParticipant>;
  error: string | null;
}

export interface UseVoiceChatReturn {
  // State
  isConnected: boolean;
  isConnecting: boolean;
  isMuted: boolean;
  isSpeaking: boolean;
  participants: VoiceParticipant[];
  participantCount: number;
  error: string | null;

  // Actions
  connect: () => Promise<void>;
  disconnect: () => void;
  toggleMute: () => void;
  setMuted: (muted: boolean) => void;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const AUDIO_DEFAULTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

// ============================================================================
// HOOK IMPLEMENTATION
// ============================================================================

export function useVoiceChat(): UseVoiceChatReturn {
  // Room reference
  const roomRef = useRef<Room | null>(null);

  // State
  const [state, setState] = useState<VoiceChatState>({
    isConnected: false,
    isConnecting: false,
    connectionState: ConnectionState.Disconnected,
    isMuted: false,
    isSpeaking: false,
    localAudioLevel: 0,
    participants: new Map(),
    error: null,
  });

  // Store access
  const {
    voiceToken,
    voiceRoomName,
    voiceServerUrl,
    setVoiceChat,
    setMuted: setStoreMuted,
    setVoiceToken,
  } = useCollaborationStore();

  // ============================================================================
  // PARTICIPANT MANAGEMENT
  // ============================================================================

  const updateParticipant = useCallback(
    (participant: Participant, updates: Partial<VoiceParticipant>) => {
      setState((prev) => {
        const newParticipants = new Map(prev.participants);
        const existing = newParticipants.get(participant.identity) || {
          identity: participant.identity,
          name: participant.name || participant.identity,
          isSpeaking: false,
          isMuted: false,
          audioLevel: 0,
        };
        newParticipants.set(participant.identity, { ...existing, ...updates });
        return { ...prev, participants: newParticipants };
      });
    },
    [],
  );

  const removeParticipant = useCallback((identity: string) => {
    setState((prev) => {
      const newParticipants = new Map(prev.participants);
      newParticipants.delete(identity);
      return { ...prev, participants: newParticipants };
    });
  }, []);

  // ============================================================================
  // ROOM EVENT HANDLERS
  // ============================================================================

  const setupRoomEventHandlers = useCallback(
    (room: Room) => {
      // Connection state changes
      room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
        console.log("[VoiceChat] Connection state:", state);
        setState((prev) => ({
          ...prev,
          connectionState: state,
          isConnected: state === ConnectionState.Connected,
          isConnecting: state === ConnectionState.Connecting,
        }));

        if (state === ConnectionState.Connected) {
          setVoiceChat(true);
        } else if (state === ConnectionState.Disconnected) {
          setVoiceChat(false);
        }
      });

      // Participant connected
      room.on(
        RoomEvent.ParticipantConnected,
        (participant: RemoteParticipant) => {
          console.log(
            "[VoiceChat] Participant connected:",
            participant.identity,
          );
          updateParticipant(participant, {
            identity: participant.identity,
            name: participant.name || participant.identity,
            isSpeaking: false,
            isMuted: !participant.isMicrophoneEnabled,
            audioLevel: 0,
          });
        },
      );

      // Participant disconnected
      room.on(
        RoomEvent.ParticipantDisconnected,
        (participant: RemoteParticipant) => {
          console.log(
            "[VoiceChat] Participant disconnected:",
            participant.identity,
          );
          removeParticipant(participant.identity);
        },
      );

      // Track subscribed (audio from remote participant)
      room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        if (track.kind === Track.Kind.Audio) {
          console.log(
            "[VoiceChat] Audio track subscribed:",
            participant.identity,
          );
          // Audio tracks are automatically played by LiveKit
          track.attach();
        }
      });

      // Track unsubscribed
      room.on(
        RoomEvent.TrackUnsubscribed,
        (track, _publication, participant) => {
          if (track.kind === Track.Kind.Audio) {
            console.log(
              "[VoiceChat] Audio track unsubscribed:",
              participant.identity,
            );
            track.detach();
          }
        },
      );

      // Track muted/unmuted
      room.on(RoomEvent.TrackMuted, (publication, participant) => {
        if (publication.kind === Track.Kind.Audio) {
          updateParticipant(participant, { isMuted: true });
        }
      });

      room.on(RoomEvent.TrackUnmuted, (publication, participant) => {
        if (publication.kind === Track.Kind.Audio) {
          updateParticipant(participant, { isMuted: false });
        }
      });

      // Active speakers changed
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        const speakerIds = new Set(speakers.map((s) => s.identity));

        setState((prev) => {
          const newParticipants = new Map(prev.participants);
          newParticipants.forEach((p, id) => {
            newParticipants.set(id, {
              ...p,
              isSpeaking: speakerIds.has(id),
            });
          });

          // Check if local participant is speaking
          const localParticipant = room.localParticipant;
          const localIsSpeaking = speakerIds.has(localParticipant.identity);

          return {
            ...prev,
            participants: newParticipants,
            isSpeaking: localIsSpeaking,
          };
        });
      });

      // Audio level updates for participants
      room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
        // Handle audio playback status if needed
      });

      // Disconnected
      room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        console.log("[VoiceChat] Disconnected, reason:", reason);
        setState((prev) => ({
          ...prev,
          isConnected: false,
          isConnecting: false,
          participants: new Map(),
          isSpeaking: false,
        }));
        setVoiceChat(false);
      });

      // Reconnecting
      room.on(RoomEvent.Reconnecting, () => {
        console.log("[VoiceChat] Reconnecting...");
        setState((prev) => ({ ...prev, isConnecting: true }));
      });

      // Reconnected
      room.on(RoomEvent.Reconnected, () => {
        console.log("[VoiceChat] Reconnected");
        setState((prev) => ({
          ...prev,
          isConnected: true,
          isConnecting: false,
        }));
      });
    },
    [updateParticipant, removeParticipant, setVoiceChat],
  );

  // ============================================================================
  // CONNECTION MANAGEMENT
  // ============================================================================

  const connect = useCallback(async () => {
    // Check if we have the required credentials
    if (!voiceToken || !voiceServerUrl) {
      setState((prev) => ({
        ...prev,
        error: "No voice token available. Please request voice chat access.",
      }));
      console.error("[VoiceChat] No voice token or server URL");
      return;
    }

    // Don't connect if already connected or connecting
    if (roomRef.current?.state === ConnectionState.Connected) {
      console.log("[VoiceChat] Already connected");
      return;
    }

    setState((prev) => ({
      ...prev,
      isConnecting: true,
      error: null,
    }));

    try {
      // Create new room instance
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: AUDIO_DEFAULTS,
      });

      roomRef.current = room;

      // Set up event handlers
      setupRoomEventHandlers(room);

      // Connect to the room
      console.log("[VoiceChat] Connecting to:", voiceServerUrl);
      await room.connect(voiceServerUrl, voiceToken);

      console.log("[VoiceChat] Connected to room:", voiceRoomName);

      // Enable microphone
      await room.localParticipant.setMicrophoneEnabled(true);

      // Add existing participants
      room.remoteParticipants.forEach((participant) => {
        updateParticipant(participant, {
          identity: participant.identity,
          name: participant.name || participant.identity,
          isSpeaking: false,
          isMuted: !participant.isMicrophoneEnabled,
          audioLevel: 0,
        });
      });

      setState((prev) => ({
        ...prev,
        isConnected: true,
        isConnecting: false,
        isMuted: false,
      }));

      setVoiceChat(true);
      setStoreMuted(false);
    } catch (error) {
      console.error("[VoiceChat] Connection error:", error);
      setState((prev) => ({
        ...prev,
        isConnected: false,
        isConnecting: false,
        error: error instanceof Error ? error.message : "Connection failed",
      }));

      // Clean up
      if (roomRef.current) {
        await roomRef.current.disconnect();
        roomRef.current = null;
      }
    }
  }, [
    voiceToken,
    voiceServerUrl,
    voiceRoomName,
    setupRoomEventHandlers,
    updateParticipant,
    setVoiceChat,
    setStoreMuted,
  ]);

  const disconnect = useCallback(() => {
    console.log("[VoiceChat] Disconnecting...");

    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }

    setState({
      isConnected: false,
      isConnecting: false,
      connectionState: ConnectionState.Disconnected,
      isMuted: false,
      isSpeaking: false,
      localAudioLevel: 0,
      participants: new Map(),
      error: null,
    });

    setVoiceChat(false);
    setVoiceToken(null, null, null);
  }, [setVoiceChat, setVoiceToken]);

  // ============================================================================
  // MUTE CONTROLS
  // ============================================================================

  const toggleMute = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;

    const newMuted = !state.isMuted;
    room.localParticipant.setMicrophoneEnabled(!newMuted);

    setState((prev) => ({ ...prev, isMuted: newMuted }));
    setStoreMuted(newMuted);
  }, [state.isMuted, setStoreMuted]);

  const setMuted = useCallback(
    (muted: boolean) => {
      const room = roomRef.current;
      if (!room) return;

      room.localParticipant.setMicrophoneEnabled(!muted);

      setState((prev) => ({ ...prev, isMuted: muted }));
      setStoreMuted(muted);
    },
    [setStoreMuted],
  );

  // ============================================================================
  // AUTO-CONNECT WHEN TOKEN IS RECEIVED
  // ============================================================================

  useEffect(() => {
    // Listen for voice token events from the collaboration hook
    const handleVoiceToken = (event: CustomEvent) => {
      const { token, roomName, serverUrl } = event.detail;
      console.log("[VoiceChat] Received voice token for room:", roomName);

      // Store the token
      setVoiceToken(token, roomName, serverUrl);
    };

    window.addEventListener("voiceToken", handleVoiceToken as EventListener);

    return () => {
      window.removeEventListener(
        "voiceToken",
        handleVoiceToken as EventListener,
      );
    };
  }, [setVoiceToken]);

  // Auto-connect when token becomes available
  useEffect(() => {
    if (
      voiceToken &&
      voiceServerUrl &&
      !state.isConnected &&
      !state.isConnecting
    ) {
      connect();
    }
  }, [
    voiceToken,
    voiceServerUrl,
    state.isConnected,
    state.isConnecting,
    connect,
  ]);

  // ============================================================================
  // CLEANUP
  // ============================================================================

  useEffect(() => {
    return () => {
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
    };
  }, []);

  // ============================================================================
  // RETURN VALUE
  // ============================================================================

  const participants = Array.from(state.participants.values());

  return {
    // State
    isConnected: state.isConnected,
    isConnecting: state.isConnecting,
    isMuted: state.isMuted,
    isSpeaking: state.isSpeaking,
    participants,
    participantCount: participants.length,
    error: state.error,

    // Actions
    connect,
    disconnect,
    toggleMute,
    setMuted,
  };
}

export default useVoiceChat;
