//! SyncServer implementation for managing concurrent collaboration rooms.
//!
//! This module implements the core synchronization server using:
//! - DashMap for lock-free concurrent access to project rooms
//! - Automerge for CRDT-based document synchronization
//! - Per-peer state management for efficient updates
//!
//! The server handles race conditions through Automerge's CRDT semantics,
//! ensuring that concurrent edits from multiple users are automatically merged
//! without conflicts.

use dashmap::DashMap;
use parking_lot::{Mutex, RwLock};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, mpsc};
use tracing::{debug, error, info, warn};

use super::document::CollabDocument;
use super::presence::{Presence, PresenceManager};
use super::protocol::{PeerInfo, PresenceStatus, ServerMessage};
use super::{PeerId, ProjectId, SyncError, SyncResult};
use crate::storage::{DocumentMetadata, DocumentStore};

/// Configuration for the SyncServer
#[derive(Debug, Clone)]
pub struct SyncServerConfig {
    /// Maximum number of concurrent projects
    pub max_projects: usize,
    /// Maximum peers per project
    pub max_peers_per_project: usize,
    /// Document auto-save interval
    pub save_interval: Duration,
    /// Presence update interval
    pub presence_interval: Duration,
    /// Cleanup interval for stale data
    pub cleanup_interval: Duration,
    /// Session timeout
    pub session_timeout: Duration,
}

impl Default for SyncServerConfig {
    fn default() -> Self {
        Self {
            max_projects: 1000,
            max_peers_per_project: 50,
            save_interval: Duration::from_secs(5),
            presence_interval: Duration::from_millis(50),
            cleanup_interval: Duration::from_secs(60),
            session_timeout: Duration::from_secs(300),
        }
    }
}

/// A single peer connection with its sync state
pub struct PeerConnection {
    /// Unique peer identifier
    pub peer_id: PeerId,
    /// Display name
    pub name: String,
    /// Assigned color
    pub color: String,
    /// Session token for reconnection
    pub session_token: String,
    /// Channel to send messages to this peer
    tx: mpsc::UnboundedSender<ServerMessage>,
    /// Last activity timestamp
    last_active: Instant,
    /// Projects this peer has joined
    joined_projects: Vec<ProjectId>,
}

impl PeerConnection {
    pub fn new(
        peer_id: impl Into<String>,
        name: impl Into<String>,
        color: impl Into<String>,
        session_token: impl Into<String>,
        tx: mpsc::UnboundedSender<ServerMessage>,
    ) -> Self {
        Self {
            peer_id: peer_id.into(),
            name: name.into(),
            color: color.into(),
            session_token: session_token.into(),
            tx,
            last_active: Instant::now(),
            joined_projects: Vec::new(),
        }
    }

    /// Send a message to this peer
    pub fn send(&self, msg: ServerMessage) -> Result<(), SyncError> {
        self.tx
            .send(msg)
            .map_err(|_| SyncError::ConnectionError("Channel closed".to_string()))
    }

    /// Update last activity timestamp
    pub fn touch(&mut self) {
        self.last_active = Instant::now();
    }

    /// Check if the connection is stale
    pub fn is_stale(&self, timeout: Duration) -> bool {
        self.last_active.elapsed() > timeout
    }

    /// Join a project
    pub fn join_project(&mut self, project_id: &str) {
        if !self.joined_projects.contains(&project_id.to_string()) {
            self.joined_projects.push(project_id.to_string());
        }
    }

    /// Leave a project
    pub fn leave_project(&mut self, project_id: &str) {
        self.joined_projects.retain(|p| p != project_id);
    }
}

/// A collaborative project room containing the document and connected peers
struct ProjectRoom {
    /// Project identifier
    project_id: ProjectId,
    /// The collaborative document (protected by mutex for atomic operations)
    document: Mutex<CollabDocument>,
    /// Connected peers and their sync states
    peers: DashMap<PeerId, PeerSyncState>,
    /// Broadcast channel for project-wide messages
    broadcast_tx: broadcast::Sender<ServerMessage>,
    /// Creation timestamp
    created_at: Instant,
    /// Last activity timestamp
    last_active: RwLock<Instant>,
    /// Whether the document has unsaved changes
    dirty: RwLock<bool>,
}

/// Per-peer sync state within a project
struct PeerSyncState {
    /// Last known document version for this peer
    last_version: Mutex<u64>,
    /// Last sync timestamp
    last_sync: Instant,
}

impl ProjectRoom {
    fn new(project_id: impl Into<String>, document: CollabDocument) -> Self {
        let (broadcast_tx, _) = broadcast::channel(1024);
        Self {
            project_id: project_id.into(),
            document: Mutex::new(document),
            peers: DashMap::new(),
            broadcast_tx,
            created_at: Instant::now(),
            last_active: RwLock::new(Instant::now()),
            dirty: RwLock::new(false),
        }
    }

    /// Add a peer to the room
    fn add_peer(&self, peer_id: &str) {
        self.peers.insert(
            peer_id.to_string(),
            PeerSyncState {
                last_version: Mutex::new(0),
                last_sync: Instant::now(),
            },
        );
        *self.last_active.write() = Instant::now();
    }

    /// Remove a peer from the room
    fn remove_peer(&self, peer_id: &str) -> bool {
        self.peers.remove(peer_id).is_some()
    }

    /// Get the number of connected peers
    fn peer_count(&self) -> usize {
        self.peers.len()
    }

    /// Check if the room is empty
    fn is_empty(&self) -> bool {
        self.peers.is_empty()
    }

    /// Subscribe to broadcast messages
    fn subscribe(&self) -> broadcast::Receiver<ServerMessage> {
        self.broadcast_tx.subscribe()
    }

    /// Broadcast a message to all peers (via broadcast channel - requires subscribers)
    fn broadcast(&self, msg: ServerMessage) {
        let _ = self.broadcast_tx.send(msg);
    }

    /// Get all peer IDs in this room
    fn get_peer_ids(&self) -> Vec<PeerId> {
        self.peers.iter().map(|r| r.key().clone()).collect()
    }

    /// Mark the document as dirty (needs saving)
    fn mark_dirty(&self) {
        *self.dirty.write() = true;
        *self.last_active.write() = Instant::now();
    }

    /// Check and clear dirty flag
    fn take_dirty(&self) -> bool {
        let mut dirty = self.dirty.write();
        let was_dirty = *dirty;
        *dirty = false;
        was_dirty
    }

    /// Generate sync data for a peer (full document for now)
    fn generate_sync_data(&self, peer_id: &str) -> Option<Vec<u8>> {
        let _peer_state = self.peers.get(peer_id)?;
        let mut doc = self.document.lock();
        Some(doc.save())
    }

    /// Apply changes from a peer
    fn apply_changes(
        &self,
        peer_id: &str,
        change_data: &[u8],
    ) -> Result<Option<Vec<u8>>, SyncError> {
        let _peer_state = self
            .peers
            .get(peer_id)
            .ok_or_else(|| SyncError::PeerNotFound(peer_id.to_string()))?;

        // For now, we treat incoming data as incremental changes
        // In a full implementation, this would use Automerge's sync protocol
        let mut doc = self.document.lock();

        // Try to load and merge the changes
        if let Ok(mut other_doc) = CollabDocument::load(&self.project_id, change_data) {
            // Get changes from the other document
            let changes = other_doc.get_changes_since(&[]);
            doc.apply_changes(changes)
                .map_err(|e| SyncError::AutomergeError(e.to_string()))?;
        }

        self.mark_dirty();

        // Return updated document state
        Ok(Some(doc.save()))
    }

    /// Get full document state for initial sync
    fn get_document_state(&self) -> Vec<u8> {
        self.document.lock().save()
    }

    /// Get document for reading
    fn with_document<F, R>(&self, f: F) -> R
    where
        F: FnOnce(&CollabDocument) -> R,
    {
        let doc = self.document.lock();
        f(&doc)
    }

    /// Get document for mutation
    fn with_document_mut<F, R>(&self, f: F) -> R
    where
        F: FnOnce(&mut CollabDocument) -> R,
    {
        let mut doc = self.document.lock();
        let result = f(&mut doc);
        self.mark_dirty();
        result
    }
}

/// The main synchronization server
pub struct SyncServer {
    /// Server configuration
    config: SyncServerConfig,
    /// Active project rooms
    rooms: DashMap<ProjectId, Arc<ProjectRoom>>,
    /// Connected peers (global)
    peers: DashMap<PeerId, Arc<RwLock<PeerConnection>>>,
    /// Session token to peer ID mapping for reconnection
    sessions: DashMap<String, PeerId>,
    /// Presence manager
    presence: Arc<PresenceManager>,
    /// Persistent storage
    storage: Arc<DocumentStore>,
    /// Server start time
    started_at: Instant,
    /// Shutdown signal
    shutdown_tx: broadcast::Sender<()>,
}

impl SyncServer {
    /// Create a new sync server
    pub fn new(storage: DocumentStore, config: SyncServerConfig) -> Self {
        let (shutdown_tx, _) = broadcast::channel(1);
        Self {
            config,
            rooms: DashMap::new(),
            peers: DashMap::new(),
            sessions: DashMap::new(),
            presence: Arc::new(PresenceManager::new()),
            storage: Arc::new(storage),
            started_at: Instant::now(),
            shutdown_tx,
        }
    }

    /// Create with default configuration
    pub fn with_storage(storage: DocumentStore) -> Self {
        Self::new(storage, SyncServerConfig::default())
    }

    /// Get a shutdown receiver
    pub fn shutdown_receiver(&self) -> broadcast::Receiver<()> {
        self.shutdown_tx.subscribe()
    }

    /// Initiate graceful shutdown
    pub fn shutdown(&self) {
        let _ = self.shutdown_tx.send(());
    }

    /// Register a new peer connection
    pub fn register_peer(
        &self,
        peer_id: &str,
        name: &str,
        color: &str,
        session_token: &str,
        tx: mpsc::UnboundedSender<ServerMessage>,
    ) -> SyncResult<()> {
        let connection = PeerConnection::new(peer_id, name, color, session_token, tx);

        self.peers
            .insert(peer_id.to_string(), Arc::new(RwLock::new(connection)));
        self.sessions
            .insert(session_token.to_string(), peer_id.to_string());

        info!("Peer registered: {} ({})", name, peer_id);
        Ok(())
    }

    /// Unregister a peer connection
    pub fn unregister_peer(&self, peer_id: &str) {
        // Remove from all joined projects
        if let Some((_, peer)) = self.peers.remove(peer_id) {
            let peer = peer.read();

            // Remove session mapping
            self.sessions.remove(&peer.session_token);

            // Leave all projects
            for project_id in &peer.joined_projects {
                let _ = self.leave_project(peer_id, project_id);
            }

            info!("Peer unregistered: {} ({})", peer.name, peer_id);
        }
    }

    /// Try to restore a session by token
    pub fn restore_session(&self, session_token: &str) -> Option<PeerId> {
        self.sessions.get(session_token).map(|p| p.clone())
    }

    /// Get a peer connection
    pub fn get_peer(&self, peer_id: &str) -> Option<Arc<RwLock<PeerConnection>>> {
        self.peers.get(peer_id).map(|p| p.clone())
    }

    /// Join a project/room
    pub async fn join_project(
        &self,
        peer_id: &str,
        project_id: &str,
        request_state: bool,
    ) -> SyncResult<ServerMessage> {
        // Get or create the project room
        let room = self.get_or_create_room(project_id).await?;

        // Check peer limit
        if room.peer_count() >= self.config.max_peers_per_project {
            return Err(SyncError::Internal("Project is full".to_string()));
        }

        // Add peer to room
        room.add_peer(peer_id);

        // Update peer's joined projects
        if let Some(peer) = self.peers.get(peer_id) {
            peer.write().join_project(project_id);
        }

        // Add to presence
        if let Some(peer) = self.peers.get(peer_id) {
            let peer = peer.read();
            let presence = Presence::new(&peer.peer_id, &peer.name, &peer.color);
            let project_presence = self.presence.get_or_create(project_id);
            let _ = project_presence.add_peer(presence);
        }

        // Get list of other peers in the project
        let peers: Vec<PeerInfo> = self
            .presence
            .get(project_id)
            .map(|p| {
                p.get_all_peers()
                    .into_iter()
                    .filter(|presence| presence.peer_id != peer_id)
                    .map(|presence| PeerInfo {
                        peer_id: presence.peer_id,
                        name: presence.name,
                        color: presence.color,
                        status: match presence.status {
                            super::presence::PresenceStatus::Active => PresenceStatus::Active,
                            super::presence::PresenceStatus::Idle => PresenceStatus::Idle,
                            super::presence::PresenceStatus::Away => PresenceStatus::Away,
                            super::presence::PresenceStatus::Offline => PresenceStatus::Offline,
                        },
                        active_file: presence.active_file,
                        joined_at: presence.joined_at,
                    })
                    .collect()
            })
            .unwrap_or_default();

        // Get document state if requested
        let document_state = if request_state {
            Some(room.get_document_state())
        } else {
            None
        };

        // Broadcast peer joined to others
        if let Some(peer) = self.peers.get(peer_id) {
            let peer = peer.read();
            let peer_joined_msg = ServerMessage::PeerJoined {
                project_id: project_id.to_string(),
                peer: PeerInfo {
                    peer_id: peer.peer_id.clone(),
                    name: peer.name.clone(),
                    color: peer.color.clone(),
                    status: PresenceStatus::Active,
                    active_file: None,
                    joined_at: chrono::Utc::now().timestamp(),
                },
            };
            // Send to all other peers in the room directly
            self.broadcast_to_project(project_id, peer_id, peer_joined_msg);
        }

        info!("Peer {} joined project {}", peer_id, project_id);

        Ok(ServerMessage::ProjectJoined {
            project_id: project_id.to_string(),
            peers,
            document_state,
        })
    }

    /// Broadcast a message to all peers in a project (except the sender)
    pub fn broadcast_to_project(&self, project_id: &str, exclude_peer: &str, msg: ServerMessage) {
        if let Some(room) = self.rooms.get(project_id) {
            let peer_ids = room.get_peer_ids();
            for pid in peer_ids {
                if pid != exclude_peer {
                    if let Some(peer_conn) = self.peers.get(&pid) {
                        let _ = peer_conn.read().send(msg.clone());
                    }
                }
            }
        }
    }

    /// Leave a project/room
    pub fn leave_project(&self, peer_id: &str, project_id: &str) -> SyncResult<()> {
        if let Some(room) = self.rooms.get(project_id) {
            room.remove_peer(peer_id);

            // Update peer's joined projects
            if let Some(peer) = self.peers.get(peer_id) {
                peer.write().leave_project(project_id);
            }

            // Remove from presence
            if let Some(project_presence) = self.presence.get(project_id) {
                project_presence.remove_peer(peer_id);
            }

            // Broadcast peer left to remaining peers
            let peer_left_msg = ServerMessage::PeerLeft {
                project_id: project_id.to_string(),
                peer_id: peer_id.to_string(),
                reason: None,
            };
            self.broadcast_to_project(project_id, peer_id, peer_left_msg);

            // Clean up empty room after a delay
            if room.is_empty() {
                // Could schedule cleanup here
            }

            info!("Peer {} left project {}", peer_id, project_id);
        }

        Ok(())
    }

    /// Handle incoming sync message from a peer
    pub async fn handle_sync_message(
        &self,
        peer_id: &str,
        project_id: &str,
        sync_data: Vec<u8>,
    ) -> SyncResult<Option<Vec<u8>>> {
        let room = self
            .rooms
            .get(project_id)
            .ok_or_else(|| SyncError::DocumentNotFound(project_id.to_string()))?;

        // Update peer activity
        if let Some(peer) = self.peers.get(peer_id) {
            peer.write().touch();
        }

        // Process the sync message
        let response = room.apply_changes(peer_id, &sync_data)?;

        // Relay sync message to other peers
        let sync_msg = ServerMessage::SyncMessage {
            project_id: project_id.to_string(),
            sync_data,
            from_peer: Some(peer_id.to_string()),
        };
        self.broadcast_to_project(project_id, peer_id, sync_msg);

        Ok(response)
    }

    /// Generate sync data for a peer to bring them up to date
    pub fn generate_sync_for_peer(&self, peer_id: &str, project_id: &str) -> Option<Vec<u8>> {
        self.rooms
            .get(project_id)
            .and_then(|room| room.generate_sync_data(peer_id))
    }

    /// Get or create a project room
    async fn get_or_create_room(&self, project_id: &str) -> SyncResult<Arc<ProjectRoom>> {
        // Check if room already exists
        if let Some(room) = self.rooms.get(project_id) {
            return Ok(room.clone());
        }

        // Try to load from storage
        let document = if let Some(data) = self
            .storage
            .load_document(project_id)
            .map_err(|e| SyncError::StorageError(e.to_string()))?
        {
            info!("Loading document from storage: {}", project_id);
            CollabDocument::load(project_id, &data)
                .map_err(|e| SyncError::AutomergeError(e.to_string()))?
        } else {
            info!("Creating new document: {}", project_id);
            let doc = CollabDocument::new(project_id)
                .map_err(|e| SyncError::AutomergeError(e.to_string()))?;

            // Save metadata
            let metadata = DocumentMetadata::new(project_id, project_id);
            self.storage
                .save_metadata(&metadata)
                .map_err(|e| SyncError::StorageError(e.to_string()))?;

            doc
        };

        // Create the room
        let room = Arc::new(ProjectRoom::new(project_id, document));
        self.rooms.insert(project_id.to_string(), room.clone());

        Ok(room)
    }

    /// Save dirty documents to storage
    pub async fn save_dirty_documents(&self) -> usize {
        let mut saved = 0;

        for entry in self.rooms.iter() {
            let room = entry.value();
            if room.take_dirty() {
                let project_id = room.project_id.clone();
                let data = room.get_document_state();

                if let Err(e) = self.storage.save_document(&project_id, &data) {
                    error!("Failed to save document {}: {}", project_id, e);
                } else {
                    debug!("Saved document: {}", project_id);
                    saved += 1;
                }
            }
        }

        saved
    }

    /// Clean up empty rooms and stale connections
    pub fn cleanup(&self) {
        // Clean up stale peer connections
        let stale_peers: Vec<PeerId> = self
            .peers
            .iter()
            .filter(|entry| entry.read().is_stale(self.config.session_timeout))
            .map(|entry| entry.key().clone())
            .collect();

        for peer_id in stale_peers {
            warn!("Removing stale peer: {}", peer_id);
            self.unregister_peer(&peer_id);
        }

        // Clean up empty rooms (keeping them for a grace period)
        let empty_rooms: Vec<ProjectId> = self
            .rooms
            .iter()
            .filter(|entry| {
                let room = entry.value();
                room.is_empty() && room.created_at.elapsed() > Duration::from_secs(300)
            })
            .map(|entry| entry.key().clone())
            .collect();

        for project_id in empty_rooms {
            // Save before removing
            if let Some((_, room)) = self.rooms.remove(&project_id) {
                if room.take_dirty() {
                    let data = room.get_document_state();
                    let _ = self.storage.save_document(&project_id, &data);
                }
                info!("Removed empty room: {}", project_id);
            }
        }

        // Update presence statuses
        self.presence.update_all_statuses();
        self.presence.cleanup_all();
    }

    /// Get server statistics
    pub fn stats(&self) -> ServerStats {
        ServerStats {
            active_projects: self.rooms.len(),
            active_peers: self.peers.len(),
            total_peers_in_projects: self.rooms.iter().map(|r| r.peer_count()).sum(),
            uptime_seconds: self.started_at.elapsed().as_secs(),
        }
    }

    /// Get presence manager
    pub fn presence(&self) -> &Arc<PresenceManager> {
        &self.presence
    }

    /// Get storage
    pub fn storage(&self) -> &Arc<DocumentStore> {
        &self.storage
    }

    /// Start background tasks (save loop, cleanup loop)
    pub fn start_background_tasks(self: Arc<Self>) -> BackgroundTaskHandles {
        let server = self.clone();
        let save_interval = server.config.save_interval;

        // Save task
        let save_handle = tokio::spawn(async move {
            let mut interval = tokio::time::interval(save_interval);
            let mut shutdown = server.shutdown_receiver();

            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        let saved = server.save_dirty_documents().await;
                        if saved > 0 {
                            debug!("Auto-saved {} documents", saved);
                        }
                    }
                    _ = shutdown.recv() => {
                        info!("Save task shutting down");
                        // Final save
                        server.save_dirty_documents().await;
                        break;
                    }
                }
            }
        });

        let server = self.clone();
        let cleanup_interval = server.config.cleanup_interval;

        // Cleanup task
        let cleanup_handle = tokio::spawn(async move {
            let mut interval = tokio::time::interval(cleanup_interval);
            let mut shutdown = server.shutdown_receiver();

            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        server.cleanup();
                    }
                    _ = shutdown.recv() => {
                        info!("Cleanup task shutting down");
                        break;
                    }
                }
            }
        });

        BackgroundTaskHandles {
            save_task: save_handle,
            cleanup_task: cleanup_handle,
        }
    }
}

/// Server statistics
#[derive(Debug, Clone)]
pub struct ServerStats {
    pub active_projects: usize,
    pub active_peers: usize,
    pub total_peers_in_projects: usize,
    pub uptime_seconds: u64,
}

/// Handles for background tasks
pub struct BackgroundTaskHandles {
    pub save_task: tokio::task::JoinHandle<()>,
    pub cleanup_task: tokio::task::JoinHandle<()>,
}

impl BackgroundTaskHandles {
    /// Wait for all tasks to complete
    pub async fn wait(self) {
        let _ = tokio::join!(self.save_task, self.cleanup_task);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn test_storage() -> DocumentStore {
        let dir = tempdir().unwrap();
        let config = crate::storage::StorageConfig::new(
            dir.path().join("test.sled").to_string_lossy().to_string(),
        );
        DocumentStore::open(config).unwrap()
    }

    #[tokio::test]
    async fn test_server_creation() {
        let storage = test_storage();
        let server = SyncServer::with_storage(storage);

        assert_eq!(server.stats().active_projects, 0);
        assert_eq!(server.stats().active_peers, 0);
    }

    #[tokio::test]
    async fn test_peer_registration() {
        let storage = test_storage();
        let server = SyncServer::with_storage(storage);

        let (tx, _rx) = mpsc::unbounded_channel();
        server
            .register_peer("peer-1", "Alice", "#ff0000", "token-123", tx)
            .unwrap();

        assert_eq!(server.stats().active_peers, 1);
        assert!(server.get_peer("peer-1").is_some());
    }

    #[tokio::test]
    async fn test_join_project() {
        let storage = test_storage();
        let server = SyncServer::with_storage(storage);

        let (tx, _rx) = mpsc::unbounded_channel();
        server
            .register_peer("peer-1", "Alice", "#ff0000", "token-123", tx)
            .unwrap();

        let result = server.join_project("peer-1", "project-1", true).await;
        assert!(result.is_ok());

        assert_eq!(server.stats().active_projects, 1);
    }

    #[tokio::test]
    async fn test_multiple_peers_join() {
        let storage = test_storage();
        let server = SyncServer::with_storage(storage);

        let (tx1, _rx1) = mpsc::unbounded_channel();
        let (tx2, _rx2) = mpsc::unbounded_channel();

        server
            .register_peer("peer-1", "Alice", "#ff0000", "token-1", tx1)
            .unwrap();
        server
            .register_peer("peer-2", "Bob", "#00ff00", "token-2", tx2)
            .unwrap();

        server.join_project("peer-1", "project-1", true).await.unwrap();
        let result = server.join_project("peer-2", "project-1", false).await.unwrap();

        // Second peer should see first peer in the list
        if let ServerMessage::ProjectJoined { peers, .. } = result {
            assert_eq!(peers.len(), 1);
            assert_eq!(peers[0].name, "Alice");
        } else {
            panic!("Expected ProjectJoined message");
        }
    }

    #[tokio::test]
    async fn test_leave_project() {
        let storage = test_storage();
        let server = SyncServer::with_storage(storage);

        let (tx, _rx) = mpsc::unbounded_channel();
        server
            .register_peer("peer-1", "Alice", "#ff0000", "token-123", tx)
            .unwrap();

        server.join_project("peer-1", "project-1", true).await.unwrap();
        server.leave_project("peer-1", "project-1").unwrap();

        // Room still exists but peer is gone
        let peer = server.get_peer("peer-1").unwrap();
        assert!(peer.read().joined_projects.is_empty());
    }

    #[tokio::test]
    async fn test_session_restore() {
        let storage = test_storage();
        let server = SyncServer::with_storage(storage);

        let (tx, _rx) = mpsc::unbounded_channel();
        server
            .register_peer("peer-1", "Alice", "#ff0000", "secret-token", tx)
            .unwrap();

        let restored = server.restore_session("secret-token");
        assert_eq!(restored, Some("peer-1".to_string()));

        let not_found = server.restore_session("wrong-token");
        assert!(not_found.is_none());
    }

    #[tokio::test]
    async fn test_unregister_peer() {
        let storage = test_storage();
        let server = SyncServer::with_storage(storage);

        let (tx, _rx) = mpsc::unbounded_channel();
        server
            .register_peer("peer-1", "Alice", "#ff0000", "token-123", tx)
            .unwrap();

        server.join_project("peer-1", "project-1", true).await.unwrap();
        server.unregister_peer("peer-1");

        assert!(server.get_peer("peer-1").is_none());
        assert!(server.restore_session("token-123").is_none());
    }
}
