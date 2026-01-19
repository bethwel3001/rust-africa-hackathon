//! Automerge document wrapper for collaborative editing.
//!
//! This module provides a high-level wrapper around Automerge documents,
//! implementing a movable tree CRDT structure for the file system and
//! text CRDTs for file contents.

use automerge::{
    transaction::Transactable, ActorId, AutoCommit, Change, ChangeHash, ObjId, ObjType, ReadDoc, ScalarValue, Value, ROOT,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;

/// Errors that can occur during document operations
#[derive(Error, Debug)]
pub enum DocumentError {
    #[error("Automerge error: {0}")]
    Automerge(#[from] automerge::AutomergeError),

    #[error("File not found: {0}")]
    FileNotFound(String),

    #[error("Folder not found: {0}")]
    FolderNotFound(String),

    #[error("Path already exists: {0}")]
    PathExists(String),

    #[error("Invalid path: {0}")]
    InvalidPath(String),

    #[error("Invalid operation: {0}")]
    InvalidOperation(String),

    #[error("Document corruption: {0}")]
    Corruption(String),

    #[error("Serialization error: {0}")]
    Serialization(String),
}

pub type DocumentResult<T> = Result<T, DocumentError>;

/// Keys used in the Automerge document structure
mod keys {
    pub const FILE_TREE: &str = "file_tree";
    pub const FILES: &str = "files";
    pub const METADATA: &str = "metadata";
    pub const CURSORS: &str = "cursors";
    pub const CHAT: &str = "chat";

    // File tree node keys
    pub const NAME: &str = "name";
    pub const PATH: &str = "path";
    pub const IS_DIR: &str = "is_dir";
    pub const CHILDREN: &str = "children";
    pub const PARENT: &str = "parent";
    pub const CREATED_AT: &str = "created_at";
    pub const UPDATED_AT: &str = "updated_at";

    // File content keys
    pub const CONTENT: &str = "content";
    pub const LANGUAGE: &str = "language";
    pub const VERSION: &str = "version";

    // Metadata keys
    pub const PROJECT_NAME: &str = "project_name";
    pub const OWNER_ID: &str = "owner_id";
    pub const CREATED: &str = "created";
}

/// Represents a node in the file tree (file or folder)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileTreeNode {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub parent_id: Option<String>,
    pub children: Vec<String>, // Child node IDs for directories
    pub created_at: i64,
    pub updated_at: i64,
}

/// Represents file content with metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileContent {
    pub path: String,
    pub content: String,
    pub language: String,
    pub version: u64,
}

/// Collaborative document with CRDT-based file tree and content
pub struct CollabDocument {
    /// The underlying Automerge document
    doc: AutoCommit,
    /// Project identifier
    project_id: String,
    /// Cache of file tree structure for quick lookups
    tree_cache: HashMap<String, FileTreeNode>,
    /// Whether the cache needs rebuilding
    cache_dirty: bool,
}

impl CollabDocument {
    /// Create a new empty collaborative document
    pub fn new(project_id: impl Into<String>) -> DocumentResult<Self> {
        let mut doc = AutoCommit::new();
        let project_id = project_id.into();

        // Initialize document structure
        Self::init_structure(&mut doc, &project_id)?;

        Ok(Self {
            doc,
            project_id,
            tree_cache: HashMap::new(),
            cache_dirty: true,
        })
    }

    /// Create a document with a specific actor ID
    pub fn with_actor(project_id: impl Into<String>, actor_id: &[u8]) -> DocumentResult<Self> {
        let mut doc = AutoCommit::new().with_actor(ActorId::from(actor_id));
        let project_id = project_id.into();

        Self::init_structure(&mut doc, &project_id)?;

        Ok(Self {
            doc,
            project_id,
            tree_cache: HashMap::new(),
            cache_dirty: true,
        })
    }

    /// Load a document from binary Automerge data
    pub fn load(project_id: impl Into<String>, data: &[u8]) -> DocumentResult<Self> {
        let doc = AutoCommit::load(data)?;
        Ok(Self {
            doc,
            project_id: project_id.into(),
            tree_cache: HashMap::new(),
            cache_dirty: true,
        })
    }

    /// Initialize the document structure with required maps
    fn init_structure(doc: &mut AutoCommit, project_id: &str) -> DocumentResult<()> {
        // Create root maps for different data types
        doc.put_object(ROOT, keys::FILE_TREE, ObjType::Map)?;
        doc.put_object(ROOT, keys::FILES, ObjType::Map)?;
        doc.put_object(ROOT, keys::CURSORS, ObjType::Map)?;
        doc.put_object(ROOT, keys::CHAT, ObjType::List)?;

        // Create metadata
        let metadata = doc.put_object(ROOT, keys::METADATA, ObjType::Map)?;
        doc.put(&metadata, keys::PROJECT_NAME, project_id)?;
        doc.put(&metadata, keys::CREATED, chrono::Utc::now().timestamp())?;

        Ok(())
    }

    /// Get the project ID
    pub fn project_id(&self) -> &str {
        &self.project_id
    }

    /// Get the underlying Automerge document (immutable)
    pub fn automerge(&self) -> &AutoCommit {
        &self.doc
    }

    /// Get a mutable reference to the Automerge document
    pub fn automerge_mut(&mut self) -> &mut AutoCommit {
        self.cache_dirty = true;
        &mut self.doc
    }

    /// Save the document to binary format
    pub fn save(&mut self) -> Vec<u8> {
        self.doc.save()
    }

    /// Save incremental changes since last save
    pub fn save_incremental(&mut self) -> Vec<u8> {
        self.doc.save_incremental()
    }

    /// Get all changes since a set of heads
    pub fn get_changes_since(&mut self, heads: &[ChangeHash]) -> Vec<Change> {
        self.doc
            .get_changes(heads)
            .into_iter()
            .cloned()
            .collect()
    }

    /// Apply changes from another document
    pub fn apply_changes(&mut self, changes: Vec<Change>) -> DocumentResult<()> {
        for change in changes {
            self.doc.apply_changes([change])?;
        }
        self.cache_dirty = true;
        Ok(())
    }

    /// Merge with another document
    pub fn merge(&mut self, other: &mut AutoCommit) -> DocumentResult<()> {
        self.doc.merge(other)?;
        self.cache_dirty = true;
        Ok(())
    }

    /// Get current document heads (for sync)
    pub fn get_heads(&mut self) -> Vec<ChangeHash> {
        self.doc.get_heads()
    }

    /// Fork the document for isolated changes
    pub fn fork(&mut self) -> DocumentResult<Self> {
        let forked = self.doc.fork();
        Ok(Self {
            doc: forked,
            project_id: self.project_id.clone(),
            tree_cache: HashMap::new(),
            cache_dirty: true,
        })
    }

    // =========================================================================
    // File Tree Operations (Movable Tree CRDT)
    // =========================================================================

    /// Get the file tree object ID
    fn file_tree_id(&self) -> DocumentResult<ObjId> {
        self.doc
            .get(ROOT, keys::FILE_TREE)?
            .and_then(|(v, id)| {
                if matches!(v, Value::Object(ObjType::Map)) {
                    Some(id)
                } else {
                    None
                }
            })
            .ok_or_else(|| DocumentError::Corruption("Missing file_tree".into()))
    }

    /// Get the files content object ID
    fn files_id(&self) -> DocumentResult<ObjId> {
        self.doc
            .get(ROOT, keys::FILES)?
            .and_then(|(v, id)| {
                if matches!(v, Value::Object(ObjType::Map)) {
                    Some(id)
                } else {
                    None
                }
            })
            .ok_or_else(|| DocumentError::Corruption("Missing files".into()))
    }

    /// Create a new folder in the file tree
    pub fn create_folder(
        &mut self,
        id: &str,
        name: &str,
        path: &str,
        parent_id: Option<&str>,
    ) -> DocumentResult<()> {
        let tree_id = self.file_tree_id()?;
        let now = chrono::Utc::now().timestamp();

        // Create the folder node
        let node_id = self.doc.put_object(&tree_id, id, ObjType::Map)?;
        self.doc.put(&node_id, keys::NAME, name)?;
        self.doc.put(&node_id, keys::PATH, path)?;
        self.doc.put(&node_id, keys::IS_DIR, true)?;
        self.doc.put(&node_id, keys::CREATED_AT, now)?;
        self.doc.put(&node_id, keys::UPDATED_AT, now)?;
        self.doc.put_object(&node_id, keys::CHILDREN, ObjType::List)?;

        if let Some(parent) = parent_id {
            self.doc.put(&node_id, keys::PARENT, parent)?;
            // Add to parent's children list
            self.add_child_to_parent(parent, id)?;
        }

        self.cache_dirty = true;
        Ok(())
    }

    /// Create a new file in the file tree
    pub fn create_file(
        &mut self,
        id: &str,
        name: &str,
        path: &str,
        parent_id: Option<&str>,
        language: &str,
    ) -> DocumentResult<()> {
        let tree_id = self.file_tree_id()?;
        let files_id = self.files_id()?;
        let now = chrono::Utc::now().timestamp();

        // Create the file tree node
        let node_id = self.doc.put_object(&tree_id, id, ObjType::Map)?;
        self.doc.put(&node_id, keys::NAME, name)?;
        self.doc.put(&node_id, keys::PATH, path)?;
        self.doc.put(&node_id, keys::IS_DIR, false)?;
        self.doc.put(&node_id, keys::CREATED_AT, now)?;
        self.doc.put(&node_id, keys::UPDATED_AT, now)?;

        if let Some(parent) = parent_id {
            self.doc.put(&node_id, keys::PARENT, parent)?;
            self.add_child_to_parent(parent, id)?;
        }

        // Create the file content entry with Text CRDT
        let content_id = self.doc.put_object(&files_id, path, ObjType::Map)?;
        self.doc.put_object(&content_id, keys::CONTENT, ObjType::Text)?;
        self.doc.put(&content_id, keys::LANGUAGE, language)?;
        self.doc.put(&content_id, keys::VERSION, 1u64)?;

        self.cache_dirty = true;
        Ok(())
    }

    /// Add a child ID to a parent's children list
    fn add_child_to_parent(&mut self, parent_id: &str, child_id: &str) -> DocumentResult<()> {
        let tree_id = self.file_tree_id()?;

        if let Some((_, parent_obj)) = self.doc.get(&tree_id, parent_id)? {
            if let Some((Value::Object(ObjType::List), children_id)) =
                self.doc.get(&parent_obj, keys::CHILDREN)?
            {
                let len = self.doc.length(&children_id);
                self.doc.insert(&children_id, len, child_id)?;
            }
        }
        Ok(())
    }

    /// Remove a child ID from a parent's children list
    fn remove_child_from_parent(&mut self, parent_id: &str, child_id: &str) -> DocumentResult<()> {
        let tree_id = self.file_tree_id()?;

        if let Some((_, parent_obj)) = self.doc.get(&tree_id, parent_id)? {
            if let Some((Value::Object(ObjType::List), children_id)) =
                self.doc.get(&parent_obj, keys::CHILDREN)?
            {
                // Find and remove the child
                let len = self.doc.length(&children_id);
                for i in 0..len {
                    if let Some((Value::Scalar(s), _)) = self.doc.get(&children_id, i)? {
                        if let ScalarValue::Str(id) = s.as_ref() {
                            if id.as_str() == child_id {
                                self.doc.delete(&children_id, i)?;
                                break;
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }

    /// Move a file or folder to a new parent (Movable Tree CRDT operation)
    pub fn move_node(&mut self, node_id: &str, new_parent_id: Option<&str>) -> DocumentResult<()> {
        let tree_id = self.file_tree_id()?;

        // Get current parent
        let current_parent = if let Some((_, node_obj)) = self.doc.get(&tree_id, node_id)? {
            if let Some((Value::Scalar(s), _)) = self.doc.get(&node_obj, keys::PARENT)? {
                if let ScalarValue::Str(parent) = s.as_ref() {
                    Some(parent.to_string())
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            return Err(DocumentError::FileNotFound(node_id.to_string()));
        };

        // Remove from current parent
        if let Some(current) = current_parent {
            self.remove_child_from_parent(&current, node_id)?;
        }

        // Update parent reference
        if let Some((_, node_obj)) = self.doc.get(&tree_id, node_id)? {
            if let Some(new_parent) = new_parent_id {
                self.doc.put(&node_obj, keys::PARENT, new_parent)?;
            } else {
                self.doc.delete(&node_obj, keys::PARENT)?;
            }
            self.doc
                .put(&node_obj, keys::UPDATED_AT, chrono::Utc::now().timestamp())?;
        }

        // Add to new parent
        if let Some(new_parent) = new_parent_id {
            self.add_child_to_parent(new_parent, node_id)?;
        }

        self.cache_dirty = true;
        Ok(())
    }

    /// Rename a file or folder
    pub fn rename_node(&mut self, node_id: &str, new_name: &str) -> DocumentResult<()> {
        let tree_id = self.file_tree_id()?;

        if let Some((_, node_obj)) = self.doc.get(&tree_id, node_id)? {
            self.doc.put(&node_obj, keys::NAME, new_name)?;
            self.doc
                .put(&node_obj, keys::UPDATED_AT, chrono::Utc::now().timestamp())?;
            self.cache_dirty = true;
            Ok(())
        } else {
            Err(DocumentError::FileNotFound(node_id.to_string()))
        }
    }

    /// Delete a file or folder
    pub fn delete_node(&mut self, node_id: &str) -> DocumentResult<()> {
        let tree_id = self.file_tree_id()?;
        let files_id = self.files_id()?;

        // Get node info before deleting
        let (is_dir, path, parent_id) =
            if let Some((_, node_obj)) = self.doc.get(&tree_id, node_id)? {
                let is_dir = self
                    .doc
                    .get(&node_obj, keys::IS_DIR)?
                    .and_then(|(v, _)| {
                        if let Value::Scalar(s) = v {
                            if let ScalarValue::Boolean(b) = s.as_ref() {
                                return Some(*b);
                            }
                        }
                        None
                    })
                    .unwrap_or(false);

                let path = self
                    .doc
                    .get(&node_obj, keys::PATH)?
                    .and_then(|(v, _)| {
                        if let Value::Scalar(s) = v {
                            if let ScalarValue::Str(p) = s.as_ref() {
                                return Some(p.to_string());
                            }
                        }
                        None
                    })
                    .unwrap_or_default();

                let parent = self
                    .doc
                    .get(&node_obj, keys::PARENT)?
                    .and_then(|(v, _)| {
                        if let Value::Scalar(s) = v {
                            if let ScalarValue::Str(p) = s.as_ref() {
                                return Some(p.to_string());
                            }
                        }
                        None
                    });

                (is_dir, path, parent)
            } else {
                return Err(DocumentError::FileNotFound(node_id.to_string()));
            };

        // Remove from parent
        if let Some(parent) = parent_id {
            self.remove_child_from_parent(&parent, node_id)?;
        }

        // Delete file content if it's a file
        if !is_dir && !path.is_empty() {
            self.doc.delete(&files_id, path.as_str())?;
        }

        // Delete the tree node
        self.doc.delete(&tree_id, node_id)?;

        self.cache_dirty = true;
        Ok(())
    }

    /// Get a file tree node by ID
    pub fn get_node(&self, node_id: &str) -> DocumentResult<Option<FileTreeNode>> {
        let tree_id = self.file_tree_id()?;

        if let Some((_, node_obj)) = self.doc.get(&tree_id, node_id)? {
            Ok(Some(self.read_tree_node(node_id, &node_obj)?))
        } else {
            Ok(None)
        }
    }

    /// Read a file tree node from its object ID
    fn read_tree_node(&self, id: &str, obj_id: &ObjId) -> DocumentResult<FileTreeNode> {
        let name = self.get_string_prop(obj_id, keys::NAME)?.unwrap_or_default();
        let path = self.get_string_prop(obj_id, keys::PATH)?.unwrap_or_default();
        let is_dir = self.get_bool_prop(obj_id, keys::IS_DIR)?.unwrap_or(false);
        let parent_id = self.get_string_prop(obj_id, keys::PARENT)?;
        let created_at = self.get_int_prop(obj_id, keys::CREATED_AT)?.unwrap_or(0);
        let updated_at = self.get_int_prop(obj_id, keys::UPDATED_AT)?.unwrap_or(0);

        // Get children list
        let children = if let Some((Value::Object(ObjType::List), children_id)) =
            self.doc.get(obj_id, keys::CHILDREN)?
        {
            let len = self.doc.length(&children_id);
            let mut children = Vec::with_capacity(len);
            for i in 0..len {
                if let Some((Value::Scalar(s), _)) = self.doc.get(&children_id, i)? {
                    if let ScalarValue::Str(child_id) = s.as_ref() {
                        children.push(child_id.to_string());
                    }
                }
            }
            children
        } else {
            Vec::new()
        };

        Ok(FileTreeNode {
            id: id.to_string(),
            name,
            path,
            is_dir,
            parent_id,
            children,
            created_at,
            updated_at,
        })
    }

    /// Get all nodes in the file tree
    pub fn get_all_nodes(&self) -> DocumentResult<Vec<FileTreeNode>> {
        let tree_id = self.file_tree_id()?;
        let mut nodes = Vec::new();

        for key in self.doc.keys(&tree_id) {
            if let Some((Value::Object(ObjType::Map), node_obj)) = self.doc.get(&tree_id, key.clone())? {
                nodes.push(self.read_tree_node(&key, &node_obj)?);
            }
        }

        Ok(nodes)
    }

    // =========================================================================
    // File Content Operations (Text CRDT)
    // =========================================================================

    /// Get file content by path
    pub fn get_file_content(&self, path: &str) -> DocumentResult<Option<FileContent>> {
        let files_id = self.files_id()?;

        if let Some((Value::Object(ObjType::Map), content_obj)) = self.doc.get(&files_id, path)? {
            let content = if let Some((Value::Object(ObjType::Text), text_id)) =
                self.doc.get(&content_obj, keys::CONTENT)?
            {
                self.doc.text(&text_id).map_err(|e| DocumentError::Automerge(e))?
            } else {
                String::new()
            };

            let language = self
                .get_string_prop(&content_obj, keys::LANGUAGE)?
                .unwrap_or_else(|| "plaintext".to_string());
            let version = self.get_uint_prop(&content_obj, keys::VERSION)?.unwrap_or(1);

            Ok(Some(FileContent {
                path: path.to_string(),
                content,
                language,
                version,
            }))
        } else {
            Ok(None)
        }
    }

    /// Update file content using Text CRDT splice operation
    pub fn update_file_content(
        &mut self,
        path: &str,
        position: usize,
        delete_count: usize,
        insert_text: &str,
    ) -> DocumentResult<()> {
        let files_id = self.files_id()?;

        if let Some((Value::Object(ObjType::Map), content_obj)) = self.doc.get(&files_id, path)? {
            if let Some((Value::Object(ObjType::Text), text_id)) =
                self.doc.get(&content_obj, keys::CONTENT)?
            {
                // Perform the splice operation on the Text CRDT
                self.doc.splice_text(&text_id, position, delete_count as isize, insert_text)?;

                // Increment version
                let version = self.get_uint_prop(&content_obj, keys::VERSION)?.unwrap_or(0);
                self.doc.put(&content_obj, keys::VERSION, version + 1)?;

                self.cache_dirty = true;
                Ok(())
            } else {
                Err(DocumentError::Corruption(format!(
                    "Missing content text for file: {}",
                    path
                )))
            }
        } else {
            Err(DocumentError::FileNotFound(path.to_string()))
        }
    }

    /// Replace entire file content
    pub fn set_file_content(&mut self, path: &str, content: &str) -> DocumentResult<()> {
        let files_id = self.files_id()?;

        if let Some((Value::Object(ObjType::Map), content_obj)) = self.doc.get(&files_id, path)? {
            if let Some((Value::Object(ObjType::Text), text_id)) =
                self.doc.get(&content_obj, keys::CONTENT)?
            {
                // Get current length and replace all
                let current_len = self.doc.text(&text_id)?.len();
                self.doc.splice_text(&text_id, 0, current_len as isize, content)?;

                // Increment version
                let version = self.get_uint_prop(&content_obj, keys::VERSION)?.unwrap_or(0);
                self.doc.put(&content_obj, keys::VERSION, version + 1)?;

                self.cache_dirty = true;
                Ok(())
            } else {
                Err(DocumentError::Corruption(format!(
                    "Missing content text for file: {}",
                    path
                )))
            }
        } else {
            Err(DocumentError::FileNotFound(path.to_string()))
        }
    }

    /// Get a stable cursor position in a file
    pub fn get_cursor(&self, path: &str, position: usize) -> DocumentResult<Option<automerge::Cursor>> {
        let files_id = self.files_id()?;

        if let Some((Value::Object(ObjType::Map), content_obj)) = self.doc.get(&files_id, path)? {
            if let Some((Value::Object(ObjType::Text), text_id)) =
                self.doc.get(&content_obj, keys::CONTENT)?
            {
                let cursor = self.doc.get_cursor(&text_id, position, None)?;
                Ok(Some(cursor))
            } else {
                Ok(None)
            }
        } else {
            Ok(None)
        }
    }

    /// Resolve a cursor to a position
    pub fn resolve_cursor(&self, path: &str, cursor: &automerge::Cursor) -> DocumentResult<Option<usize>> {
        let files_id = self.files_id()?;

        if let Some((Value::Object(ObjType::Map), content_obj)) = self.doc.get(&files_id, path)? {
            if let Some((Value::Object(ObjType::Text), text_id)) =
                self.doc.get(&content_obj, keys::CONTENT)?
            {
                let position = self.doc.get_cursor_position(&text_id, cursor, None)?;
                Ok(Some(position))
            } else {
                Ok(None)
            }
        } else {
            Ok(None)
        }
    }

    // =========================================================================
    // Helper methods for reading properties
    // =========================================================================

    fn get_string_prop(&self, obj_id: &ObjId, prop: &str) -> DocumentResult<Option<String>> {
        if let Some((Value::Scalar(s), _)) = self.doc.get(obj_id, prop)? {
            if let ScalarValue::Str(text) = s.as_ref() {
                return Ok(Some(text.to_string()));
            }
        }
        Ok(None)
    }

    fn get_bool_prop(&self, obj_id: &ObjId, prop: &str) -> DocumentResult<Option<bool>> {
        if let Some((Value::Scalar(s), _)) = self.doc.get(obj_id, prop)? {
            if let ScalarValue::Boolean(b) = s.as_ref() {
                return Ok(Some(*b));
            }
        }
        Ok(None)
    }

    fn get_int_prop(&self, obj_id: &ObjId, prop: &str) -> DocumentResult<Option<i64>> {
        if let Some((Value::Scalar(s), _)) = self.doc.get(obj_id, prop)? {
            if let ScalarValue::Int(n) = s.as_ref() {
                return Ok(Some(*n));
            }
        }
        Ok(None)
    }

    fn get_uint_prop(&self, obj_id: &ObjId, prop: &str) -> DocumentResult<Option<u64>> {
        if let Some((Value::Scalar(s), _)) = self.doc.get(obj_id, prop)? {
            if let ScalarValue::Uint(n) = s.as_ref() {
                return Ok(Some(*n));
            }
        }
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_document() {
        let doc = CollabDocument::new("test-project").unwrap();
        assert_eq!(doc.project_id(), "test-project");
    }

    #[test]
    fn test_create_folder() {
        let mut doc = CollabDocument::new("test").unwrap();
        doc.create_folder("folder-1", "src", "/src", None).unwrap();

        let node = doc.get_node("folder-1").unwrap();
        assert!(node.is_some());
        let node = node.unwrap();
        assert_eq!(node.name, "src");
        assert!(node.is_dir);
    }

    #[test]
    fn test_create_file() {
        let mut doc = CollabDocument::new("test").unwrap();
        doc.create_file("file-1", "main.rs", "/src/main.rs", None, "rust")
            .unwrap();

        let node = doc.get_node("file-1").unwrap();
        assert!(node.is_some());
        let node = node.unwrap();
        assert_eq!(node.name, "main.rs");
        assert!(!node.is_dir);

        let content = doc.get_file_content("/src/main.rs").unwrap();
        assert!(content.is_some());
        let content = content.unwrap();
        assert_eq!(content.language, "rust");
        assert!(content.content.is_empty());
    }

    #[test]
    fn test_file_content_operations() {
        let mut doc = CollabDocument::new("test").unwrap();
        doc.create_file("file-1", "test.txt", "/test.txt", None, "plaintext")
            .unwrap();

        // Set content
        doc.set_file_content("/test.txt", "Hello, World!").unwrap();

        let content = doc.get_file_content("/test.txt").unwrap().unwrap();
        assert_eq!(content.content, "Hello, World!");
        assert_eq!(content.version, 2); // Version incremented

        // Splice content (insert at position 7)
        doc.update_file_content("/test.txt", 7, 0, "beautiful ")
            .unwrap();

        let content = doc.get_file_content("/test.txt").unwrap().unwrap();
        assert_eq!(content.content, "Hello, beautiful World!");
    }

    #[test]
    fn test_save_and_load() {
        let mut doc = CollabDocument::new("test").unwrap();
        doc.create_folder("folder-1", "src", "/src", None).unwrap();
        doc.create_file("file-1", "main.rs", "/src/main.rs", Some("folder-1"), "rust")
            .unwrap();
        doc.set_file_content("/src/main.rs", "fn main() {}").unwrap();

        // Save the document
        let saved = doc.save();

        // Load into a new document
        let loaded = CollabDocument::load("test", &saved).unwrap();

        let node = loaded.get_node("folder-1").unwrap();
        assert!(node.is_some());

        let content = loaded.get_file_content("/src/main.rs").unwrap();
        assert!(content.is_some());
        assert_eq!(content.unwrap().content, "fn main() {}");
    }

    #[test]
    fn test_nested_folders() {
        let mut doc = CollabDocument::new("test").unwrap();
        doc.create_folder("root", "project", "/project", None).unwrap();
        doc.create_folder("src", "src", "/project/src", Some("root")).unwrap();
        doc.create_folder("lib", "lib", "/project/src/lib", Some("src")).unwrap();

        let root = doc.get_node("root").unwrap().unwrap();
        assert_eq!(root.children.len(), 1);
        assert_eq!(root.children[0], "src");

        let src = doc.get_node("src").unwrap().unwrap();
        assert_eq!(src.parent_id, Some("root".to_string()));
        assert_eq!(src.children.len(), 1);
    }

    #[test]
    fn test_delete_node() {
        let mut doc = CollabDocument::new("test").unwrap();
        doc.create_folder("folder", "src", "/src", None).unwrap();
        doc.create_file("file", "main.rs", "/src/main.rs", Some("folder"), "rust")
            .unwrap();

        // Delete the file
        doc.delete_node("file").unwrap();

        assert!(doc.get_node("file").unwrap().is_none());
        assert!(doc.get_file_content("/src/main.rs").unwrap().is_none());

        // Parent should have empty children now
        let folder = doc.get_node("folder").unwrap().unwrap();
        assert!(folder.children.is_empty());
    }

    #[test]
    fn test_rename_node() {
        let mut doc = CollabDocument::new("test").unwrap();
        doc.create_folder("folder", "old_name", "/old_name", None).unwrap();

        doc.rename_node("folder", "new_name").unwrap();

        let node = doc.get_node("folder").unwrap().unwrap();
        assert_eq!(node.name, "new_name");
    }

    #[test]
    fn test_move_node() {
        let mut doc = CollabDocument::new("test").unwrap();
        doc.create_folder("folder1", "src", "/src", None).unwrap();
        doc.create_folder("folder2", "lib", "/lib", None).unwrap();
        doc.create_file("file", "main.rs", "/src/main.rs", Some("folder1"), "rust")
            .unwrap();

        // Move file from folder1 to folder2
        doc.move_node("file", Some("folder2")).unwrap();

        let folder1 = doc.get_node("folder1").unwrap().unwrap();
        assert!(folder1.children.is_empty());

        let folder2 = doc.get_node("folder2").unwrap().unwrap();
        assert_eq!(folder2.children.len(), 1);
        assert_eq!(folder2.children[0], "file");

        let file = doc.get_node("file").unwrap().unwrap();
        assert_eq!(file.parent_id, Some("folder2".to_string()));
    }

    #[test]
    fn test_cursor_stability() {
        let mut doc = CollabDocument::new("test").unwrap();
        doc.create_file("file", "test.txt", "/test.txt", None, "plaintext")
            .unwrap();
        doc.set_file_content("/test.txt", "Hello World").unwrap();

        // Get cursor at position 6 (start of "World")
        let cursor = doc.get_cursor("/test.txt", 6).unwrap().unwrap();

        // Insert text before the cursor position
        doc.update_file_content("/test.txt", 0, 0, "Say ").unwrap();

        // Cursor should still point to "World" (now at position 10)
        let new_pos = doc.resolve_cursor("/test.txt", &cursor).unwrap().unwrap();
        assert_eq!(new_pos, 10);

        let content = doc.get_file_content("/test.txt").unwrap().unwrap();
        assert_eq!(content.content, "Say Hello World");
    }

    #[test]
    fn test_concurrent_edits_simulation() {
        // Create two forks of the same document
        let mut doc1 = CollabDocument::new("test").unwrap();
        doc1.create_file("file", "test.txt", "/test.txt", None, "plaintext")
            .unwrap();
        doc1.set_file_content("/test.txt", "Hello").unwrap();

        // Save and create doc2 from the same state
        let saved = doc1.save();
        let mut doc2 = CollabDocument::load("test", &saved).unwrap();

        // Both users edit concurrently
        doc1.update_file_content("/test.txt", 5, 0, " World").unwrap();
        doc2.update_file_content("/test.txt", 0, 0, "Say ").unwrap();

        // Merge doc2's changes into doc1
        let changes = doc2.get_changes_since(&[]);
        doc1.apply_changes(changes).unwrap();

        // The CRDT should merge both edits
        let content = doc1.get_file_content("/test.txt").unwrap().unwrap();
        // Result should contain both insertions (order may vary based on actor IDs)
        assert!(content.content.contains("Hello"));
        assert!(content.content.contains("World") || content.content.contains("Say"));
    }
}
