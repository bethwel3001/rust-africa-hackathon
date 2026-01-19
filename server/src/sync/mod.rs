//! Synchronization module for CRDT-based real-time collaboration.
//!
//! This module implements the core synchronization logic using Automerge CRDTs.
//! It provides:
//! - Binary WebSocket protocol for efficient sync
//! - Per-peer sync state management
//! - Document management with concurrent access
//! - Presence and cursor synchronization

pub mod document;
pub mod presence;
pub mod protocol;
pub mod server;

pub use document::CollabDocument;
pub use server::{SyncServer, SyncServerConfig};

use serde::{Deserialize, Serialize};

/// Unique identifier for a project/document
pub type ProjectId = String;

/// Unique identifier for a peer/user
pub type PeerId = String;

/// Unique identifier for a file within a project
pub type FileId = String;

/// Actor ID for Automerge (derived from PeerId)
pub type ActorId = String;

/// Result type for sync operations
pub type SyncResult<T> = Result<T, SyncError>;

/// Errors that can occur during synchronization
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SyncError {
    /// Document not found
    DocumentNotFound(ProjectId),
    /// Peer not found in session
    PeerNotFound(PeerId),
    /// Invalid sync message
    InvalidMessage(String),
    /// Automerge operation failed
    AutomergeError(String),
    /// Storage operation failed
    StorageError(String),
    /// Connection error
    ConnectionError(String),
    /// Authorization error
    Unauthorized(String),
    /// Rate limited
    RateLimited,
    /// Internal server error
    Internal(String),
}

impl std::fmt::Display for SyncError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SyncError::DocumentNotFound(id) => write!(f, "Document not found: {}", id),
            SyncError::PeerNotFound(id) => write!(f, "Peer not found: {}", id),
            SyncError::InvalidMessage(msg) => write!(f, "Invalid message: {}", msg),
            SyncError::AutomergeError(msg) => write!(f, "Automerge error: {}", msg),
            SyncError::StorageError(msg) => write!(f, "Storage error: {}", msg),
            SyncError::ConnectionError(msg) => write!(f, "Connection error: {}", msg),
            SyncError::Unauthorized(msg) => write!(f, "Unauthorized: {}", msg),
            SyncError::RateLimited => write!(f, "Rate limited"),
            SyncError::Internal(msg) => write!(f, "Internal error: {}", msg),
        }
    }
}

impl std::error::Error for SyncError {}

impl From<automerge::AutomergeError> for SyncError {
    fn from(err: automerge::AutomergeError) -> Self {
        SyncError::AutomergeError(err.to_string())
    }
}

/// Configuration for sync behavior
#[derive(Debug, Clone)]
pub struct SyncConfig {
    /// Maximum document size in bytes
    pub max_document_size: usize,
    /// Maximum number of concurrent peers per document
    pub max_peers_per_document: usize,
    /// Sync message batch size
    pub sync_batch_size: usize,
    /// Presence broadcast interval in milliseconds
    pub presence_interval_ms: u64,
    /// Document save interval in milliseconds
    pub save_interval_ms: u64,
    /// Enable compression for sync messages
    pub compression_enabled: bool,
}

impl Default for SyncConfig {
    fn default() -> Self {
        Self {
            max_document_size: 100 * 1024 * 1024, // 100MB
            max_peers_per_document: 50,
            sync_batch_size: 100,
            presence_interval_ms: 50, // 20 FPS for cursor updates
            save_interval_ms: 1000,   // Save every second
            compression_enabled: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sync_error_display() {
        let err = SyncError::DocumentNotFound("test-123".to_string());
        assert_eq!(err.to_string(), "Document not found: test-123");
    }

    #[test]
    fn test_sync_config_default() {
        let config = SyncConfig::default();
        assert_eq!(config.max_peers_per_document, 50);
        assert!(config.compression_enabled);
    }
}
