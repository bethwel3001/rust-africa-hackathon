//! Room module for file tree management and host logic.
//!
//! This module handles:
//! - Movable Tree CRDT structure for file system representation
//! - Host file scanning and directory mapping
//! - On-demand file content loading
//! - File operation broadcasting

mod file_tree;
mod manager;

pub use file_tree::FileNode;
pub use manager::RoomManager;

use serde::{Deserialize, Serialize};

/// Unique identifier for a file or folder
pub type NodeId = String;

/// Represents a file system operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FileOperation {
    /// Create a new file
    CreateFile {
        node_id: NodeId,
        parent_id: Option<NodeId>,
        name: String,
        path: String,
        content: Option<String>,
        language: String,
    },
    /// Create a new folder
    CreateFolder {
        node_id: NodeId,
        parent_id: Option<NodeId>,
        name: String,
        path: String,
    },
    /// Delete a file or folder
    Delete {
        node_id: NodeId,
        path: String,
    },
    /// Rename a file or folder
    Rename {
        node_id: NodeId,
        old_name: String,
        new_name: String,
    },
    /// Move a file or folder to a new parent
    Move {
        node_id: NodeId,
        old_parent_id: Option<NodeId>,
        new_parent_id: Option<NodeId>,
    },
    /// Update file content (for initial load or full replacement)
    UpdateContent {
        path: String,
        content: String,
        version: u64,
    },
}

/// Result of scanning a directory
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    /// Root node of the scanned tree
    pub root: FileNode,
    /// Total number of files found
    pub file_count: usize,
    /// Total number of folders found
    pub folder_count: usize,
    /// Total size in bytes (of files that were read)
    pub total_size: u64,
    /// Files that were skipped (too large, binary, etc.)
    pub skipped_files: Vec<String>,
}

/// Options for directory scanning
#[derive(Debug, Clone)]
pub struct ScanOptions {
    /// Maximum file size to include content (bytes)
    pub max_file_size: u64,
    /// File extensions to include (empty = all)
    pub include_extensions: Vec<String>,
    /// File/folder patterns to exclude
    pub exclude_patterns: Vec<String>,
    /// Whether to read file contents during scan
    pub read_contents: bool,
    /// Maximum depth to scan (0 = unlimited)
    pub max_depth: usize,
    /// Maximum number of files to scan
    pub max_files: usize,
}

impl Default for ScanOptions {
    fn default() -> Self {
        Self {
            max_file_size: 10 * 1024 * 1024, // 10MB
            include_extensions: Vec::new(),
            exclude_patterns: vec![
                ".git".to_string(),
                "node_modules".to_string(),
                "target".to_string(),
                ".next".to_string(),
                "__pycache__".to_string(),
                ".pytest_cache".to_string(),
                "dist".to_string(),
                "build".to_string(),
                ".DS_Store".to_string(),
                "*.pyc".to_string(),
                "*.pyo".to_string(),
                "*.so".to_string(),
                "*.dylib".to_string(),
                "*.dll".to_string(),
                "*.exe".to_string(),
            ],
            read_contents: false, // On-demand loading by default
            max_depth: 20,
            max_files: 10000,
        }
    }
}

impl ScanOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_max_file_size(mut self, size: u64) -> Self {
        self.max_file_size = size;
        self
    }

    pub fn with_read_contents(mut self, read: bool) -> Self {
        self.read_contents = read;
        self
    }

    pub fn with_max_depth(mut self, depth: usize) -> Self {
        self.max_depth = depth;
        self
    }

    pub fn with_exclude_pattern(mut self, pattern: impl Into<String>) -> Self {
        self.exclude_patterns.push(pattern.into());
        self
    }

    /// Check if a path should be excluded based on patterns
    pub fn should_exclude(&self, path: &str, name: &str) -> bool {
        for pattern in &self.exclude_patterns {
            if pattern.starts_with('*') {
                // Wildcard pattern (e.g., "*.pyc")
                let suffix = &pattern[1..];
                if name.ends_with(suffix) {
                    return true;
                }
            } else if name == pattern || path.contains(pattern) {
                return true;
            }
        }
        false
    }

    /// Check if a file extension should be included
    pub fn should_include_extension(&self, extension: &str) -> bool {
        if self.include_extensions.is_empty() {
            return true;
        }
        self.include_extensions.iter().any(|ext| ext == extension)
    }
}

/// Detect programming language from file extension
pub fn detect_language(path: &str) -> String {
    let ext = path
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "rs" => "rust",
        "js" | "mjs" | "cjs" => "javascript",
        "jsx" => "javascriptreact",
        "ts" | "mts" | "cts" => "typescript",
        "tsx" => "typescriptreact",
        "py" | "pyw" => "python",
        "rb" => "ruby",
        "go" => "go",
        "java" => "java",
        "c" => "c",
        "cpp" | "cc" | "cxx" | "c++" => "cpp",
        "h" | "hpp" | "hxx" => "cpp",
        "cs" => "csharp",
        "php" => "php",
        "swift" => "swift",
        "kt" | "kts" => "kotlin",
        "scala" => "scala",
        "html" | "htm" => "html",
        "css" => "css",
        "scss" | "sass" => "scss",
        "less" => "less",
        "json" => "json",
        "jsonc" => "jsonc",
        "xml" => "xml",
        "yaml" | "yml" => "yaml",
        "toml" => "toml",
        "md" | "markdown" => "markdown",
        "sql" => "sql",
        "sh" | "bash" | "zsh" => "shellscript",
        "ps1" | "psm1" => "powershell",
        "dockerfile" => "dockerfile",
        "graphql" | "gql" => "graphql",
        "vue" => "vue",
        "svelte" => "svelte",
        "lua" => "lua",
        "r" => "r",
        "dart" => "dart",
        "elm" => "elm",
        "ex" | "exs" => "elixir",
        "erl" | "hrl" => "erlang",
        "hs" | "lhs" => "haskell",
        "clj" | "cljs" | "cljc" => "clojure",
        "fs" | "fsx" | "fsi" => "fsharp",
        "ml" | "mli" => "ocaml",
        "nim" => "nim",
        "zig" => "zig",
        "v" => "v",
        "sol" => "solidity",
        "move" => "move",
        "proto" => "protobuf",
        "tf" | "tfvars" => "terraform",
        "ini" | "conf" | "cfg" => "ini",
        "env" => "dotenv",
        "txt" => "plaintext",
        "log" => "log",
        "csv" => "csv",
        "diff" | "patch" => "diff",
        "makefile" | "mk" => "makefile",
        "cmake" => "cmake",
        "lock" => "plaintext",
        _ => "plaintext",
    }
    .to_string()
}

/// Check if a file is likely binary based on extension
pub fn is_binary_extension(path: &str) -> bool {
    let ext = path
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_lowercase();

    matches!(
        ext.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "bmp" | "ico" | "webp" | "svg"
            | "mp3" | "mp4" | "wav" | "ogg" | "webm" | "avi" | "mov"
            | "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx"
            | "zip" | "tar" | "gz" | "rar" | "7z" | "bz2"
            | "exe" | "dll" | "so" | "dylib" | "bin"
            | "ttf" | "otf" | "woff" | "woff2" | "eot"
            | "sqlite" | "db" | "sqlite3"
            | "pyc" | "pyo" | "class" | "o" | "obj"
            | "wasm"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_language() {
        assert_eq!(detect_language("main.rs"), "rust");
        assert_eq!(detect_language("app.tsx"), "typescriptreact");
        assert_eq!(detect_language("style.css"), "css");
        assert_eq!(detect_language("data.json"), "json");
        assert_eq!(detect_language("unknown.xyz"), "plaintext");
    }

    #[test]
    fn test_is_binary() {
        assert!(is_binary_extension("image.png"));
        assert!(is_binary_extension("archive.zip"));
        assert!(!is_binary_extension("code.rs"));
        assert!(!is_binary_extension("readme.md"));
    }

    #[test]
    fn test_scan_options_exclude() {
        let opts = ScanOptions::default();

        assert!(opts.should_exclude("/project/node_modules/foo", "foo"));
        assert!(opts.should_exclude("/project/.git/config", "config"));
        assert!(opts.should_exclude("/project/file.pyc", "file.pyc"));
        assert!(!opts.should_exclude("/project/src/main.rs", "main.rs"));
    }

    #[test]
    fn test_scan_options_builder() {
        let opts = ScanOptions::new()
            .with_max_file_size(1024 * 1024)
            .with_read_contents(true)
            .with_max_depth(10)
            .with_exclude_pattern("*.log");

        assert_eq!(opts.max_file_size, 1024 * 1024);
        assert!(opts.read_contents);
        assert_eq!(opts.max_depth, 10);
        assert!(opts.exclude_patterns.contains(&"*.log".to_string()));
    }
}
