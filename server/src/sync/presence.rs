//! Presence and cursor management for real-time collaboration.
//!
//! This module handles ephemeral state that doesn't need to be persisted in the CRDT:
//! - User presence (online/idle/away status)
//! - Cursor positions with Automerge cursor stability
//! - Active file tracking
//! - Typing indicators

use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::broadcast;

use super::{PeerId, ProjectId};

/// How long before a peer is considered idle (no activity)
const IDLE_TIMEOUT: Duration = Duration::from_secs(60);

/// How long before a peer is considered away
const AWAY_TIMEOUT: Duration = Duration::from_secs(300);

/// How long to keep cursor data after peer disconnects
const CURSOR_RETENTION: Duration = Duration::from_secs(5);

/// Cursor position in a file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cursor {
    /// File path the cursor is in
    pub file_path: String,
    /// Line number (1-based)
    pub line: u32,
    /// Column number (1-based)
    pub column: u32,
    /// Selection end position (if selecting)
    pub selection_end: Option<(u32, u32)>,
    /// Automerge cursor for stable positioning (serialized)
    pub stable_cursor: Option<Vec<u8>>,
    /// Timestamp of last update (milliseconds since epoch)
    #[serde(default = "default_timestamp")]
    pub updated_at_ms: i64,
    /// Runtime-only instant (not serialized)
    #[serde(skip)]
    updated_instant: Option<Instant>,
}

fn default_timestamp() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

impl Cursor {
    pub fn new(file_path: impl Into<String>, line: u32, column: u32) -> Self {
        Self {
            file_path: file_path.into(),
            line,
            column,
            selection_end: None,
            stable_cursor: None,
            updated_at_ms: chrono::Utc::now().timestamp_millis(),
            updated_instant: Some(Instant::now()),
        }
    }

    pub fn with_selection(mut self, end_line: u32, end_column: u32) -> Self {
        self.selection_end = Some((end_line, end_column));
        self
    }

    pub fn with_stable_cursor(mut self, cursor: Vec<u8>) -> Self {
        self.stable_cursor = Some(cursor);
        self
    }

    /// Get the update instant (for runtime use)
    pub fn updated_at(&self) -> Instant {
        self.updated_instant.unwrap_or_else(Instant::now)
    }

    /// Check if this cursor has a text selection
    pub fn has_selection(&self) -> bool {
        self.selection_end.is_some()
    }

    /// Get the selection range if present
    pub fn selection_range(&self) -> Option<((u32, u32), (u32, u32))> {
        self.selection_end.map(|end| ((self.line, self.column), end))
    }
}

/// Presence status for a peer
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PresenceStatus {
    /// Actively editing
    Active,
    /// No recent activity
    Idle,
    /// Extended inactivity
    Away,
    /// Disconnected but cursor still visible
    Offline,
}

impl Default for PresenceStatus {
    fn default() -> Self {
        Self::Active
    }
}

/// Complete presence information for a peer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Presence {
    /// Peer identifier
    pub peer_id: PeerId,
    /// Display name
    pub name: String,
    /// Assigned color (hex)
    pub color: String,
    /// Current status
    pub status: PresenceStatus,
    /// Currently active file (if any)
    pub active_file: Option<String>,
    /// Current cursor position
    pub cursor: Option<Cursor>,
    /// When the peer joined
    pub joined_at: i64,
    /// Last activity timestamp (milliseconds since epoch)
    pub last_active_ms: i64,
    /// Is the peer typing
    pub is_typing: bool,
    /// Files currently open by this peer
    pub open_files: Vec<String>,
    /// Runtime-only last activity instant (not serialized)
    #[serde(skip)]
    last_active_instant: Option<Instant>,
}

impl Presence {
    pub fn new(peer_id: impl Into<String>, name: impl Into<String>, color: impl Into<String>) -> Self {
        let now = chrono::Utc::now();
        Self {
            peer_id: peer_id.into(),
            name: name.into(),
            color: color.into(),
            status: PresenceStatus::Active,
            active_file: None,
            cursor: None,
            joined_at: now.timestamp(),
            last_active_ms: now.timestamp_millis(),
            is_typing: false,
            open_files: Vec::new(),
            last_active_instant: Some(Instant::now()),
        }
    }

    /// Update the last activity timestamp and set status to active
    pub fn touch(&mut self) {
        self.last_active_ms = chrono::Utc::now().timestamp_millis();
        self.last_active_instant = Some(Instant::now());
        self.status = PresenceStatus::Active;
    }

    /// Get the last active instant (for runtime use)
    pub fn last_active(&self) -> Instant {
        self.last_active_instant.unwrap_or_else(Instant::now)
    }

    /// Update status based on inactivity
    pub fn update_status(&mut self) {
        if self.status == PresenceStatus::Offline {
            return;
        }

        let elapsed = self.last_active().elapsed();
        if elapsed > AWAY_TIMEOUT {
            self.status = PresenceStatus::Away;
        } else if elapsed > IDLE_TIMEOUT {
            self.status = PresenceStatus::Idle;
        }
    }

    /// Set cursor position
    pub fn set_cursor(&mut self, cursor: Cursor) {
        self.active_file = Some(cursor.file_path.clone());
        self.cursor = Some(cursor);
        self.touch();
    }

    /// Clear cursor
    pub fn clear_cursor(&mut self) {
        self.cursor = None;
    }

    /// Mark as typing
    pub fn set_typing(&mut self, typing: bool) {
        self.is_typing = typing;
        if typing {
            self.touch();
        }
    }

    /// Add an open file
    pub fn open_file(&mut self, path: impl Into<String>) {
        let path = path.into();
        if !self.open_files.contains(&path) {
            self.open_files.push(path);
        }
        self.touch();
    }

    /// Remove a closed file
    pub fn close_file(&mut self, path: &str) {
        self.open_files.retain(|p| p != path);
        if self.active_file.as_deref() == Some(path) {
            self.active_file = self.open_files.first().cloned();
        }
    }
}

/// Event types for presence changes
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PresenceEvent {
    /// Peer joined the project
    Joined {
        project_id: ProjectId,
        presence: Presence,
    },
    /// Peer left the project
    Left {
        project_id: ProjectId,
        peer_id: PeerId,
    },
    /// Cursor position updated
    CursorMoved {
        project_id: ProjectId,
        peer_id: PeerId,
        cursor: Cursor,
    },
    /// Presence status changed
    StatusChanged {
        project_id: ProjectId,
        peer_id: PeerId,
        status: PresenceStatus,
        active_file: Option<String>,
    },
    /// Typing indicator changed
    TypingChanged {
        project_id: ProjectId,
        peer_id: PeerId,
        is_typing: bool,
    },
}

/// Manager for presence state within a project
#[derive(Debug)]
pub struct ProjectPresence {
    /// Project identifier
    project_id: ProjectId,
    /// Map of peer_id -> Presence
    peers: DashMap<PeerId, Presence>,
    /// Broadcast channel for presence events
    event_tx: broadcast::Sender<PresenceEvent>,
}

impl ProjectPresence {
    pub fn new(project_id: impl Into<String>) -> Self {
        let (event_tx, _) = broadcast::channel(256);
        Self {
            project_id: project_id.into(),
            peers: DashMap::new(),
            event_tx,
        }
    }

    /// Subscribe to presence events
    pub fn subscribe(&self) -> broadcast::Receiver<PresenceEvent> {
        self.event_tx.subscribe()
    }

    /// Add a new peer
    pub fn add_peer(&self, presence: Presence) -> Result<(), PresenceError> {
        let peer_id = presence.peer_id.clone();

        if self.peers.contains_key(&peer_id) {
            return Err(PresenceError::PeerExists(peer_id));
        }

        self.peers.insert(peer_id.clone(), presence.clone());

        let _ = self.event_tx.send(PresenceEvent::Joined {
            project_id: self.project_id.clone(),
            presence,
        });

        Ok(())
    }

    /// Remove a peer
    pub fn remove_peer(&self, peer_id: &str) -> Option<Presence> {
        let removed = self.peers.remove(peer_id).map(|(_, p)| p);

        if removed.is_some() {
            let _ = self.event_tx.send(PresenceEvent::Left {
                project_id: self.project_id.clone(),
                peer_id: peer_id.to_string(),
            });
        }

        removed
    }

    /// Update cursor position for a peer
    pub fn update_cursor(&self, peer_id: &str, cursor: Cursor) -> Result<(), PresenceError> {
        let mut entry = self.peers.get_mut(peer_id)
            .ok_or_else(|| PresenceError::PeerNotFound(peer_id.to_string()))?;

        entry.set_cursor(cursor.clone());

        let _ = self.event_tx.send(PresenceEvent::CursorMoved {
            project_id: self.project_id.clone(),
            peer_id: peer_id.to_string(),
            cursor,
        });

        Ok(())
    }

    /// Update presence status for a peer
    pub fn update_status(
        &self,
        peer_id: &str,
        status: PresenceStatus,
        active_file: Option<String>,
    ) -> Result<(), PresenceError> {
        let mut entry = self.peers.get_mut(peer_id)
            .ok_or_else(|| PresenceError::PeerNotFound(peer_id.to_string()))?;

        entry.status = status;
        entry.active_file = active_file.clone();
        entry.touch();

        let _ = self.event_tx.send(PresenceEvent::StatusChanged {
            project_id: self.project_id.clone(),
            peer_id: peer_id.to_string(),
            status,
            active_file,
        });

        Ok(())
    }

    /// Set typing indicator
    pub fn set_typing(&self, peer_id: &str, is_typing: bool) -> Result<(), PresenceError> {
        let mut entry = self.peers.get_mut(peer_id)
            .ok_or_else(|| PresenceError::PeerNotFound(peer_id.to_string()))?;

        entry.set_typing(is_typing);

        let _ = self.event_tx.send(PresenceEvent::TypingChanged {
            project_id: self.project_id.clone(),
            peer_id: peer_id.to_string(),
            is_typing,
        });

        Ok(())
    }

    /// Get presence for a specific peer
    pub fn get_peer(&self, peer_id: &str) -> Option<Presence> {
        self.peers.get(peer_id).map(|p| p.clone())
    }

    /// Get all peer presences
    pub fn get_all_peers(&self) -> Vec<Presence> {
        self.peers.iter().map(|e| e.value().clone()).collect()
    }

    /// Get all cursors in a specific file
    pub fn get_cursors_in_file(&self, file_path: &str) -> Vec<(PeerId, Cursor)> {
        self.peers
            .iter()
            .filter_map(|entry| {
                let presence = entry.value();
                presence.cursor.as_ref().and_then(|c| {
                    if c.file_path == file_path {
                        Some((presence.peer_id.clone(), c.clone()))
                    } else {
                        None
                    }
                })
            })
            .collect()
    }

    /// Get number of peers
    pub fn peer_count(&self) -> usize {
        self.peers.len()
    }

    /// Check if empty
    pub fn is_empty(&self) -> bool {
        self.peers.is_empty()
    }

    /// Update all peer statuses based on activity
    pub fn update_all_statuses(&self) {
        for mut entry in self.peers.iter_mut() {
            let old_status = entry.status;
            entry.update_status();

            if entry.status != old_status {
                let _ = self.event_tx.send(PresenceEvent::StatusChanged {
                    project_id: self.project_id.clone(),
                    peer_id: entry.peer_id.clone(),
                    status: entry.status,
                    active_file: entry.active_file.clone(),
                });
            }
        }
    }

    /// Clean up stale cursors from offline peers
    pub fn cleanup_stale(&self) {
        let stale_peers: Vec<PeerId> = self.peers
            .iter()
            .filter(|e| {
                e.status == PresenceStatus::Offline
                    && e.last_active().elapsed() > CURSOR_RETENTION
            })
            .map(|e| e.peer_id.clone())
            .collect();

        for peer_id in stale_peers {
            self.remove_peer(&peer_id);
        }
    }
}

/// Errors related to presence operations
#[derive(Debug, Clone, thiserror::Error)]
pub enum PresenceError {
    #[error("Peer not found: {0}")]
    PeerNotFound(PeerId),

    #[error("Peer already exists: {0}")]
    PeerExists(PeerId),

    #[error("Invalid cursor position")]
    InvalidCursor,
}

/// Global presence manager across all projects
pub struct PresenceManager {
    /// Map of project_id -> ProjectPresence
    projects: DashMap<ProjectId, Arc<ProjectPresence>>,
}

impl PresenceManager {
    pub fn new() -> Self {
        Self {
            projects: DashMap::new(),
        }
    }

    /// Get or create presence manager for a project
    pub fn get_or_create(&self, project_id: &str) -> Arc<ProjectPresence> {
        self.projects
            .entry(project_id.to_string())
            .or_insert_with(|| Arc::new(ProjectPresence::new(project_id)))
            .clone()
    }

    /// Get presence manager for a project if it exists
    pub fn get(&self, project_id: &str) -> Option<Arc<ProjectPresence>> {
        self.projects.get(project_id).map(|p| p.clone())
    }

    /// Remove a project's presence manager (when last peer leaves)
    pub fn remove(&self, project_id: &str) -> Option<Arc<ProjectPresence>> {
        self.projects.remove(project_id).map(|(_, p)| p)
    }

    /// Get total number of active peers across all projects
    pub fn total_peer_count(&self) -> usize {
        self.projects.iter().map(|p| p.peer_count()).sum()
    }

    /// Get number of active projects
    pub fn project_count(&self) -> usize {
        self.projects.len()
    }

    /// Update statuses for all projects
    pub fn update_all_statuses(&self) {
        for entry in self.projects.iter() {
            entry.update_all_statuses();
        }
    }

    /// Cleanup all stale data
    pub fn cleanup_all(&self) {
        // Clean up stale presence data
        for entry in self.projects.iter() {
            entry.cleanup_stale();
        }

        // Remove empty projects
        let empty_projects: Vec<ProjectId> = self.projects
            .iter()
            .filter(|p| p.is_empty())
            .map(|p| p.project_id.clone())
            .collect();

        for project_id in empty_projects {
            self.projects.remove(&project_id);
        }
    }
}

impl Default for PresenceManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Helper to generate a random color for a peer
pub fn generate_peer_color() -> String {
    use rand::Rng;
    let colors = [
        "#3b82f6", // blue
        "#ef4444", // red
        "#22c55e", // green
        "#f59e0b", // amber
        "#8b5cf6", // violet
        "#ec4899", // pink
        "#06b6d4", // cyan
        "#f97316", // orange
        "#14b8a6", // teal
        "#a855f7", // purple
        "#84cc16", // lime
        "#6366f1", // indigo
        "#d946ef", // fuchsia
        "#0ea5e9", // sky
    ];
    let idx = rand::thread_rng().gen_range(0..colors.len());
    colors[idx].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cursor_creation() {
        let cursor = Cursor::new("/src/main.rs", 10, 5)
            .with_selection(10, 20);

        assert_eq!(cursor.file_path, "/src/main.rs");
        assert_eq!(cursor.line, 10);
        assert_eq!(cursor.column, 5);
        assert!(cursor.has_selection());
        assert_eq!(cursor.selection_range(), Some(((10, 5), (10, 20))));
    }

    #[test]
    fn test_presence_creation() {
        let presence = Presence::new("peer-1", "Alice", "#ff0000");

        assert_eq!(presence.peer_id, "peer-1");
        assert_eq!(presence.name, "Alice");
        assert_eq!(presence.color, "#ff0000");
        assert_eq!(presence.status, PresenceStatus::Active);
        assert!(presence.cursor.is_none());
    }

    #[test]
    fn test_presence_cursor_update() {
        let mut presence = Presence::new("peer-1", "Alice", "#ff0000");
        let cursor = Cursor::new("/test.rs", 5, 10);

        presence.set_cursor(cursor);

        assert!(presence.cursor.is_some());
        assert_eq!(presence.active_file, Some("/test.rs".to_string()));
    }

    #[test]
    fn test_project_presence() {
        let project = ProjectPresence::new("test-project");

        let presence1 = Presence::new("peer-1", "Alice", "#ff0000");
        let presence2 = Presence::new("peer-2", "Bob", "#00ff00");

        project.add_peer(presence1).unwrap();
        project.add_peer(presence2).unwrap();

        assert_eq!(project.peer_count(), 2);

        let peers = project.get_all_peers();
        assert_eq!(peers.len(), 2);

        project.remove_peer("peer-1");
        assert_eq!(project.peer_count(), 1);
    }

    #[test]
    fn test_duplicate_peer() {
        let project = ProjectPresence::new("test-project");
        let presence = Presence::new("peer-1", "Alice", "#ff0000");

        project.add_peer(presence.clone()).unwrap();
        let result = project.add_peer(presence);

        assert!(matches!(result, Err(PresenceError::PeerExists(_))));
    }

    #[test]
    fn test_cursor_in_file() {
        let project = ProjectPresence::new("test-project");

        let mut presence1 = Presence::new("peer-1", "Alice", "#ff0000");
        presence1.set_cursor(Cursor::new("/main.rs", 10, 5));

        let mut presence2 = Presence::new("peer-2", "Bob", "#00ff00");
        presence2.set_cursor(Cursor::new("/main.rs", 20, 10));

        let mut presence3 = Presence::new("peer-3", "Charlie", "#0000ff");
        presence3.set_cursor(Cursor::new("/other.rs", 5, 1));

        project.add_peer(presence1).unwrap();
        project.add_peer(presence2).unwrap();
        project.add_peer(presence3).unwrap();

        let cursors = project.get_cursors_in_file("/main.rs");
        assert_eq!(cursors.len(), 2);
    }

    #[test]
    fn test_presence_manager() {
        let manager = PresenceManager::new();

        let project1 = manager.get_or_create("project-1");
        let project2 = manager.get_or_create("project-2");

        project1.add_peer(Presence::new("peer-1", "Alice", "#ff0000")).unwrap();
        project2.add_peer(Presence::new("peer-2", "Bob", "#00ff00")).unwrap();
        project2.add_peer(Presence::new("peer-3", "Charlie", "#0000ff")).unwrap();

        assert_eq!(manager.project_count(), 2);
        assert_eq!(manager.total_peer_count(), 3);
    }

    #[test]
    fn test_generate_color() {
        let color = generate_peer_color();
        assert!(color.starts_with('#'));
        assert_eq!(color.len(), 7);
    }

    #[test]
    fn test_open_close_files() {
        let mut presence = Presence::new("peer-1", "Alice", "#ff0000");

        presence.open_file("/main.rs");
        presence.open_file("/lib.rs");

        assert_eq!(presence.open_files.len(), 2);

        presence.close_file("/main.rs");
        assert_eq!(presence.open_files.len(), 1);
        assert_eq!(presence.open_files[0], "/lib.rs");
    }
}
