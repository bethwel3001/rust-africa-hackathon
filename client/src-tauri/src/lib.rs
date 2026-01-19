use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use walkdir::WalkDir;

// ============================================================================
// FILE SYSTEM TYPES
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileNode {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileNode>>,
    pub extension: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileContent {
    pub path: String,
    pub content: String,
    pub language: String,
}

// ============================================================================
// HTTP REQUEST TYPES
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HttpHeader {
    pub key: String,
    pub value: String,
    pub enabled: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    pub headers: Vec<HttpHeader>,
    pub body: Option<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HttpResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub time_ms: u64,
    pub size_bytes: usize,
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

fn read_directory_recursive(path: &PathBuf, depth: u32) -> Result<Vec<FileNode>, String> {
    if depth == 0 {
        return Ok(vec![]);
    }

    let mut nodes: Vec<FileNode> = Vec::new();

    let entries =
        std::fs::read_dir(path).map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let entry_path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files and common ignored directories
        if file_name.starts_with('.')
            || file_name == "node_modules"
            || file_name == "target"
            || file_name == ".git"
            || file_name == "__pycache__"
            || file_name == ".next"
            || file_name == "dist"
            || file_name == "build"
        {
            continue;
        }

        let is_dir = entry_path.is_dir();
        let extension = if is_dir {
            None
        } else {
            entry_path
                .extension()
                .map(|e| e.to_string_lossy().to_string())
        };

        let children = if is_dir && depth > 1 {
            Some(read_directory_recursive(&entry_path, depth - 1)?)
        } else if is_dir {
            Some(vec![]) // Empty placeholder for lazy loading
        } else {
            None
        };

        nodes.push(FileNode {
            id: uuid::Uuid::new_v4().to_string(),
            name: file_name,
            path: entry_path.to_string_lossy().to_string(),
            is_dir,
            children,
            extension,
        });
    }

    // Sort: directories first, then files, alphabetically
    nodes.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(nodes)
}

fn get_language_from_extension(ext: &str) -> String {
    match ext.to_lowercase().as_str() {
        "rs" => "rust",
        "js" | "mjs" | "cjs" => "javascript",
        "ts" | "mts" | "cts" => "typescript",
        "jsx" => "javascript",
        "tsx" => "typescript",
        "json" => "json",
        "html" | "htm" => "html",
        "css" => "css",
        "scss" | "sass" => "scss",
        "md" | "markdown" => "markdown",
        "py" => "python",
        "go" => "go",
        "java" => "java",
        "c" => "c",
        "cpp" | "cc" | "cxx" => "cpp",
        "h" | "hpp" => "cpp",
        "sh" | "bash" | "zsh" => "shell",
        "yaml" | "yml" => "yaml",
        "toml" => "toml",
        "xml" => "xml",
        "sql" => "sql",
        "graphql" | "gql" => "graphql",
        _ => "plaintext",
    }
    .to_string()
}

// ============================================================================
// TAURI COMMANDS
// ============================================================================

#[tauri::command]
async fn open_folder(path: String) -> Result<FileNode, String> {
    let path_buf = PathBuf::from(&path);

    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    if !path_buf.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    let root_name = path_buf
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());

    let children = read_directory_recursive(&path_buf, 10)?;

    Ok(FileNode {
        id: uuid::Uuid::new_v4().to_string(),
        name: root_name,
        path: path.clone(),
        is_dir: true,
        children: Some(children),
        extension: None,
    })
}

#[tauri::command]
async fn read_directory(path: String) -> Result<Vec<FileNode>, String> {
    let path_buf = PathBuf::from(&path);
    read_directory_recursive(&path_buf, 1)
}

#[tauri::command]
async fn read_file(path: String) -> Result<FileContent, String> {
    let path_buf = PathBuf::from(&path);

    if !path_buf.exists() {
        return Err(format!("File does not exist: {}", path));
    }

    if !path_buf.is_file() {
        return Err(format!("Path is not a file: {}", path));
    }

    let content =
        std::fs::read_to_string(&path_buf).map_err(|e| format!("Failed to read file: {}", e))?;

    let extension = path_buf
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_default();

    let language = get_language_from_extension(&extension);

    Ok(FileContent {
        path,
        content,
        language,
    })
}

#[tauri::command]
async fn write_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn create_file(dir_path: String, name: String) -> Result<FileNode, String> {
    let file_path = PathBuf::from(&dir_path).join(&name);

    if file_path.exists() {
        return Err(format!("File already exists: {}", file_path.display()));
    }

    // Create parent directories if they don't exist
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directories: {}", e))?;
    }

    std::fs::write(&file_path, "").map_err(|e| format!("Failed to create file: {}", e))?;

    let extension = file_path
        .extension()
        .map(|e| e.to_string_lossy().to_string());

    Ok(FileNode {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        path: file_path.to_string_lossy().to_string(),
        is_dir: false,
        children: None,
        extension,
    })
}

#[tauri::command]
async fn create_directory(parent_path: String, name: String) -> Result<FileNode, String> {
    let dir_path = PathBuf::from(&parent_path).join(&name);

    if dir_path.exists() {
        return Err(format!("Directory already exists: {}", dir_path.display()));
    }

    std::fs::create_dir_all(&dir_path)
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    Ok(FileNode {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        path: dir_path.to_string_lossy().to_string(),
        is_dir: true,
        children: Some(vec![]),
        extension: None,
    })
}

#[tauri::command]
async fn delete_path(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);

    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    if path_buf.is_dir() {
        std::fs::remove_dir_all(&path_buf)
            .map_err(|e| format!("Failed to delete directory: {}", e))?;
    } else {
        std::fs::remove_file(&path_buf).map_err(|e| format!("Failed to delete file: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
async fn rename_path(old_path: String, new_name: String) -> Result<FileNode, String> {
    let old_path_buf = PathBuf::from(&old_path);

    if !old_path_buf.exists() {
        return Err(format!("Path does not exist: {}", old_path));
    }

    let parent = old_path_buf
        .parent()
        .ok_or_else(|| "Cannot get parent directory".to_string())?;

    let new_path_buf = parent.join(&new_name);

    std::fs::rename(&old_path_buf, &new_path_buf).map_err(|e| format!("Failed to rename: {}", e))?;

    let is_dir = new_path_buf.is_dir();
    let extension = if is_dir {
        None
    } else {
        new_path_buf
            .extension()
            .map(|e| e.to_string_lossy().to_string())
    };

    Ok(FileNode {
        id: uuid::Uuid::new_v4().to_string(),
        name: new_name,
        path: new_path_buf.to_string_lossy().to_string(),
        is_dir,
        children: None,
        extension,
    })
}

#[tauri::command]
async fn search_files(root_path: String, query: String) -> Result<Vec<FileNode>, String> {
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    for entry in WalkDir::new(&root_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            let name = e.file_name().to_string_lossy().to_lowercase();
            !name.starts_with('.')
                && name != "node_modules"
                && name != "target"
                && name != "__pycache__"
                && name != ".next"
        })
    {
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();

        if file_name.to_lowercase().contains(&query_lower) {
            let is_dir = path.is_dir();
            let extension = if is_dir {
                None
            } else {
                path.extension().map(|e| e.to_string_lossy().to_string())
            };

            results.push(FileNode {
                id: uuid::Uuid::new_v4().to_string(),
                name: file_name,
                path: path.to_string_lossy().to_string(),
                is_dir,
                children: None,
                extension,
            });

            if results.len() >= 50 {
                break;
            }
        }
    }

    Ok(results)
}

#[tauri::command]
fn get_file_language(path: String) -> String {
    let path_buf = PathBuf::from(&path);
    let ext = path_buf
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_default();

    get_language_from_extension(&ext)
}

#[tauri::command]
async fn send_http_request(request: HttpRequest) -> Result<HttpResponse, String> {
    // Build client that accepts invalid certs and works with localhost
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(
            request.timeout_ms.unwrap_or(30000),
        ))
        .danger_accept_invalid_certs(true)
        .no_proxy() // Important for localhost requests
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let method = request.method.to_uppercase();
    let mut req_builder = match method.as_str() {
        "GET" => client.get(&request.url),
        "POST" => client.post(&request.url),
        "PUT" => client.put(&request.url),
        "PATCH" => client.patch(&request.url),
        "DELETE" => client.delete(&request.url),
        "HEAD" => client.head(&request.url),
        "OPTIONS" => client.request(reqwest::Method::OPTIONS, &request.url),
        _ => return Err(format!("Unsupported HTTP method: {}", method)),
    };

    // Add headers
    for header in &request.headers {
        if header.enabled && !header.key.is_empty() {
            req_builder = req_builder.header(&header.key, &header.value);
        }
    }

    // Add body for methods that support it
    if let Some(body) = &request.body {
        if !body.is_empty() && matches!(method.as_str(), "POST" | "PUT" | "PATCH") {
            let has_content_type = request
                .headers
                .iter()
                .any(|h| h.enabled && h.key.to_lowercase() == "content-type");

            if !has_content_type {
                req_builder = req_builder.header("Content-Type", "application/json");
            }

            req_builder = req_builder.body(body.clone());
        }
    }

    let start = std::time::Instant::now();

    let response = req_builder
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let elapsed = start.elapsed().as_millis() as u64;

    let status = response.status().as_u16();
    let status_text = response
        .status()
        .canonical_reason()
        .unwrap_or("Unknown")
        .to_string();

    let mut headers = HashMap::new();
    for (key, value) in response.headers().iter() {
        if let Ok(v) = value.to_str() {
            headers.insert(key.to_string(), v.to_string());
        }
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    let size_bytes = body.len();

    Ok(HttpResponse {
        status,
        status_text,
        headers,
        body,
        time_ms: elapsed,
        size_bytes,
    })
}

// ============================================================================
// TAURI APP SETUP
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_websocket::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_folder,
            read_directory,
            read_file,
            write_file,
            create_file,
            create_directory,
            delete_path,
            rename_path,
            search_files,
            get_file_language,
            send_http_request,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
