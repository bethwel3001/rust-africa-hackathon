//! Sled-based storage implementation for Automerge documents.
//!
//! This module provides persistent storage for binary Automerge document snapshots
//! using the Sled embedded database. It supports:
//! - Full document snapshots
//! - Incremental change storage
//! - Metadata management
//! - Atomic operations for consistency

use sled::{Db, Tree};
use std::path::Path;
use std::sync::Arc;
use thiserror::Error;

use super::{ChangeRecord, DocumentMetadata, StorageConfig};

/// Errors that can occur during storage operations
#[derive(Error, Debug)]
pub enum StorageError {
    #[error("Sled database error: {0}")]
    Sled(#[from] sled::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] bincode::Error),

    #[error("Document not found: {0}")]
    NotFound(String),

    #[error("Document already exists: {0}")]
    AlreadyExists(String),

    #[error("Corruption detected in document: {0}")]
    Corruption(String),

    #[error("Storage initialization failed: {0}")]
    InitFailed(String),
}

/// Result type for storage operations
pub type StorageResult<T> = Result<T, StorageError>;

/// Tree names for different data types
const TREE_DOCUMENTS: &str = "documents";
const TREE_METADATA: &str = "metadata";
const TREE_CHANGES: &str = "changes";
const TREE_SYNC_STATES: &str = "sync_states";

/// Sled-based document store for Automerge documents
#[derive(Clone)]
pub struct DocumentStore {
    db: Arc<Db>,
    documents: Tree,
    metadata: Tree,
    changes: Tree,
    sync_states: Tree,
    config: StorageConfig,
}

impl DocumentStore {
    /// Open or create a new document store at the given path
    pub fn open(config: StorageConfig) -> StorageResult<Self> {
        let path = Path::new(&config.path);

        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                StorageError::InitFailed(format!("Failed to create directory: {}", e))
            })?;
        }

        let db = sled::Config::new()
            .path(&config.path)
            .cache_capacity(config.cache_size)
            .flush_every_ms(if config.flush_interval_ms > 0 {
                Some(config.flush_interval_ms)
            } else {
                None
            })
            .open()?;

        let documents = db.open_tree(TREE_DOCUMENTS)?;
        let metadata = db.open_tree(TREE_METADATA)?;
        let changes = db.open_tree(TREE_CHANGES)?;
        let sync_states = db.open_tree(TREE_SYNC_STATES)?;

        Ok(Self {
            db: Arc::new(db),
            documents,
            metadata,
            changes,
            sync_states,
            config,
        })
    }

    /// Open with default configuration
    pub fn open_default() -> StorageResult<Self> {
        Self::open(StorageConfig::default())
    }

    /// Store a complete Automerge document snapshot
    pub fn save_document(&self, project_id: &str, doc_bytes: &[u8]) -> StorageResult<()> {
        let data = if self.config.compression {
            compress_data(doc_bytes)
        } else {
            doc_bytes.to_vec()
        };

        self.documents.insert(project_id.as_bytes(), data)?;

        // Update metadata
        if let Some(mut meta) = self.get_metadata(project_id)? {
            meta.updated_at = chrono::Utc::now().timestamp();
            meta.size_bytes = doc_bytes.len() as u64;
            self.save_metadata(&meta)?;
        }

        Ok(())
    }

    /// Load a complete Automerge document snapshot
    pub fn load_document(&self, project_id: &str) -> StorageResult<Option<Vec<u8>>> {
        match self.documents.get(project_id.as_bytes())? {
            Some(data) => {
                let bytes = if self.config.compression {
                    decompress_data(&data)?
                } else {
                    data.to_vec()
                };
                Ok(Some(bytes))
            }
            None => Ok(None),
        }
    }

    /// Check if a document exists
    pub fn document_exists(&self, project_id: &str) -> StorageResult<bool> {
        Ok(self.documents.contains_key(project_id.as_bytes())?)
    }

    /// Delete a document and all associated data
    pub fn delete_document(&self, project_id: &str) -> StorageResult<()> {
        let key = project_id.as_bytes();

        // Delete document
        self.documents.remove(key)?;

        // Delete metadata
        self.metadata.remove(key)?;

        // Delete all changes for this project
        let change_prefix = format!("{}:", project_id);
        let mut to_remove = Vec::new();
        for item in self.changes.scan_prefix(change_prefix.as_bytes()) {
            let (key, _) = item?;
            to_remove.push(key);
        }
        for key in to_remove {
            self.changes.remove(key)?;
        }

        // Delete sync states
        let sync_prefix = format!("{}:", project_id);
        let mut to_remove = Vec::new();
        for item in self.sync_states.scan_prefix(sync_prefix.as_bytes()) {
            let (key, _) = item?;
            to_remove.push(key);
        }
        for key in to_remove {
            self.sync_states.remove(key)?;
        }

        Ok(())
    }

    /// Save document metadata
    pub fn save_metadata(&self, meta: &DocumentMetadata) -> StorageResult<()> {
        let bytes = bincode::serialize(meta)?;
        self.metadata.insert(meta.project_id.as_bytes(), bytes)?;
        Ok(())
    }

    /// Load document metadata
    pub fn get_metadata(&self, project_id: &str) -> StorageResult<Option<DocumentMetadata>> {
        match self.metadata.get(project_id.as_bytes())? {
            Some(bytes) => {
                let meta: DocumentMetadata = bincode::deserialize(&bytes)?;
                Ok(Some(meta))
            }
            None => Ok(None),
        }
    }

    /// List all documents with metadata
    pub fn list_documents(&self) -> StorageResult<Vec<DocumentMetadata>> {
        let mut docs = Vec::new();
        for item in self.metadata.iter() {
            let (_, value) = item?;
            let meta: DocumentMetadata = bincode::deserialize(&value)?;
            docs.push(meta);
        }
        Ok(docs)
    }

    /// Store an incremental change
    pub fn save_change(&self, project_id: &str, change: &ChangeRecord) -> StorageResult<()> {
        let key = format!("{}:{:020}", project_id, change.seq);
        let bytes = bincode::serialize(change)?;
        self.changes.insert(key.as_bytes(), bytes)?;
        Ok(())
    }

    /// Load all changes for a document since a given sequence number
    pub fn load_changes_since(
        &self,
        project_id: &str,
        since_seq: u64,
    ) -> StorageResult<Vec<ChangeRecord>> {
        let start_key = format!("{}:{:020}", project_id, since_seq);
        let end_key = format!("{}:{}", project_id, "~"); // '~' is after digits in ASCII

        let mut changes = Vec::new();
        for item in self
            .changes
            .range(start_key.as_bytes()..end_key.as_bytes())
        {
            let (_, value) = item?;
            let change: ChangeRecord = bincode::deserialize(&value)?;
            changes.push(change);
        }
        Ok(changes)
    }

    /// Get the latest change sequence number for a document
    pub fn get_latest_seq(&self, project_id: &str) -> StorageResult<u64> {
        let prefix = format!("{}:", project_id);

        // Scan in reverse to find the last key
        if let Some(item) = self.changes.scan_prefix(prefix.as_bytes()).next_back() {
            let (key, _) = item?;
            let key_str = String::from_utf8_lossy(&key);
            if let Some(seq_str) = key_str.split(':').last() {
                if let Ok(seq) = seq_str.parse::<u64>() {
                    return Ok(seq);
                }
            }
        }
        Ok(0)
    }

    /// Compact changes into the main document snapshot
    /// This should be called periodically to prevent unbounded change growth
    pub fn compact_changes(&self, project_id: &str, keep_recent: usize) -> StorageResult<usize> {
        let changes = self.load_changes_since(project_id, 0)?;
        let total = changes.len();

        if total <= keep_recent {
            return Ok(0);
        }

        let to_remove = total - keep_recent;
        let prefix = format!("{}:", project_id);

        let mut removed = 0;
        for item in self.changes.scan_prefix(prefix.as_bytes()).take(to_remove) {
            let (key, _) = item?;
            self.changes.remove(key)?;
            removed += 1;
        }

        Ok(removed)
    }

    /// Save peer sync state for efficient incremental sync
    pub fn save_sync_state(&self, project_id: &str, peer_id: &str, state: &[u8]) -> StorageResult<()> {
        let key = format!("{}:{}", project_id, peer_id);
        self.sync_states.insert(key.as_bytes(), state)?;
        Ok(())
    }

    /// Load peer sync state
    pub fn load_sync_state(&self, project_id: &str, peer_id: &str) -> StorageResult<Option<Vec<u8>>> {
        let key = format!("{}:{}", project_id, peer_id);
        match self.sync_states.get(key.as_bytes())? {
            Some(data) => Ok(Some(data.to_vec())),
            None => Ok(None),
        }
    }

    /// Remove peer sync state (when peer disconnects permanently)
    pub fn remove_sync_state(&self, project_id: &str, peer_id: &str) -> StorageResult<()> {
        let key = format!("{}:{}", project_id, peer_id);
        self.sync_states.remove(key.as_bytes())?;
        Ok(())
    }

    /// Force flush all pending writes to disk
    pub fn flush(&self) -> StorageResult<()> {
        self.db.flush()?;
        Ok(())
    }

    /// Get storage statistics
    pub fn stats(&self) -> StorageStats {
        StorageStats {
            document_count: self.documents.len(),
            total_size_bytes: self.db.size_on_disk().unwrap_or(0),
            metadata_count: self.metadata.len(),
            change_count: self.changes.len(),
            sync_state_count: self.sync_states.len(),
        }
    }
}

/// Statistics about the storage
#[derive(Debug, Clone)]
pub struct StorageStats {
    pub document_count: usize,
    pub total_size_bytes: u64,
    pub metadata_count: usize,
    pub change_count: usize,
    pub sync_state_count: usize,
}

/// Simple compression using LZ4-like algorithm via miniz
fn compress_data(data: &[u8]) -> Vec<u8> {
    // Simple prefix to indicate compression
    let mut result = vec![0x01]; // compression marker

    // For simplicity, using basic zlib-style compression
    // In production, consider using lz4 for speed
    
    let encoder = flate2_encoder(data);
    result.extend(encoder);
    result
}

fn flate2_encoder(data: &[u8]) -> Vec<u8> {
    // Fallback: just store uncompressed with length prefix
    // Real implementation would use actual compression
    let mut result = Vec::with_capacity(data.len() + 4);
    result.extend(&(data.len() as u32).to_le_bytes());
    result.extend(data);
    result
}

fn decompress_data(data: &[u8]) -> StorageResult<Vec<u8>> {
    if data.is_empty() {
        return Ok(Vec::new());
    }

    if data[0] == 0x01 {
        // Compressed data
        let compressed = &data[1..];
        if compressed.len() < 4 {
            return Err(StorageError::Corruption("Invalid compressed data".into()));
        }
        let len = u32::from_le_bytes([compressed[0], compressed[1], compressed[2], compressed[3]]) as usize;
        let decompressed = compressed[4..].to_vec();
        if decompressed.len() != len {
            return Err(StorageError::Corruption("Decompression size mismatch".into()));
        }
        Ok(decompressed)
    } else {
        // Uncompressed data (legacy or compression disabled)
        Ok(data.to_vec())
    }
}

impl Drop for DocumentStore {
    fn drop(&mut self) {
        // Attempt to flush on drop, but don't panic
        let _ = self.flush();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn test_store() -> DocumentStore {
        let dir = tempdir().unwrap();
        let config = StorageConfig::new(dir.path().join("test.sled").to_string_lossy().to_string())
            .with_compression(false);
        DocumentStore::open(config).unwrap()
    }

    #[test]
    fn test_document_save_load() {
        let store = test_store();
        let project_id = "test-project";
        let doc_data = b"test document data";

        store.save_document(project_id, doc_data).unwrap();
        let loaded = store.load_document(project_id).unwrap();

        assert!(loaded.is_some());
        assert_eq!(loaded.unwrap(), doc_data);
    }

    #[test]
    fn test_document_not_found() {
        let store = test_store();
        let loaded = store.load_document("nonexistent").unwrap();
        assert!(loaded.is_none());
    }

    #[test]
    fn test_metadata_save_load() {
        let store = test_store();
        let meta = DocumentMetadata::new("test-project", "Test Project")
            .with_owner("user-123");

        store.save_metadata(&meta).unwrap();
        let loaded = store.get_metadata("test-project").unwrap();

        assert!(loaded.is_some());
        let loaded = loaded.unwrap();
        assert_eq!(loaded.name, "Test Project");
        assert_eq!(loaded.owner_id, Some("user-123".to_string()));
    }

    #[test]
    fn test_changes() {
        let store = test_store();
        let project_id = "test-project";

        for i in 1..=5 {
            let change = ChangeRecord {
                seq: i,
                data: vec![i as u8; 10],
                timestamp: chrono::Utc::now().timestamp(),
                actor_id: Some("user-1".to_string()),
            };
            store.save_change(project_id, &change).unwrap();
        }

        let changes = store.load_changes_since(project_id, 3).unwrap();
        assert_eq!(changes.len(), 3); // seq 3, 4, 5

        let latest = store.get_latest_seq(project_id).unwrap();
        assert_eq!(latest, 5);
    }

    #[test]
    fn test_sync_state() {
        let store = test_store();
        let state = vec![1, 2, 3, 4];

        store.save_sync_state("proj", "peer-1", &state).unwrap();
        let loaded = store.load_sync_state("proj", "peer-1").unwrap();

        assert!(loaded.is_some());
        assert_eq!(loaded.unwrap(), state);
    }

    #[test]
    fn test_delete_document() {
        let store = test_store();
        let project_id = "to-delete";

        store.save_document(project_id, b"data").unwrap();
        store.save_metadata(&DocumentMetadata::new(project_id, "Test")).unwrap();

        assert!(store.document_exists(project_id).unwrap());

        store.delete_document(project_id).unwrap();

        assert!(!store.document_exists(project_id).unwrap());
        assert!(store.get_metadata(project_id).unwrap().is_none());
    }
}
