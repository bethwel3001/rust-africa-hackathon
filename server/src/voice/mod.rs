//! Voice module for LiveKit integration.
//!
//! This module handles:
//! - LiveKit JWT token generation for room authentication
//! - Voice room management
//! - Token refresh and expiration handling

mod livekit;

pub use livekit::{LiveKitConfig, LiveKitService};

use serde::{Deserialize, Serialize};

/// Voice room information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceRoom {
    /// Room name (matches project ID)
    pub room_name: String,
    /// Maximum number of participants
    pub max_participants: u32,
    /// Whether the room is currently active
    pub active: bool,
    /// Creation timestamp
    pub created_at: i64,
    /// Number of current participants
    pub participant_count: u32,
}

impl VoiceRoom {
    pub fn new(room_name: impl Into<String>) -> Self {
        Self {
            room_name: room_name.into(),
            max_participants: 50,
            active: true,
            created_at: chrono::Utc::now().timestamp(),
            participant_count: 0,
        }
    }

    pub fn with_max_participants(mut self, max: u32) -> Self {
        self.max_participants = max;
        self
    }
}

/// Voice participant information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceParticipant {
    /// Participant ID (peer ID)
    pub participant_id: String,
    /// Display name
    pub name: String,
    /// Room they're in
    pub room_name: String,
    /// Whether they're muted
    pub muted: bool,
    /// Whether they're deafened
    pub deafened: bool,
    /// Whether they're currently speaking
    pub speaking: bool,
    /// Join timestamp
    pub joined_at: i64,
}

impl VoiceParticipant {
    pub fn new(
        participant_id: impl Into<String>,
        name: impl Into<String>,
        room_name: impl Into<String>,
    ) -> Self {
        Self {
            participant_id: participant_id.into(),
            name: name.into(),
            room_name: room_name.into(),
            muted: false,
            deafened: false,
            speaking: false,
            joined_at: chrono::Utc::now().timestamp(),
        }
    }
}

/// Voice chat permissions
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct VoicePermissions {
    /// Can publish audio
    pub can_publish: bool,
    /// Can subscribe to others' audio
    pub can_subscribe: bool,
    /// Can publish data messages
    pub can_publish_data: bool,
}

impl Default for VoicePermissions {
    fn default() -> Self {
        Self {
            can_publish: true,
            can_subscribe: true,
            can_publish_data: true,
        }
    }
}

impl VoicePermissions {
    /// Full permissions (default)
    pub fn full() -> Self {
        Self::default()
    }

    /// Listen-only permissions
    pub fn listen_only() -> Self {
        Self {
            can_publish: false,
            can_subscribe: true,
            can_publish_data: false,
        }
    }

    /// Muted permissions (can't publish but can receive)
    pub fn muted() -> Self {
        Self {
            can_publish: false,
            can_subscribe: true,
            can_publish_data: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_voice_room_creation() {
        let room = VoiceRoom::new("test-room")
            .with_max_participants(10);

        assert_eq!(room.room_name, "test-room");
        assert_eq!(room.max_participants, 10);
        assert!(room.active);
        assert_eq!(room.participant_count, 0);
    }

    #[test]
    fn test_voice_participant() {
        let participant = VoiceParticipant::new("peer-1", "Alice", "room-1");

        assert_eq!(participant.participant_id, "peer-1");
        assert_eq!(participant.name, "Alice");
        assert!(!participant.muted);
        assert!(!participant.speaking);
    }

    #[test]
    fn test_voice_permissions() {
        let full = VoicePermissions::full();
        assert!(full.can_publish);
        assert!(full.can_subscribe);

        let listen = VoicePermissions::listen_only();
        assert!(!listen.can_publish);
        assert!(listen.can_subscribe);

        let muted = VoicePermissions::muted();
        assert!(!muted.can_publish);
        assert!(muted.can_subscribe);
        assert!(muted.can_publish_data);
    }
}
