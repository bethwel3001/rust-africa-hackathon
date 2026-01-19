//! Binary WebSocket protocol for Automerge synchronization.
//!
//! This module defines the binary message format for client-server communication.
//! All messages are serialized using bincode for efficiency, with Automerge sync
//! messages embedded as raw bytes.

use bytes::{Buf, BufMut, Bytes, BytesMut};
use serde::{Deserialize, Serialize};
use std::io::{self, Cursor};

use super::{PeerId, ProjectId};

/// Protocol version for compatibility checking
pub const PROTOCOL_VERSION: u8 = 1;

/// Maximum message size (16MB)
pub const MAX_MESSAGE_SIZE: usize = 16 * 1024 * 1024;

/// Message type identifiers for efficient binary encoding
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageType {
    // Connection & Authentication
    Hello = 0x01,
    Welcome = 0x02,
    Goodbye = 0x03,
    Error = 0x04,

    // Automerge Sync (binary payloads)
    SyncRequest = 0x10,
    SyncMessage = 0x11,
    SyncComplete = 0x12,

    // Document Operations
    JoinProject = 0x20,
    LeaveProject = 0x21,
    ProjectJoined = 0x22,
    ProjectLeft = 0x23,

    // File Operations
    OpenFile = 0x30,
    CloseFile = 0x31,
    FileContent = 0x32,
    FileRequest = 0x33,

    // Presence & Cursors (high-frequency, separate channel)
    PresenceUpdate = 0x40,
    PresenceBroadcast = 0x41,
    CursorUpdate = 0x42,
    CursorBroadcast = 0x43,

    // Chat
    ChatMessage = 0x50,
    ChatHistory = 0x51,

    // Voice (signaling only - actual audio via LiveKit)
    VoiceJoin = 0x60,
    VoiceLeave = 0x61,
    VoiceToken = 0x62,

    // Admin/Debug
    Ping = 0xF0,
    Pong = 0xF1,
    Stats = 0xF2,
}

impl TryFrom<u8> for MessageType {
    type Error = ProtocolError;

    fn try_from(value: u8) -> Result<Self, <Self as TryFrom<u8>>::Error> {
        match value {
            0x01 => Ok(MessageType::Hello),
            0x02 => Ok(MessageType::Welcome),
            0x03 => Ok(MessageType::Goodbye),
            0x04 => Ok(MessageType::Error),
            0x10 => Ok(MessageType::SyncRequest),
            0x11 => Ok(MessageType::SyncMessage),
            0x12 => Ok(MessageType::SyncComplete),
            0x20 => Ok(MessageType::JoinProject),
            0x21 => Ok(MessageType::LeaveProject),
            0x22 => Ok(MessageType::ProjectJoined),
            0x23 => Ok(MessageType::ProjectLeft),
            0x30 => Ok(MessageType::OpenFile),
            0x31 => Ok(MessageType::CloseFile),
            0x32 => Ok(MessageType::FileContent),
            0x33 => Ok(MessageType::FileRequest),
            0x40 => Ok(MessageType::PresenceUpdate),
            0x41 => Ok(MessageType::PresenceBroadcast),
            0x42 => Ok(MessageType::CursorUpdate),
            0x43 => Ok(MessageType::CursorBroadcast),
            0x50 => Ok(MessageType::ChatMessage),
            0x51 => Ok(MessageType::ChatHistory),
            0x60 => Ok(MessageType::VoiceJoin),
            0x61 => Ok(MessageType::VoiceLeave),
            0x62 => Ok(MessageType::VoiceToken),
            0xF0 => Ok(MessageType::Ping),
            0xF1 => Ok(MessageType::Pong),
            0xF2 => Ok(MessageType::Stats),
            _ => Err(ProtocolError::UnknownMessageType(value)),
        }
    }
}

/// Protocol errors
#[derive(Debug, Clone, thiserror::Error)]
pub enum ProtocolError {
    #[error("Unknown message type: 0x{0:02X}")]
    UnknownMessageType(u8),

    #[error("Invalid message format: {0}")]
    InvalidFormat(String),

    #[error("Message too large: {0} bytes (max: {1})")]
    MessageTooLarge(usize, usize),

    #[error("Version mismatch: expected {0}, got {1}")]
    VersionMismatch(u8, u8),

    #[error("Serialization error: {0}")]
    Serialization(String),

    #[error("IO error: {0}")]
    Io(String),
}

impl From<bincode::Error> for ProtocolError {
    fn from(err: bincode::Error) -> Self {
        ProtocolError::Serialization(err.to_string())
    }
}

impl From<io::Error> for ProtocolError {
    fn from(err: io::Error) -> Self {
        ProtocolError::Io(err.to_string())
    }
}

/// Messages sent from client to server
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ClientMessage {
    /// Initial handshake with client info
    Hello {
        protocol_version: u8,
        client_id: Option<PeerId>,
        client_name: String,
        session_token: Option<String>,
    },

    /// Graceful disconnect
    Goodbye {
        reason: Option<String>,
    },

    /// Join a project/room
    JoinProject {
        project_id: ProjectId,
        request_state: bool, // Request full state on join
    },

    /// Leave a project/room
    LeaveProject {
        project_id: ProjectId,
    },

    /// Automerge sync message (binary)
    SyncMessage {
        project_id: ProjectId,
        /// Raw Automerge sync message bytes
        sync_data: Vec<u8>,
    },

    /// Request sync with the server
    SyncRequest {
        project_id: ProjectId,
    },

    /// Request to open a file (load content on-demand)
    OpenFile {
        project_id: ProjectId,
        file_path: String,
    },

    /// Notify that a file is closed
    CloseFile {
        project_id: ProjectId,
        file_path: String,
    },

    /// Update local cursor position
    CursorUpdate {
        project_id: ProjectId,
        file_path: String,
        /// Line number (1-based)
        line: u32,
        /// Column number (1-based)
        column: u32,
        /// Optional selection end position
        selection_end: Option<(u32, u32)>,
    },

    /// Update presence information
    PresenceUpdate {
        project_id: ProjectId,
        status: PresenceStatus,
        active_file: Option<String>,
    },

    /// Send a chat message
    ChatMessage {
        project_id: ProjectId,
        content: String,
    },

    /// Request to join voice chat
    VoiceJoin {
        project_id: ProjectId,
    },

    /// Leave voice chat
    VoiceLeave {
        project_id: ProjectId,
    },

    /// Ping for keepalive
    Ping {
        timestamp: u64,
    },
}

/// Messages sent from server to client
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ServerMessage {
    /// Welcome response with assigned peer ID
    Welcome {
        protocol_version: u8,
        peer_id: PeerId,
        color: String,
        session_token: String,
        server_time: i64,
    },

    /// Error response
    Error {
        code: ErrorCode,
        message: String,
        project_id: Option<ProjectId>,
    },

    /// Graceful disconnect acknowledgment
    Goodbye {
        reason: Option<String>,
    },

    /// Confirmation of joining a project
    ProjectJoined {
        project_id: ProjectId,
        /// List of other peers in the project
        peers: Vec<PeerInfo>,
        /// Full document state if requested (Automerge binary)
        document_state: Option<Vec<u8>>,
    },

    /// Notification that a peer joined
    PeerJoined {
        project_id: ProjectId,
        peer: PeerInfo,
    },

    /// Confirmation of leaving a project
    ProjectLeft {
        project_id: ProjectId,
    },

    /// Notification that a peer left
    PeerLeft {
        project_id: ProjectId,
        peer_id: PeerId,
        reason: Option<String>,
    },

    /// Automerge sync message from server (binary)
    SyncMessage {
        project_id: ProjectId,
        /// Raw Automerge sync message bytes
        sync_data: Vec<u8>,
        /// Originating peer (if relayed)
        from_peer: Option<PeerId>,
    },

    /// Sync complete notification
    SyncComplete {
        project_id: ProjectId,
    },

    /// File content response
    FileContent {
        project_id: ProjectId,
        file_path: String,
        content: String,
        language: String,
        version: u64,
    },

    /// File not found error
    FileNotFound {
        project_id: ProjectId,
        file_path: String,
    },

    /// Cursor broadcast from another peer
    CursorBroadcast {
        project_id: ProjectId,
        peer_id: PeerId,
        peer_name: String,
        peer_color: String,
        file_path: String,
        line: u32,
        column: u32,
        selection_end: Option<(u32, u32)>,
    },

    /// Presence broadcast from another peer
    PresenceBroadcast {
        project_id: ProjectId,
        peer_id: PeerId,
        peer_name: String,
        status: PresenceStatus,
        active_file: Option<String>,
        last_active: i64,
    },

    /// Chat message broadcast
    ChatBroadcast {
        project_id: ProjectId,
        peer_id: PeerId,
        peer_name: String,
        content: String,
        timestamp: i64,
    },

    /// Chat history response
    ChatHistory {
        project_id: ProjectId,
        messages: Vec<ChatHistoryItem>,
    },

    /// Voice chat token
    VoiceToken {
        project_id: ProjectId,
        token: String,
        room_name: String,
        server_url: String,
    },

    /// Pong response
    Pong {
        timestamp: u64,
        server_time: i64,
    },

    /// Server statistics
    Stats {
        active_projects: u32,
        active_peers: u32,
        uptime_seconds: u64,
    },
}

/// Presence status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PresenceStatus {
    Active,
    Idle,
    Away,
    Offline,
}

/// Information about a peer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerInfo {
    pub peer_id: PeerId,
    pub name: String,
    pub color: String,
    pub status: PresenceStatus,
    pub active_file: Option<String>,
    pub joined_at: i64,
}

/// Chat history item
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatHistoryItem {
    pub peer_id: PeerId,
    pub peer_name: String,
    pub content: String,
    pub timestamp: i64,
}

/// Error codes for server responses
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u16)]
pub enum ErrorCode {
    Unknown = 0,
    InvalidMessage = 1,
    Unauthorized = 2,
    ProjectNotFound = 3,
    FileNotFound = 4,
    RateLimited = 5,
    ServerError = 6,
    VersionMismatch = 7,
    ProjectFull = 8,
    AlreadyJoined = 9,
    NotJoined = 10,
}

/// Protocol codec for encoding/decoding messages
pub struct SyncProtocol;

impl SyncProtocol {
    /// Encode a client message to bytes
    pub fn encode_client(msg: &ClientMessage) -> Result<Bytes, ProtocolError> {
        let msg_type = match msg {
            ClientMessage::Hello { .. } => MessageType::Hello,
            ClientMessage::Goodbye { .. } => MessageType::Goodbye,
            ClientMessage::JoinProject { .. } => MessageType::JoinProject,
            ClientMessage::LeaveProject { .. } => MessageType::LeaveProject,
            ClientMessage::SyncMessage { .. } => MessageType::SyncMessage,
            ClientMessage::SyncRequest { .. } => MessageType::SyncRequest,
            ClientMessage::OpenFile { .. } => MessageType::OpenFile,
            ClientMessage::CloseFile { .. } => MessageType::CloseFile,
            ClientMessage::CursorUpdate { .. } => MessageType::CursorUpdate,
            ClientMessage::PresenceUpdate { .. } => MessageType::PresenceUpdate,
            ClientMessage::ChatMessage { .. } => MessageType::ChatMessage,
            ClientMessage::VoiceJoin { .. } => MessageType::VoiceJoin,
            ClientMessage::VoiceLeave { .. } => MessageType::VoiceLeave,
            ClientMessage::Ping { .. } => MessageType::Ping,
        };

        let payload = bincode::serialize(msg)?;

        if payload.len() + 5 > MAX_MESSAGE_SIZE {
            return Err(ProtocolError::MessageTooLarge(
                payload.len() + 5,
                MAX_MESSAGE_SIZE,
            ));
        }

        let mut buf = BytesMut::with_capacity(5 + payload.len());
        buf.put_u8(PROTOCOL_VERSION);
        buf.put_u8(msg_type as u8);
        buf.put_u24(payload.len() as u32);
        buf.put_slice(&payload);

        Ok(buf.freeze())
    }

    /// Encode a server message to bytes
    pub fn encode_server(msg: &ServerMessage) -> Result<Bytes, ProtocolError> {
        let msg_type = match msg {
            ServerMessage::Welcome { .. } => MessageType::Welcome,
            ServerMessage::Error { .. } => MessageType::Error,
            ServerMessage::Goodbye { .. } => MessageType::Goodbye,
            ServerMessage::ProjectJoined { .. } => MessageType::ProjectJoined,
            ServerMessage::PeerJoined { .. } => MessageType::ProjectJoined,
            ServerMessage::ProjectLeft { .. } => MessageType::ProjectLeft,
            ServerMessage::PeerLeft { .. } => MessageType::ProjectLeft,
            ServerMessage::SyncMessage { .. } => MessageType::SyncMessage,
            ServerMessage::SyncComplete { .. } => MessageType::SyncComplete,
            ServerMessage::FileContent { .. } => MessageType::FileContent,
            ServerMessage::FileNotFound { .. } => MessageType::FileRequest,
            ServerMessage::CursorBroadcast { .. } => MessageType::CursorBroadcast,
            ServerMessage::PresenceBroadcast { .. } => MessageType::PresenceBroadcast,
            ServerMessage::ChatBroadcast { .. } => MessageType::ChatMessage,
            ServerMessage::ChatHistory { .. } => MessageType::ChatHistory,
            ServerMessage::VoiceToken { .. } => MessageType::VoiceToken,
            ServerMessage::Pong { .. } => MessageType::Pong,
            ServerMessage::Stats { .. } => MessageType::Stats,
        };

        let payload = bincode::serialize(msg)?;

        if payload.len() + 5 > MAX_MESSAGE_SIZE {
            return Err(ProtocolError::MessageTooLarge(
                payload.len() + 5,
                MAX_MESSAGE_SIZE,
            ));
        }

        let mut buf = BytesMut::with_capacity(5 + payload.len());
        buf.put_u8(PROTOCOL_VERSION);
        buf.put_u8(msg_type as u8);
        buf.put_u24(payload.len() as u32);
        buf.put_slice(&payload);

        Ok(buf.freeze())
    }

    /// Decode a client message from bytes
    pub fn decode_client(data: &[u8]) -> Result<ClientMessage, ProtocolError> {
        if data.len() < 5 {
            return Err(ProtocolError::InvalidFormat(
                "Message too short".to_string(),
            ));
        }

        let mut cursor = Cursor::new(data);

        let version = cursor.get_u8();
        if version != PROTOCOL_VERSION {
            return Err(ProtocolError::VersionMismatch(PROTOCOL_VERSION, version));
        }

        let _msg_type = cursor.get_u8(); // We could validate this
        let payload_len = cursor.get_uint(3) as usize;

        if data.len() < 5 + payload_len {
            return Err(ProtocolError::InvalidFormat(format!(
                "Expected {} bytes, got {}",
                5 + payload_len,
                data.len()
            )));
        }

        let payload = &data[5..5 + payload_len];
        let msg: ClientMessage = bincode::deserialize(payload)?;

        Ok(msg)
    }

    /// Decode a server message from bytes
    pub fn decode_server(data: &[u8]) -> Result<ServerMessage, ProtocolError> {
        if data.len() < 5 {
            return Err(ProtocolError::InvalidFormat(
                "Message too short".to_string(),
            ));
        }

        let mut cursor = Cursor::new(data);

        let version = cursor.get_u8();
        if version != PROTOCOL_VERSION {
            return Err(ProtocolError::VersionMismatch(PROTOCOL_VERSION, version));
        }

        let _msg_type = cursor.get_u8();
        let payload_len = cursor.get_uint(3) as usize;

        if data.len() < 5 + payload_len {
            return Err(ProtocolError::InvalidFormat(format!(
                "Expected {} bytes, got {}",
                5 + payload_len,
                data.len()
            )));
        }

        let payload = &data[5..5 + payload_len];
        let msg: ServerMessage = bincode::deserialize(payload)?;

        Ok(msg)
    }

    /// Create an error response message
    pub fn error_response(
        code: ErrorCode,
        message: impl Into<String>,
        project_id: Option<ProjectId>,
    ) -> ServerMessage {
        ServerMessage::Error {
            code,
            message: message.into(),
            project_id,
        }
    }
}

/// Extension trait for writing u24 values
trait BufMutExt {
    fn put_u24(&mut self, n: u32);
}

impl BufMutExt for BytesMut {
    fn put_u24(&mut self, n: u32) {
        self.put_u8((n >> 16) as u8);
        self.put_u8((n >> 8) as u8);
        self.put_u8(n as u8);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_decode_client_hello() {
        let msg = ClientMessage::Hello {
            protocol_version: PROTOCOL_VERSION,
            client_id: Some("client-123".to_string()),
            client_name: "Test User".to_string(),
            session_token: None,
        };

        let encoded = SyncProtocol::encode_client(&msg).unwrap();
        let decoded = SyncProtocol::decode_client(&encoded).unwrap();

        match decoded {
            ClientMessage::Hello {
                protocol_version,
                client_id,
                client_name,
                ..
            } => {
                assert_eq!(protocol_version, PROTOCOL_VERSION);
                assert_eq!(client_id, Some("client-123".to_string()));
                assert_eq!(client_name, "Test User");
            }
            _ => panic!("Wrong message type"),
        }
    }

    #[test]
    fn test_encode_decode_server_welcome() {
        let msg = ServerMessage::Welcome {
            protocol_version: PROTOCOL_VERSION,
            peer_id: "peer-456".to_string(),
            color: "#ff5500".to_string(),
            session_token: "token-abc".to_string(),
            server_time: 1234567890,
        };

        let encoded = SyncProtocol::encode_server(&msg).unwrap();
        let decoded = SyncProtocol::decode_server(&encoded).unwrap();

        match decoded {
            ServerMessage::Welcome {
                peer_id,
                color,
                session_token,
                ..
            } => {
                assert_eq!(peer_id, "peer-456");
                assert_eq!(color, "#ff5500");
                assert_eq!(session_token, "token-abc");
            }
            _ => panic!("Wrong message type"),
        }
    }

    #[test]
    fn test_encode_decode_sync_message() {
        let sync_data = vec![1, 2, 3, 4, 5, 6, 7, 8];
        let msg = ClientMessage::SyncMessage {
            project_id: "project-123".to_string(),
            sync_data: sync_data.clone(),
        };

        let encoded = SyncProtocol::encode_client(&msg).unwrap();
        let decoded = SyncProtocol::decode_client(&encoded).unwrap();

        match decoded {
            ClientMessage::SyncMessage {
                project_id,
                sync_data: data,
            } => {
                assert_eq!(project_id, "project-123");
                assert_eq!(data, sync_data);
            }
            _ => panic!("Wrong message type"),
        }
    }

    #[test]
    fn test_cursor_update() {
        let msg = ClientMessage::CursorUpdate {
            project_id: "proj".to_string(),
            file_path: "/src/main.rs".to_string(),
            line: 42,
            column: 10,
            selection_end: Some((42, 25)),
        };

        let encoded = SyncProtocol::encode_client(&msg).unwrap();
        let decoded = SyncProtocol::decode_client(&encoded).unwrap();

        match decoded {
            ClientMessage::CursorUpdate {
                line,
                column,
                selection_end,
                ..
            } => {
                assert_eq!(line, 42);
                assert_eq!(column, 10);
                assert_eq!(selection_end, Some((42, 25)));
            }
            _ => panic!("Wrong message type"),
        }
    }

    #[test]
    fn test_version_mismatch() {
        let mut data = SyncProtocol::encode_client(&ClientMessage::Ping { timestamp: 0 }).unwrap();
        // Corrupt version
        let mut bytes = data.to_vec();
        bytes[0] = 0xFF;

        let result = SyncProtocol::decode_client(&bytes);
        assert!(matches!(result, Err(ProtocolError::VersionMismatch(_, _))));
    }

    #[test]
    fn test_message_type_conversion() {
        assert_eq!(MessageType::try_from(0x01).unwrap(), MessageType::Hello);
        assert_eq!(MessageType::try_from(0x11).unwrap(), MessageType::SyncMessage);
        assert!(MessageType::try_from(0xFF).is_err());
    }
}
