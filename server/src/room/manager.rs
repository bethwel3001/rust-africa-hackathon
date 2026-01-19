//! Room manager for handling room state and host file operations.
//!
//! This module provides:
//! - Room lifecycle management
//! - Host file scanning and directory mapping
//! - On-demand file content loading
//! - File operation coordination

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{error, info};

use super::file_tree::{FileNode, FileTree, FileTreeError};
use super::{detect_language, is_binary_extension, FileOperation, ScanOptions, ScanResult};

/// State of a collaboration room
#[derive(Debug, Clone)]
pub struct RoomState {
    /// Room/project identifier
    pub project_id: String,
    /// Human-readable name
    pub name: String,
    /// The file tree structure
    pub file_tree: FileTree,
    /// Host's local base path (if this is a hosted room)
    pub host_base_path: Option<PathBuf>,
    /// Owner/host peer ID
    pub host_peer_id: Option<String>,
    /// Creation timestamp
    pub created_at: i64,
    /// Last activity timestamp
    pub last_active_at: i64,
    /// Whether the room has been initialized with a folder
    pub initialized: bool,
}

impl RoomState {
    /// Create a new room state
    pub fn new(project_id: impl Into<String>, name: impl Into<String>) -> Self {
        let now = chrono::Utc::now().timestamp();
        Self {
            project_id: project_id.into(),
            name: name.into(),
            file_tree: FileTree::new(),
            host_base_path: None,
            host_peer_id: None,
            created_at: now,
            last_active_at: now,
            initialized: false,
        }
    }

    /// Initialize with a host and base path
    pub fn with_host(mut self, peer_id: impl Into<String>, base_path: PathBuf) -> Self {
        self.host_peer_id = Some(peer_id.into());
        self.host_base_path = Some(base_path);
        self
    }

    /// Check if this room has a host
    pub fn has_host(&self) -> bool {
        self.host_peer_id.is_some()
    }

    /// Check if a specific peer is the host
    pub fn is_host(&self, peer_id: &str) -> bool {
        self.host_peer_id.as_deref() == Some(peer_id)
    }

    /// Update last active timestamp
    pub fn touch(&mut self) {
        self.last_active_at = chrono::Utc::now().timestamp();
    }

    /// Get the full local path for a relative path (only valid if hosted)
    pub fn resolve_path(&self, relative_path: &str) -> Option<PathBuf> {
        self.host_base_path.as_ref().map(|base| base.join(relative_path))
    }
}

/// Manager for room operations
pub struct RoomManager {
    /// Active rooms
    rooms: RwLock<HashMap<String, Arc<RwLock<RoomState>>>>,
    /// Default scan options
    default_scan_options: ScanOptions,
}

impl RoomManager {
    /// Create a new room manager
    pub fn new() -> Self {
        Self {
            rooms: RwLock::new(HashMap::new()),
            default_scan_options: ScanOptions::default(),
        }
    }

    /// Create a new room manager with custom scan options
    pub fn with_scan_options(options: ScanOptions) -> Self {
        Self {
            rooms: RwLock::new(HashMap::new()),
            default_scan_options: options,
        }
    }

    /// Create a new room
    pub async fn create_room(&self, project_id: &str, name: &str) -> Arc<RwLock<RoomState>> {
        let room = Arc::new(RwLock::new(RoomState::new(project_id, name)));

        let mut rooms = self.rooms.write().await;
        rooms.insert(project_id.to_string(), room.clone());

        info!("Created room: {} ({})", name, project_id);
        room
    }

    /// Get a room by ID
    pub async fn get_room(&self, project_id: &str) -> Option<Arc<RwLock<RoomState>>> {
        let rooms = self.rooms.read().await;
        rooms.get(project_id).cloned()
    }

    /// Get or create a room
    pub async fn get_or_create_room(&self, project_id: &str, name: &str) -> Arc<RwLock<RoomState>> {
        // Try to get existing first
        {
            let rooms = self.rooms.read().await;
            if let Some(room) = rooms.get(project_id) {
                return room.clone();
            }
        }

        // Create new room
        self.create_room(project_id, name).await
    }

    /// Remove a room
    pub async fn remove_room(&self, project_id: &str) -> Option<Arc<RwLock<RoomState>>> {
        let mut rooms = self.rooms.write().await;
        let removed = rooms.remove(project_id);

        if removed.is_some() {
            info!("Removed room: {}", project_id);
        }

        removed
    }

    /// Check if a room exists
    pub async fn room_exists(&self, project_id: &str) -> bool {
        let rooms = self.rooms.read().await;
        rooms.contains_key(project_id)
    }

    /// Get the number of active rooms
    pub async fn room_count(&self) -> usize {
        let rooms = self.rooms.read().await;
        rooms.len()
    }

    /// List all room IDs
    pub async fn list_room_ids(&self) -> Vec<String> {
        let rooms = self.rooms.read().await;
        rooms.keys().cloned().collect()
    }

    /// Scan a directory and initialize a room's file tree
    pub async fn scan_directory(
        &self,
        project_id: &str,
        base_path: PathBuf,
        peer_id: &str,
        options: Option<ScanOptions>,
    ) -> Result<ScanResult, RoomError> {
        let room = self.get_room(project_id).await
            .ok_or_else(|| RoomError::RoomNotFound(project_id.to_string()))?;

        let options = options.unwrap_or_else(|| self.default_scan_options.clone());

        // Verify the path exists and is a directory
        if !base_path.is_dir() {
            return Err(RoomError::NotADirectory(base_path.to_string_lossy().to_string()));
        }

        // Get directory name for root
        let dir_name = base_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "project".to_string());

        // Scan the directory
        let (tree, scan_result) = scan_directory_tree(&base_path, &dir_name, &options)?;

        // Update room state
        {
            let mut room_state = room.write().await;
            room_state.file_tree = tree;
            room_state.host_base_path = Some(base_path);
            room_state.host_peer_id = Some(peer_id.to_string());
            room_state.initialized = true;
            room_state.touch();
        }

        info!(
            "Scanned directory for room {}: {} files, {} folders",
            project_id, scan_result.file_count, scan_result.folder_count
        );

        Ok(scan_result)
    }

    /// Load file content on-demand (for hosted rooms)
    pub async fn load_file_content(
        &self,
        project_id: &str,
        file_path: &str,
    ) -> Result<FileContent, RoomError> {
        let room = self.get_room(project_id).await
            .ok_or_else(|| RoomError::RoomNotFound(project_id.to_string()))?;

        let room_state = room.read().await;

        // Check if file exists in tree
        if !room_state.file_tree.path_exists(file_path) {
            return Err(RoomError::FileNotFound(file_path.to_string()));
        }

        // Resolve to local path
        let local_path = room_state.resolve_path(file_path)
            .ok_or_else(|| RoomError::NotHosted)?;

        // Read file content
        let content = tokio::fs::read_to_string(&local_path)
            .await
            .map_err(|e| RoomError::Io(e.to_string()))?;

        let language = detect_language(file_path);
        let metadata = tokio::fs::metadata(&local_path)
            .await
            .map_err(|e| RoomError::Io(e.to_string()))?;

        Ok(FileContent {
            path: file_path.to_string(),
            content,
            language,
            size: metadata.len(),
            modified_at: metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0),
        })
    }

    /// Apply a file operation to a room
    pub async fn apply_operation(
        &self,
        project_id: &str,
        operation: FileOperation,
    ) -> Result<(), RoomError> {
        let room = self.get_room(project_id).await
            .ok_or_else(|| RoomError::RoomNotFound(project_id.to_string()))?;

        let mut room_state = room.write().await;

        match operation {
            FileOperation::CreateFile {
                node_id: _,
                parent_id,
                name,
                path,
                content,
                language: _,
            } => {
                let parent = parent_id.as_deref()
                    .or_else(|| room_state.file_tree.root_id.as_deref())
                    .ok_or_else(|| RoomError::NoRootDirectory)?
                    .to_string();

                room_state.file_tree.create_file(&parent, &name)
                    .map_err(|e| RoomError::TreeError(e))?;

                // If hosted, create actual file
                if let Some(local_path) = room_state.resolve_path(&path) {
                    if let Some(content) = content {
                        tokio::fs::write(&local_path, content)
                            .await
                            .map_err(|e| RoomError::Io(e.to_string()))?;
                    } else {
                        tokio::fs::write(&local_path, "")
                            .await
                            .map_err(|e| RoomError::Io(e.to_string()))?;
                    }
                }
            }

            FileOperation::CreateFolder {
                node_id: _,
                parent_id,
                name,
                path,
            } => {
                let parent = parent_id.as_deref()
                    .or_else(|| room_state.file_tree.root_id.as_deref())
                    .ok_or_else(|| RoomError::NoRootDirectory)?
                    .to_string();

                room_state.file_tree.create_directory(&parent, &name)
                    .map_err(|e| RoomError::TreeError(e))?;

                // If hosted, create actual directory
                if let Some(local_path) = room_state.resolve_path(&path) {
                    tokio::fs::create_dir_all(&local_path)
                        .await
                        .map_err(|e| RoomError::Io(e.to_string()))?;
                }
            }

            FileOperation::Delete { node_id, path } => {
                room_state.file_tree.delete(&node_id)
                    .map_err(|e| RoomError::TreeError(e))?;

                // If hosted, delete actual file/directory
                if let Some(local_path) = room_state.resolve_path(&path) {
                    if local_path.is_dir() {
                        tokio::fs::remove_dir_all(&local_path)
                            .await
                            .map_err(|e| RoomError::Io(e.to_string()))?;
                    } else {
                        tokio::fs::remove_file(&local_path)
                            .await
                            .map_err(|e| RoomError::Io(e.to_string()))?;
                    }
                }
            }

            FileOperation::Rename {
                node_id,
                old_name: _,
                new_name,
            } => {
                let old_path = room_state.file_tree.get(&node_id)
                    .map(|n| n.path.clone())
                    .ok_or_else(|| RoomError::NodeNotFound(node_id.clone()))?;

                room_state.file_tree.rename(&node_id, &new_name)
                    .map_err(|e| RoomError::TreeError(e))?;

                // If hosted, rename actual file/directory
                if let (Some(old_local), Some(new_local)) = (
                    room_state.resolve_path(&old_path),
                    room_state.file_tree.get(&node_id).and_then(|n| room_state.resolve_path(&n.path)),
                ) {
                    tokio::fs::rename(&old_local, &new_local)
                        .await
                        .map_err(|e| RoomError::Io(e.to_string()))?;
                }
            }

            FileOperation::Move {
                node_id,
                old_parent_id: _,
                new_parent_id,
            } => {
                let old_path = room_state.file_tree.get(&node_id)
                    .map(|n| n.path.clone())
                    .ok_or_else(|| RoomError::NodeNotFound(node_id.clone()))?;

                let new_parent = new_parent_id.as_deref()
                    .ok_or_else(|| RoomError::NoRootDirectory)?;

                room_state.file_tree.move_node(&node_id, new_parent)
                    .map_err(|e| RoomError::TreeError(e))?;

                // If hosted, move actual file/directory
                if let (Some(old_local), Some(new_local)) = (
                    room_state.resolve_path(&old_path),
                    room_state.file_tree.get(&node_id).and_then(|n| room_state.resolve_path(&n.path)),
                ) {
                    tokio::fs::rename(&old_local, &new_local)
                        .await
                        .map_err(|e| RoomError::Io(e.to_string()))?;
                }
            }

            FileOperation::UpdateContent {
                path,
                content,
                version: _,
            } => {
                // If hosted, update actual file
                if let Some(local_path) = room_state.resolve_path(&path) {
                    tokio::fs::write(&local_path, &content)
                        .await
                        .map_err(|e| RoomError::Io(e.to_string()))?;
                }

                // Update file tree metadata if needed
                if let Some(node_id) = room_state.file_tree.get_id_by_path(&path).cloned() {
                    if let Some(node) = room_state.file_tree.get_mut(&node_id) {
                        node.content_loaded = true;
                        node.size = content.len() as u64;
                        node.touch();
                    }
                }
            }
        }

        room_state.touch();
        Ok(())
    }

    /// Get the file tree for a room
    pub async fn get_file_tree(&self, project_id: &str) -> Option<FileTree> {
        let room = self.get_room(project_id).await?;
        let room_state = room.read().await;
        Some(room_state.file_tree.clone())
    }

    /// Cleanup empty or stale rooms
    pub async fn cleanup_stale_rooms(&self, max_age_seconds: i64) {
        let now = chrono::Utc::now().timestamp();
        let mut to_remove = Vec::new();

        {
            let rooms = self.rooms.read().await;
            for (id, room) in rooms.iter() {
                let room_state = room.read().await;
                if now - room_state.last_active_at > max_age_seconds {
                    to_remove.push(id.clone());
                }
            }
        }

        for id in to_remove {
            self.remove_room(&id).await;
        }
    }
}

impl Default for RoomManager {
    fn default() -> Self {
        Self::new()
    }
}

/// File content with metadata
#[derive(Debug, Clone)]
pub struct FileContent {
    pub path: String,
    pub content: String,
    pub language: String,
    pub size: u64,
    pub modified_at: i64,
}

/// Errors that can occur during room operations
#[derive(Debug, thiserror::Error)]
pub enum RoomError {
    #[error("Room not found: {0}")]
    RoomNotFound(String),

    #[error("Node not found: {0}")]
    NodeNotFound(String),

    #[error("File not found: {0}")]
    FileNotFound(String),

    #[error("Not a directory: {0}")]
    NotADirectory(String),

    #[error("No root directory set")]
    NoRootDirectory,

    #[error("Room is not hosted locally")]
    NotHosted,

    #[error("File tree error: {0}")]
    TreeError(#[from] FileTreeError),

    #[error("IO error: {0}")]
    Io(String),

    #[error("Scan error: {0}")]
    ScanError(String),
}

/// Scan a directory and build a file tree
fn scan_directory_tree(
    base_path: &Path,
    root_name: &str,
    options: &ScanOptions,
) -> Result<(FileTree, ScanResult), RoomError> {
    let mut tree = FileTree::with_root(root_name);
    let root_id = tree.root_id.clone().unwrap();

    let mut file_count = 0;
    let mut folder_count = 1; // Count root
    let mut total_size = 0u64;
    let mut skipped_files = Vec::new();

    // Recursive scan helper
    fn scan_recursive(
        path: &Path,
        parent_id: &str,
        tree: &mut FileTree,
        options: &ScanOptions,
        depth: usize,
        file_count: &mut usize,
        folder_count: &mut usize,
        total_size: &mut u64,
        skipped_files: &mut Vec<String>,
        max_files: usize,
        base_path: &Path,
    ) -> Result<(), RoomError> {
        if depth > options.max_depth && options.max_depth > 0 {
            return Ok(());
        }

        if *file_count >= max_files {
            return Ok(());
        }

        let entries = std::fs::read_dir(path)
            .map_err(|e| RoomError::Io(e.to_string()))?;

        let mut entries_vec: Vec<_> = entries
            .filter_map(|e| e.ok())
            .collect();

        // Sort: directories first, then by name
        entries_vec.sort_by(|a, b| {
            let a_is_dir = a.path().is_dir();
            let b_is_dir = b.path().is_dir();
            match (a_is_dir, b_is_dir) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a.file_name().cmp(&b.file_name()),
            }
        });

        for entry in entries_vec {
            if *file_count >= max_files {
                break;
            }

            let entry_path = entry.path();
            let file_name = entry.file_name().to_string_lossy().to_string();

            // Calculate relative path
            let relative_path = entry_path
                .strip_prefix(base_path)
                .ok()
                .map(|p| {
                    let root_name = tree.root().map(|r| r.name.clone()).unwrap_or_default();
                    format!("{}/{}", root_name, p.to_string_lossy())
                })
                .unwrap_or_else(|| file_name.clone());

            // Check exclusions
            if options.should_exclude(&relative_path, &file_name) {
                continue;
            }

            if entry_path.is_dir() {
                // Create directory node
                let dir_id = tree.create_directory(parent_id, &file_name)
                    .map_err(|e| RoomError::TreeError(e))?;
                *folder_count += 1;

                // Recurse into directory
                scan_recursive(
                    &entry_path,
                    &dir_id,
                    tree,
                    options,
                    depth + 1,
                    file_count,
                    folder_count,
                    total_size,
                    skipped_files,
                    max_files,
                    base_path,
                )?;
            } else if entry_path.is_file() {
                // Check file extension filter
                let extension = entry_path
                    .extension()
                    .map(|e| e.to_string_lossy().to_string())
                    .unwrap_or_default();

                if !options.should_include_extension(&extension) {
                    continue;
                }

                // Check if binary
                if is_binary_extension(&relative_path) {
                    skipped_files.push(relative_path.clone());
                    continue;
                }

                // Check file size
                let metadata = std::fs::metadata(&entry_path)
                    .map_err(|e| RoomError::Io(e.to_string()))?;

                if metadata.len() > options.max_file_size {
                    skipped_files.push(relative_path.clone());
                    continue;
                }

                // Create file node
                tree.create_file(parent_id, &file_name)
                    .map_err(|e| RoomError::TreeError(e))?;

                *file_count += 1;
                *total_size += metadata.len();
            }
        }

        Ok(())
    }

    // Start recursive scan
    scan_recursive(
        base_path,
        &root_id,
        &mut tree,
        options,
        0,
        &mut file_count,
        &mut folder_count,
        &mut total_size,
        &mut skipped_files,
        options.max_files,
        base_path,
    )?;

    // Create root node for result
    let root_node = tree.root().cloned().unwrap_or_else(|| {
        FileNode::new_root("root", root_name)
    });

    Ok((
        tree,
        ScanResult {
            root: root_node,
            file_count,
            folder_count,
            total_size,
            skipped_files,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_create_room() {
        let manager = RoomManager::new();
        let room = manager.create_room("test-project", "Test Project").await;

        let room_state = room.read().await;
        assert_eq!(room_state.project_id, "test-project");
        assert_eq!(room_state.name, "Test Project");
        assert!(!room_state.initialized);
    }

    #[tokio::test]
    async fn test_get_or_create_room() {
        let manager = RoomManager::new();

        let room1 = manager.get_or_create_room("test", "Test").await;
        let room2 = manager.get_or_create_room("test", "Test").await;

        // Should be the same room
        assert_eq!(manager.room_count().await, 1);
    }

    #[tokio::test]
    async fn test_remove_room() {
        let manager = RoomManager::new();
        manager.create_room("test", "Test").await;

        assert!(manager.room_exists("test").await);

        manager.remove_room("test").await;

        assert!(!manager.room_exists("test").await);
    }

    #[tokio::test]
    async fn test_scan_directory() {
        let manager = RoomManager::new();
        manager.create_room("test", "Test").await;

        // Create a temp directory with some files
        let dir = tempdir().unwrap();
        std::fs::create_dir(dir.path().join("src")).unwrap();
        std::fs::write(dir.path().join("src/main.rs"), "fn main() {}").unwrap();
        std::fs::write(dir.path().join("Cargo.toml"), "[package]").unwrap();

        let result = manager
            .scan_directory("test", dir.path().to_path_buf(), "peer-1", None)
            .await
            .unwrap();

        assert_eq!(result.file_count, 2);
        assert_eq!(result.folder_count, 2); // root + src

        // Check room state
        let room = manager.get_room("test").await.unwrap();
        let state = room.read().await;
        assert!(state.initialized);
        assert!(state.file_tree.path_exists(&format!("{}/src/main.rs", dir.path().file_name().unwrap().to_string_lossy())));
    }

    #[tokio::test]
    async fn test_room_state() {
        let state = RoomState::new("proj", "Project")
            .with_host("peer-1", PathBuf::from("/home/user/project"));

        assert!(state.has_host());
        assert!(state.is_host("peer-1"));
        assert!(!state.is_host("peer-2"));

        let resolved = state.resolve_path("src/main.rs");
        assert_eq!(resolved, Some(PathBuf::from("/home/user/project/src/main.rs")));
    }
}
