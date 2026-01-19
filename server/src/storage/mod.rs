//! Storage module for persistent Automerge document storage using Sled.
//!
//! This module provides a high-performance embedded database layer for storing
//! binary Automerge document snapshots. Documents are stored as raw bytes,
//! enabling fast serialization and deserialization without intermediate formats.

mod sled_store;

pub use sled_store::DocumentStore;

use serde::{Deserialize, Serialize};

/// Metadata stored alongside document snapshots
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentMetadata {
    /// Unique project/document identifier
    pub project_id: String,
    /// Human-readable name
    pub name: String,
    /// Unix timestamp of creation
    pub created_at: i64,
    /// Unix timestamp of last modification
    pub updated_at: i64,
    /// Number of changes in the document
    pub change_count: u64,
    /// Size of the document in bytes
    pub size_bytes: u64,
    /// Owner/creator user ID
    pub owner_id: Option<String>,
}

impl DocumentMetadata {
    pub fn new(project_id: impl Into<String>, name: impl Into<String>) -> Self {
        let now = chrono::Utc::now().timestamp();
        Self {
            project_id: project_id.into(),
            name: name.into(),
            created_at: now,
            updated_at: now,
            change_count: 0,
            size_bytes: 0,
            owner_id: None,
        }
    }

    pub fn with_owner(mut self, owner_id: impl Into<String>) -> Self {
        self.owner_id = Some(owner_id.into());
        self
    }
}

/// Incremental change record for efficient sync
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangeRecord {
    /// Sequence number for ordering
    pub seq: u64,
    /// Binary change data from Automerge
    pub data: Vec<u8>,
    /// Timestamp when the change was recorded
    pub timestamp: i64,
    /// User who made the change (if known)
    pub actor_id: Option<String>,
}

/// Configuration for the storage layer
#[derive(Debug, Clone)]
pub struct StorageConfig {
    /// Path to the Sled database directory
    pub path: String,
    /// Whether to use compression for stored documents
    pub compression: bool,
    /// Cache size in bytes (default: 1GB)
    pub cache_size: u64,
    /// Flush interval in milliseconds (0 = immediate)
    pub flush_interval_ms: u64,
}

impl Default for StorageConfig {
    fn default() -> Self {
        Self {
            path: "./data/collab.sled".to_string(),
            compression: true,
            cache_size: 1024 * 1024 * 1024, // 1GB
            flush_interval_ms: 500,
        }
    }
}

impl StorageConfig {
    pub fn new(path: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            ..Default::default()
        }
    }

    pub fn with_cache_size(mut self, size: u64) -> Self {
        self.cache_size = size;
        self
    }

    pub fn with_compression(mut self, enabled: bool) -> Self {
        self.compression = enabled;
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_metadata_creation() {
        let meta = DocumentMetadata::new("project-123", "My Project")
            .with_owner("user-456");

        assert_eq!(meta.project_id, "project-123");
        assert_eq!(meta.name, "My Project");
        assert_eq!(meta.owner_id, Some("user-456".to_string()));
        assert!(meta.created_at > 0);
    }

    #[test]
    fn test_storage_config_default() {
        let config = StorageConfig::default();
        assert!(config.compression);
        assert_eq!(config.cache_size, 1024 * 1024 * 1024);
    }
}
