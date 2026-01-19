//! File tree module implementing a movable tree CRDT structure.
//!
//! This module provides a tree data structure for representing file systems
//! that can be synchronized across multiple collaborators using CRDT semantics.
//! The tree supports:
//! - Creating files and folders
//! - Moving nodes (files/folders) between parents
//! - Renaming nodes
//! - Deleting nodes (with subtree cleanup)
//! - On-demand content loading

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use uuid::Uuid;

use super::{detect_language, NodeId};

/// Type of file system node
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FileType {
    File,
    Directory,
    Symlink,
}

impl Default for FileType {
    fn default() -> Self {
        Self::File
    }
}

/// A node in the file tree (file or directory)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileNode {
    /// Unique identifier for this node
    pub id: NodeId,
    /// Node name (filename or directory name)
    pub name: String,
    /// Full path relative to project root
    pub path: String,
    /// Type of node
    pub file_type: FileType,
    /// Parent node ID (None for root)
    pub parent_id: Option<NodeId>,
    /// Child node IDs (for directories)
    pub children: Vec<NodeId>,
    /// File extension (for files)
    pub extension: Option<String>,
    /// Detected language (for files)
    pub language: Option<String>,
    /// File size in bytes
    pub size: u64,
    /// Whether content has been loaded
    pub content_loaded: bool,
    /// Creation timestamp
    pub created_at: i64,
    /// Last modification timestamp
    pub modified_at: i64,
    /// Whether this node is expanded in the UI
    pub expanded: bool,
}

impl FileNode {
    /// Create a new file node
    pub fn new_file(id: impl Into<String>, name: impl Into<String>, path: impl Into<String>) -> Self {
        let name = name.into();
        let path = path.into();
        let extension = Path::new(&path)
            .extension()
            .map(|e| e.to_string_lossy().to_string());
        let language = Some(detect_language(&path));
        let now = chrono::Utc::now().timestamp();

        Self {
            id: id.into(),
            name,
            path,
            file_type: FileType::File,
            parent_id: None,
            children: Vec::new(),
            extension,
            language,
            size: 0,
            content_loaded: false,
            created_at: now,
            modified_at: now,
            expanded: false,
        }
    }

    /// Create a new directory node
    pub fn new_directory(id: impl Into<String>, name: impl Into<String>, path: impl Into<String>) -> Self {
        let now = chrono::Utc::now().timestamp();

        Self {
            id: id.into(),
            name: name.into(),
            path: path.into(),
            file_type: FileType::Directory,
            parent_id: None,
            children: Vec::new(),
            extension: None,
            language: None,
            size: 0,
            content_loaded: false,
            created_at: now,
            modified_at: now,
            expanded: false,
        }
    }

    /// Create a root directory node
    pub fn new_root(id: impl Into<String>, name: impl Into<String>) -> Self {
        let name_str = name.into();
        let mut node = Self::new_directory(id, name_str.clone(), name_str);
        node.expanded = true;
        node
    }

    /// Check if this is a directory
    pub fn is_directory(&self) -> bool {
        self.file_type == FileType::Directory
    }

    /// Check if this is a file
    pub fn is_file(&self) -> bool {
        self.file_type == FileType::File
    }

    /// Set the parent ID
    pub fn with_parent(mut self, parent_id: impl Into<String>) -> Self {
        self.parent_id = Some(parent_id.into());
        self
    }

    /// Set the file size
    pub fn with_size(mut self, size: u64) -> Self {
        self.size = size;
        self
    }

    /// Add a child node ID
    pub fn add_child(&mut self, child_id: impl Into<String>) {
        let child_id = child_id.into();
        if !self.children.contains(&child_id) {
            self.children.push(child_id);
        }
    }

    /// Remove a child node ID
    pub fn remove_child(&mut self, child_id: &str) -> bool {
        let before = self.children.len();
        self.children.retain(|id| id != child_id);
        self.children.len() < before
    }

    /// Check if this node has a specific child
    pub fn has_child(&self, child_id: &str) -> bool {
        self.children.contains(&child_id.to_string())
    }

    /// Update modification timestamp
    pub fn touch(&mut self) {
        self.modified_at = chrono::Utc::now().timestamp();
    }

    /// Rename this node
    pub fn rename(&mut self, new_name: impl Into<String>) {
        self.name = new_name.into();
        self.touch();
    }
}

/// A complete file tree structure with index for fast lookups
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileTree {
    /// Root node ID
    pub root_id: Option<NodeId>,
    /// All nodes indexed by ID
    nodes: HashMap<NodeId, FileNode>,
    /// Path to node ID mapping for fast path lookups
    path_index: HashMap<String, NodeId>,
}

impl FileTree {
    /// Create a new empty file tree
    pub fn new() -> Self {
        Self {
            root_id: None,
            nodes: HashMap::new(),
            path_index: HashMap::new(),
        }
    }

    /// Create a file tree with a root directory
    pub fn with_root(name: impl Into<String>) -> Self {
        let mut tree = Self::new();
        let name = name.into();
        let root_id = generate_node_id();
        let root = FileNode::new_root(&root_id, &name);

        tree.path_index.insert(root.path.clone(), root_id.clone());
        tree.nodes.insert(root_id.clone(), root);
        tree.root_id = Some(root_id);

        tree
    }

    /// Get the root node
    pub fn root(&self) -> Option<&FileNode> {
        self.root_id.as_ref().and_then(|id| self.nodes.get(id))
    }

    /// Get a node by ID
    pub fn get(&self, id: &str) -> Option<&FileNode> {
        self.nodes.get(id)
    }

    /// Get a mutable reference to a node by ID
    pub fn get_mut(&mut self, id: &str) -> Option<&mut FileNode> {
        self.nodes.get_mut(id)
    }

    /// Get a node by path
    pub fn get_by_path(&self, path: &str) -> Option<&FileNode> {
        self.path_index.get(path).and_then(|id| self.nodes.get(id))
    }

    /// Get node ID by path
    pub fn get_id_by_path(&self, path: &str) -> Option<&NodeId> {
        self.path_index.get(path)
    }

    /// Check if a path exists
    pub fn path_exists(&self, path: &str) -> bool {
        self.path_index.contains_key(path)
    }

    /// Get the total number of nodes
    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }

    /// Get the number of files
    pub fn file_count(&self) -> usize {
        self.nodes.values().filter(|n| n.is_file()).count()
    }

    /// Get the number of directories
    pub fn directory_count(&self) -> usize {
        self.nodes.values().filter(|n| n.is_directory()).count()
    }

    /// Insert a new node into the tree
    pub fn insert(&mut self, node: FileNode) -> Result<(), FileTreeError> {
        // Check if path already exists
        if self.path_index.contains_key(&node.path) {
            return Err(FileTreeError::PathExists(node.path.clone()));
        }

        // If node has a parent, add it to parent's children
        if let Some(parent_id) = &node.parent_id {
            if let Some(parent) = self.nodes.get_mut(parent_id) {
                parent.add_child(&node.id);
            } else {
                return Err(FileTreeError::ParentNotFound(parent_id.clone()));
            }
        }

        // Add to indices
        let id = node.id.clone();
        let path = node.path.clone();
        self.path_index.insert(path, id.clone());
        self.nodes.insert(id, node);

        Ok(())
    }

    /// Create a file in the tree
    pub fn create_file(
        &mut self,
        parent_id: &str,
        name: &str,
    ) -> Result<NodeId, FileTreeError> {
        let parent = self.nodes.get(parent_id)
            .ok_or_else(|| FileTreeError::NodeNotFound(parent_id.to_string()))?;

        if !parent.is_directory() {
            return Err(FileTreeError::NotADirectory(parent_id.to_string()));
        }

        let path = format!("{}/{}", parent.path.trim_end_matches('/'), name);

        if self.path_exists(&path) {
            return Err(FileTreeError::PathExists(path));
        }

        let id = generate_node_id();
        let node = FileNode::new_file(&id, name, &path)
            .with_parent(parent_id);

        self.insert(node)?;
        Ok(id)
    }

    /// Create a directory in the tree
    pub fn create_directory(
        &mut self,
        parent_id: &str,
        name: &str,
    ) -> Result<NodeId, FileTreeError> {
        let parent = self.nodes.get(parent_id)
            .ok_or_else(|| FileTreeError::NodeNotFound(parent_id.to_string()))?;

        if !parent.is_directory() {
            return Err(FileTreeError::NotADirectory(parent_id.to_string()));
        }

        let path = format!("{}/{}", parent.path.trim_end_matches('/'), name);

        if self.path_exists(&path) {
            return Err(FileTreeError::PathExists(path));
        }

        let id = generate_node_id();
        let node = FileNode::new_directory(&id, name, &path)
            .with_parent(parent_id);

        self.insert(node)?;
        Ok(id)
    }

    /// Delete a node and its entire subtree
    pub fn delete(&mut self, id: &str) -> Result<Vec<FileNode>, FileTreeError> {
        let node = self.nodes.get(id)
            .ok_or_else(|| FileTreeError::NodeNotFound(id.to_string()))?;

        // Can't delete root
        if self.root_id.as_deref() == Some(id) {
            return Err(FileTreeError::CannotDeleteRoot);
        }

        // Collect all nodes to delete (DFS)
        let mut to_delete = Vec::new();
        self.collect_subtree(id, &mut to_delete);

        // Remove from parent's children
        if let Some(parent_id) = &node.parent_id.clone() {
            if let Some(parent) = self.nodes.get_mut(parent_id) {
                parent.remove_child(id);
            }
        }

        // Delete all collected nodes
        let mut deleted = Vec::new();
        for node_id in to_delete {
            if let Some(node) = self.nodes.remove(&node_id) {
                self.path_index.remove(&node.path);
                deleted.push(node);
            }
        }

        Ok(deleted)
    }

    /// Collect all node IDs in a subtree (including the root)
    fn collect_subtree(&self, id: &str, result: &mut Vec<NodeId>) {
        result.push(id.to_string());

        if let Some(node) = self.nodes.get(id) {
            for child_id in &node.children {
                self.collect_subtree(child_id, result);
            }
        }
    }

    /// Rename a node
    pub fn rename(&mut self, id: &str, new_name: &str) -> Result<(), FileTreeError> {
        // Get old path and parent path
        let (old_path, parent_path) = {
            let node = self.nodes.get(id)
                .ok_or_else(|| FileTreeError::NodeNotFound(id.to_string()))?;

            let parent_path = Path::new(&node.path)
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();

            (node.path.clone(), parent_path)
        };

        // Calculate new path
        let new_path = if parent_path.is_empty() {
            new_name.to_string()
        } else {
            format!("{}/{}", parent_path, new_name)
        };

        // Check if new path already exists (and is not the same node)
        if self.path_index.get(&new_path).map(|existing_id| existing_id != id).unwrap_or(false) {
            return Err(FileTreeError::PathExists(new_path));
        }

        // Update path index for this node and all children
        self.update_paths(id, &old_path, &new_path)?;

        // Update node name
        if let Some(node) = self.nodes.get_mut(id) {
            node.name = new_name.to_string();
            node.touch();
        }

        Ok(())
    }

    /// Update paths for a node and all its children (used during rename/move)
    fn update_paths(&mut self, id: &str, old_prefix: &str, new_prefix: &str) -> Result<(), FileTreeError> {
        let node = self.nodes.get(id)
            .ok_or_else(|| FileTreeError::NodeNotFound(id.to_string()))?;

        let children: Vec<NodeId> = node.children.clone();
        let old_path = node.path.clone();

        // Calculate new path
        let new_path = if old_path == old_prefix {
            new_prefix.to_string()
        } else {
            old_path.replacen(old_prefix, new_prefix, 1)
        };

        // Update path index
        self.path_index.remove(&old_path);
        self.path_index.insert(new_path.clone(), id.to_string());

        // Update node path
        if let Some(node) = self.nodes.get_mut(id) {
            node.path = new_path.clone();
        }

        // Recursively update children
        for child_id in children {
            self.update_paths(&child_id, old_prefix, new_prefix)?;
        }

        Ok(())
    }

    /// Move a node to a new parent
    pub fn move_node(&mut self, id: &str, new_parent_id: &str) -> Result<(), FileTreeError> {
        // Validate
        let node = self.nodes.get(id)
            .ok_or_else(|| FileTreeError::NodeNotFound(id.to_string()))?;

        if self.root_id.as_deref() == Some(id) {
            return Err(FileTreeError::CannotMoveRoot);
        }

        let new_parent = self.nodes.get(new_parent_id)
            .ok_or_else(|| FileTreeError::NodeNotFound(new_parent_id.to_string()))?;

        if !new_parent.is_directory() {
            return Err(FileTreeError::NotADirectory(new_parent_id.to_string()));
        }

        // Prevent moving to self or descendant
        if self.is_ancestor_of(id, new_parent_id) {
            return Err(FileTreeError::CircularMove);
        }

        let old_path = node.path.clone();
        let node_name = node.name.clone();
        let old_parent_id = node.parent_id.clone();

        // Calculate new path
        let new_path = format!("{}/{}", new_parent.path.trim_end_matches('/'), node_name);

        // Check if new path already exists
        if self.path_index.contains_key(&new_path) && self.path_index.get(&new_path) != Some(&id.to_string()) {
            return Err(FileTreeError::PathExists(new_path));
        }

        // Remove from old parent
        if let Some(old_parent) = old_parent_id.as_ref().and_then(|pid| self.nodes.get_mut(pid)) {
            old_parent.remove_child(id);
        }

        // Add to new parent
        if let Some(new_parent) = self.nodes.get_mut(new_parent_id) {
            new_parent.add_child(id);
        }

        // Update parent reference
        if let Some(node) = self.nodes.get_mut(id) {
            node.parent_id = Some(new_parent_id.to_string());
        }

        // Update paths
        self.update_paths(id, &old_path, &new_path)?;

        Ok(())
    }

    /// Check if node A is an ancestor of node B
    fn is_ancestor_of(&self, ancestor_id: &str, descendant_id: &str) -> bool {
        let mut current_id = Some(descendant_id.to_string());

        while let Some(id) = current_id {
            if id == ancestor_id {
                return true;
            }
            current_id = self.nodes.get(&id).and_then(|n| n.parent_id.clone());
        }

        false
    }

    /// Get all children of a node (direct children only)
    pub fn get_children(&self, id: &str) -> Vec<&FileNode> {
        self.nodes.get(id)
            .map(|node| {
                node.children.iter()
                    .filter_map(|child_id| self.nodes.get(child_id))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Get all descendants of a node
    pub fn get_descendants(&self, id: &str) -> Vec<&FileNode> {
        let mut result = Vec::new();

        if let Some(node) = self.nodes.get(id) {
            for child_id in &node.children {
                if let Some(child) = self.nodes.get(child_id) {
                    result.push(child);
                    result.extend(self.get_descendants(child_id));
                }
            }
        }

        result
    }

    /// Get path to a node (list of ancestor nodes from root)
    pub fn get_path_to(&self, id: &str) -> Vec<&FileNode> {
        let mut path = Vec::new();
        let mut current_id = Some(id.to_string());

        while let Some(id) = current_id {
            if let Some(node) = self.nodes.get(&id) {
                path.push(node);
                current_id = node.parent_id.clone();
            } else {
                break;
            }
        }

        path.reverse();
        path
    }

    /// Get all nodes as a flat list
    pub fn all_nodes(&self) -> Vec<&FileNode> {
        self.nodes.values().collect()
    }

    /// Get all files (non-directories)
    pub fn all_files(&self) -> Vec<&FileNode> {
        self.nodes.values().filter(|n| n.is_file()).collect()
    }

    /// Get all directories
    pub fn all_directories(&self) -> Vec<&FileNode> {
        self.nodes.values().filter(|n| n.is_directory()).collect()
    }

    /// Expand a directory (set expanded = true)
    pub fn expand(&mut self, id: &str) {
        if let Some(node) = self.nodes.get_mut(id) {
            if node.is_directory() {
                node.expanded = true;
            }
        }
    }

    /// Collapse a directory (set expanded = false)
    pub fn collapse(&mut self, id: &str) {
        if let Some(node) = self.nodes.get_mut(id) {
            node.expanded = false;
        }
    }

    /// Toggle expanded state of a directory
    pub fn toggle_expanded(&mut self, id: &str) {
        if let Some(node) = self.nodes.get_mut(id) {
            if node.is_directory() {
                node.expanded = !node.expanded;
            }
        }
    }

    /// Convert to a nested structure for serialization (for frontend)
    pub fn to_nested(&self) -> Option<NestedNode> {
        self.root_id.as_ref().map(|id| self.node_to_nested(id))
    }

    fn node_to_nested(&self, id: &str) -> NestedNode {
        let node = self.nodes.get(id).expect("Node must exist");

        let children: Vec<NestedNode> = node.children
            .iter()
            .map(|child_id| self.node_to_nested(child_id))
            .collect();

        NestedNode {
            id: node.id.clone(),
            name: node.name.clone(),
            path: node.path.clone(),
            is_dir: node.is_directory(),
            extension: node.extension.clone(),
            language: node.language.clone(),
            size: node.size,
            expanded: node.expanded,
            children: if children.is_empty() { None } else { Some(children) },
        }
    }
}

impl Default for FileTree {
    fn default() -> Self {
        Self::new()
    }
}

/// Nested representation for frontend consumption
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NestedNode {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub extension: Option<String>,
    pub language: Option<String>,
    pub size: u64,
    pub expanded: bool,
    pub children: Option<Vec<NestedNode>>,
}

/// Errors that can occur during file tree operations
#[derive(Debug, Clone, thiserror::Error)]
pub enum FileTreeError {
    #[error("Node not found: {0}")]
    NodeNotFound(String),

    #[error("Parent not found: {0}")]
    ParentNotFound(String),

    #[error("Path already exists: {0}")]
    PathExists(String),

    #[error("Not a directory: {0}")]
    NotADirectory(String),

    #[error("Cannot delete root node")]
    CannotDeleteRoot,

    #[error("Cannot move root node")]
    CannotMoveRoot,

    #[error("Cannot move node to its own descendant")]
    CircularMove,

    #[error("IO error: {0}")]
    Io(String),
}

/// Generate a unique node ID
pub fn generate_node_id() -> NodeId {
    Uuid::new_v4().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_file_tree() {
        let tree = FileTree::with_root("my-project");

        assert!(tree.root().is_some());
        assert_eq!(tree.node_count(), 1);
        assert_eq!(tree.file_count(), 0);
        assert_eq!(tree.directory_count(), 1);
    }

    #[test]
    fn test_create_file() {
        let mut tree = FileTree::with_root("project");
        let root_id = tree.root_id.clone().unwrap();

        let file_id = tree.create_file(&root_id, "main.rs").unwrap();

        assert_eq!(tree.node_count(), 2);
        assert_eq!(tree.file_count(), 1);

        let file = tree.get(&file_id).unwrap();
        assert_eq!(file.name, "main.rs");
        assert_eq!(file.path, "project/main.rs");
        assert_eq!(file.language.as_deref(), Some("rust"));
    }

    #[test]
    fn test_create_directory() {
        let mut tree = FileTree::with_root("project");
        let root_id = tree.root_id.clone().unwrap();

        let dir_id = tree.create_directory(&root_id, "src").unwrap();
        let file_id = tree.create_file(&dir_id, "lib.rs").unwrap();

        assert_eq!(tree.node_count(), 3);

        let file = tree.get(&file_id).unwrap();
        assert_eq!(file.path, "project/src/lib.rs");
    }

    #[test]
    fn test_delete_node() {
        let mut tree = FileTree::with_root("project");
        let root_id = tree.root_id.clone().unwrap();

        let dir_id = tree.create_directory(&root_id, "src").unwrap();
        tree.create_file(&dir_id, "main.rs").unwrap();
        tree.create_file(&dir_id, "lib.rs").unwrap();

        assert_eq!(tree.node_count(), 4);

        // Delete directory should delete children too
        let deleted = tree.delete(&dir_id).unwrap();
        assert_eq!(deleted.len(), 3);
        assert_eq!(tree.node_count(), 1);
    }

    #[test]
    fn test_rename_node() {
        let mut tree = FileTree::with_root("project");
        let root_id = tree.root_id.clone().unwrap();

        let file_id = tree.create_file(&root_id, "old.rs").unwrap();

        tree.rename(&file_id, "new.rs").unwrap();

        let file = tree.get(&file_id).unwrap();
        assert_eq!(file.name, "new.rs");
        assert_eq!(file.path, "project/new.rs");

        assert!(tree.get_by_path("project/new.rs").is_some());
        assert!(tree.get_by_path("project/old.rs").is_none());
    }

    #[test]
    fn test_rename_directory_updates_children() {
        let mut tree = FileTree::with_root("project");
        let root_id = tree.root_id.clone().unwrap();

        let dir_id = tree.create_directory(&root_id, "old_dir").unwrap();
        let file_id = tree.create_file(&dir_id, "test.rs").unwrap();

        tree.rename(&dir_id, "new_dir").unwrap();

        let file = tree.get(&file_id).unwrap();
        assert_eq!(file.path, "project/new_dir/test.rs");
    }

    #[test]
    fn test_move_node() {
        let mut tree = FileTree::with_root("project");
        let root_id = tree.root_id.clone().unwrap();

        let src_id = tree.create_directory(&root_id, "src").unwrap();
        let lib_id = tree.create_directory(&root_id, "lib").unwrap();
        let file_id = tree.create_file(&src_id, "util.rs").unwrap();

        tree.move_node(&file_id, &lib_id).unwrap();

        let file = tree.get(&file_id).unwrap();
        assert_eq!(file.path, "project/lib/util.rs");
        assert_eq!(file.parent_id, Some(lib_id.clone()));

        // Check parent children lists updated
        let src = tree.get(&src_id).unwrap();
        assert!(!src.children.contains(&file_id));

        let lib = tree.get(&lib_id).unwrap();
        assert!(lib.children.contains(&file_id));
    }

    #[test]
    fn test_circular_move_prevented() {
        let mut tree = FileTree::with_root("project");
        let root_id = tree.root_id.clone().unwrap();

        let parent_id = tree.create_directory(&root_id, "parent").unwrap();
        let child_id = tree.create_directory(&parent_id, "child").unwrap();

        // Try to move parent into child
        let result = tree.move_node(&parent_id, &child_id);
        assert!(matches!(result, Err(FileTreeError::CircularMove)));
    }

    #[test]
    fn test_get_children() {
        let mut tree = FileTree::with_root("project");
        let root_id = tree.root_id.clone().unwrap();

        tree.create_file(&root_id, "a.rs").unwrap();
        tree.create_file(&root_id, "b.rs").unwrap();
        tree.create_directory(&root_id, "src").unwrap();

        let children = tree.get_children(&root_id);
        assert_eq!(children.len(), 3);
    }

    #[test]
    fn test_path_lookup() {
        let mut tree = FileTree::with_root("project");
        let root_id = tree.root_id.clone().unwrap();

        let src_id = tree.create_directory(&root_id, "src").unwrap();
        tree.create_file(&src_id, "main.rs").unwrap();

        assert!(tree.path_exists("project/src/main.rs"));
        assert!(!tree.path_exists("project/src/other.rs"));

        let node = tree.get_by_path("project/src/main.rs").unwrap();
        assert_eq!(node.name, "main.rs");
    }

    #[test]
    fn test_to_nested() {
        let mut tree = FileTree::with_root("project");
        let root_id = tree.root_id.clone().unwrap();

        let src_id = tree.create_directory(&root_id, "src").unwrap();
        tree.create_file(&src_id, "main.rs").unwrap();
        tree.create_file(&root_id, "Cargo.toml").unwrap();

        let nested = tree.to_nested().unwrap();

        assert_eq!(nested.name, "project");
        assert!(nested.is_dir);
        assert!(nested.children.is_some());

        let children = nested.children.unwrap();
        assert_eq!(children.len(), 2);
    }

    #[test]
    fn test_expand_collapse() {
        let mut tree = FileTree::with_root("project");
        let root_id = tree.root_id.clone().unwrap();

        let dir_id = tree.create_directory(&root_id, "src").unwrap();

        // Initially not expanded (except root)
        let dir = tree.get(&dir_id).unwrap();
        assert!(!dir.expanded);

        // Expand
        tree.expand(&dir_id);
        let dir = tree.get(&dir_id).unwrap();
        assert!(dir.expanded);

        // Collapse
        tree.collapse(&dir_id);
        let dir = tree.get(&dir_id).unwrap();
        assert!(!dir.expanded);

        // Toggle
        tree.toggle_expanded(&dir_id);
        let dir = tree.get(&dir_id).unwrap();
        assert!(dir.expanded);
    }

    #[test]
    fn test_get_descendants() {
        let mut tree = FileTree::with_root("project");
        let root_id = tree.root_id.clone().unwrap();

        let src_id = tree.create_directory(&root_id, "src").unwrap();
        let lib_id = tree.create_directory(&src_id, "lib").unwrap();
        tree.create_file(&lib_id, "mod.rs").unwrap();
        tree.create_file(&src_id, "main.rs").unwrap();

        let descendants = tree.get_descendants(&root_id);
        assert_eq!(descendants.len(), 4); // src, lib, mod.rs, main.rs
    }

    #[test]
    fn test_get_path_to() {
        let mut tree = FileTree::with_root("project");
        let root_id = tree.root_id.clone().unwrap();

        let src_id = tree.create_directory(&root_id, "src").unwrap();
        let file_id = tree.create_file(&src_id, "main.rs").unwrap();

        let path = tree.get_path_to(&file_id);
        assert_eq!(path.len(), 3); // root -> src -> main.rs
        assert_eq!(path[0].name, "project");
        assert_eq!(path[1].name, "src");
        assert_eq!(path[2].name, "main.rs");
    }
}
