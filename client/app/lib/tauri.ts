// ============================================================================
// TAURI API WRAPPER
// ============================================================================

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

// ============================================================================
// TYPES
// ============================================================================

export interface FileNode {
  id: string;
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileNode[];
  extension?: string;
}

export interface FileContent {
  path: string;
  content: string;
  language: string;
}

export interface HttpHeader {
  key: string;
  value: string;
  enabled: boolean;
}

export interface HttpRequest {
  method: string;
  url: string;
  headers: HttpHeader[];
  body?: string;
  timeout_ms?: number;
}

export interface HttpResponse {
  status: number;
  status_text: string;
  headers: Record<string, string>;
  body: string;
  time_ms: number;
  size_bytes: number;
}

// ============================================================================
// ENVIRONMENT CHECK
// ============================================================================

export function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  return "__TAURI__" in window || "__TAURI_INTERNALS__" in window;
}

// ============================================================================
// FILE SYSTEM API
// ============================================================================

export async function openFolderDialog(): Promise<string | null> {
  if (!isTauri()) {
    console.log("Not in Tauri environment, returning mock path");
    return "/mock/project";
  }

  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Project Folder",
    });
    return selected as string | null;
  } catch (error) {
    console.error("Failed to open folder dialog:", error);
    return null;
  }
}

export async function openFolder(path: string): Promise<FileNode> {
  if (!isTauri()) {
    return getMockFileTree();
  }

  try {
    return await invoke<FileNode>("open_folder", { path });
  } catch (error) {
    console.error("Failed to open folder:", error);
    throw error;
  }
}

export async function readDirectory(path: string): Promise<FileNode[]> {
  if (!isTauri()) {
    return getMockFileTree().children || [];
  }

  try {
    return await invoke<FileNode[]>("read_directory", { path });
  } catch (error) {
    console.error("Failed to read directory:", error);
    throw error;
  }
}

export async function readFile(path: string): Promise<FileContent> {
  if (!isTauri()) {
    return getMockFileContent(path);
  }

  try {
    return await invoke<FileContent>("read_file", { path });
  } catch (error) {
    console.error("Failed to read file:", error);
    throw error;
  }
}

export async function writeFile(path: string, content: string): Promise<void> {
  if (!isTauri()) {
    console.log("Mock write file:", path);
    return;
  }

  try {
    await invoke<void>("write_file", { path, content });
  } catch (error) {
    console.error("Failed to write file:", error);
    throw error;
  }
}

export async function createFile(
  dirPath: string,
  name: string,
): Promise<FileNode> {
  if (!isTauri()) {
    return {
      id: Date.now().toString(),
      name,
      path: `${dirPath}/${name}`,
      is_dir: false,
      extension: name.split(".").pop(),
    };
  }

  try {
    return await invoke<FileNode>("create_file", { dirPath, name });
  } catch (error) {
    console.error("Failed to create file:", error);
    throw error;
  }
}

export async function createDirectory(
  parentPath: string,
  name: string,
): Promise<FileNode> {
  if (!isTauri()) {
    return {
      id: Date.now().toString(),
      name,
      path: `${parentPath}/${name}`,
      is_dir: true,
      children: [],
    };
  }

  try {
    return await invoke<FileNode>("create_directory", { parentPath, name });
  } catch (error) {
    console.error("Failed to create directory:", error);
    throw error;
  }
}

export async function deletePath(path: string): Promise<void> {
  if (!isTauri()) {
    console.log("Mock delete path:", path);
    return;
  }

  try {
    await invoke<void>("delete_path", { path });
  } catch (error) {
    console.error("Failed to delete path:", error);
    throw error;
  }
}

export async function renamePath(
  oldPath: string,
  newName: string,
): Promise<FileNode> {
  if (!isTauri()) {
    return {
      id: Date.now().toString(),
      name: newName,
      path: oldPath.replace(/[^/]+$/, newName),
      is_dir: false,
    };
  }

  try {
    return await invoke<FileNode>("rename_path", { oldPath, newName });
  } catch (error) {
    console.error("Failed to rename path:", error);
    throw error;
  }
}

export async function searchFiles(
  rootPath: string,
  query: string,
): Promise<FileNode[]> {
  if (!isTauri()) {
    return [];
  }

  try {
    return await invoke<FileNode[]>("search_files", { rootPath, query });
  } catch (error) {
    console.error("Failed to search files:", error);
    throw error;
  }
}

export async function getFileLanguage(path: string): Promise<string> {
  if (!isTauri()) {
    const ext = path.split(".").pop() || "";
    return getLanguageFromExtension(ext);
  }

  try {
    return await invoke<string>("get_file_language", { path });
  } catch (error) {
    console.error("Failed to get file language:", error);
    return "plaintext";
  }
}

// ============================================================================
// HTTP CLIENT API
// ============================================================================

export async function sendHttpRequest(
  request: HttpRequest,
): Promise<HttpResponse> {
  // Always use Tauri for HTTP requests to avoid CORS issues
  if (isTauri()) {
    try {
      return await invoke<HttpResponse>("send_http_request", { request });
    } catch (error) {
      console.error("Tauri HTTP request failed:", error);
      return {
        status: 0,
        status_text: "Error",
        headers: {},
        body: error instanceof Error ? error.message : String(error),
        time_ms: 0,
        size_bytes: 0,
      };
    }
  }

  // Browser fallback (will have CORS issues with localhost)
  return sendHttpRequestBrowser(request);
}

async function sendHttpRequestBrowser(
  request: HttpRequest,
): Promise<HttpResponse> {
  const start = Date.now();

  try {
    const headers: Record<string, string> = {};
    request.headers
      .filter((h) => h.enabled && h.key.trim())
      .forEach((h) => {
        headers[h.key] = h.value;
      });

    const fetchOptions: RequestInit = {
      method: request.method,
      headers,
      mode: "cors",
    };

    if (request.body && ["POST", "PUT", "PATCH"].includes(request.method)) {
      fetchOptions.body = request.body;
      if (!headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
      }
    }

    const response = await fetch(request.url, fetchOptions);
    const body = await response.text();
    const elapsed = Date.now() - start;

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      status: response.status,
      status_text: response.statusText || getStatusText(response.status),
      headers: responseHeaders,
      body,
      time_ms: elapsed,
      size_bytes: new Blob([body]).size,
    };
  } catch (error) {
    const elapsed = Date.now() - start;
    return {
      status: 0,
      status_text: "Network Error",
      headers: {},
      body:
        error instanceof Error
          ? error.message
          : "Request failed - check if the server is running and CORS is configured",
      time_ms: elapsed,
      size_bytes: 0,
    };
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getStatusText(status: number): string {
  const statusTexts: Record<number, string> = {
    200: "OK",
    201: "Created",
    204: "No Content",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
  };
  return statusTexts[status] || "Unknown";
}

function getLanguageFromExtension(ext: string): string {
  const langMap: Record<string, string> = {
    rs: "rust",
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    toml: "toml",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    html: "html",
    css: "css",
    scss: "scss",
    py: "python",
    go: "go",
    java: "java",
    c: "c",
    cpp: "cpp",
    h: "cpp",
    sh: "shell",
    sql: "sql",
  };
  return langMap[ext.toLowerCase()] || "plaintext";
}

// ============================================================================
// MOCK DATA FOR BROWSER DEVELOPMENT
// ============================================================================

function getMockFileTree(): FileNode {
  return {
    id: "root",
    name: "project",
    path: "/mock/project",
    is_dir: true,
    children: [
      {
        id: "1",
        name: "src",
        path: "/mock/project/src",
        is_dir: true,
        children: [
          {
            id: "2",
            name: "main.rs",
            path: "/mock/project/src/main.rs",
            is_dir: false,
            extension: "rs",
          },
          {
            id: "3",
            name: "lib.rs",
            path: "/mock/project/src/lib.rs",
            is_dir: false,
            extension: "rs",
          },
        ],
      },
      {
        id: "4",
        name: "Cargo.toml",
        path: "/mock/project/Cargo.toml",
        is_dir: false,
        extension: "toml",
      },
      {
        id: "5",
        name: "README.md",
        path: "/mock/project/README.md",
        is_dir: false,
        extension: "md",
      },
    ],
  };
}

const mockFileContents: Record<string, string> = {
  "/mock/project/src/main.rs": `fn main() {
    println!("Hello, CodeCollab!");

    // Initialize the collaborative engine
    let app = Router::new();
    app.listen("0.0.0.0:5000").await;
}`,
  "/mock/project/src/lib.rs": `pub mod collaboration;
pub mod websocket;
pub mod editor;

pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add() {
        assert_eq!(add(2, 2), 4);
    }
}`,
  "/mock/project/Cargo.toml": `[package]
name = "codecollab"
version = "0.1.0"
edition = "2021"

[dependencies]
tokio = { version = "1.0", features = ["full"] }
axum = "0.7"
serde = { version = "1.0", features = ["derive"] }`,
  "/mock/project/README.md": `# CodeCollab

A real-time collaborative code editor built with Rust and Tauri.

## Features

- Real-time collaboration
- Voice chat
- API testing
- AI assistance`,
};

function getMockFileContent(path: string): FileContent {
  const content =
    mockFileContents[path] || `// File: ${path}\n// Content not found`;
  const ext = path.split(".").pop() || "";
  return {
    path,
    content,
    language: getLanguageFromExtension(ext),
  };
}

// ============================================================================
// UNIFIED API OBJECT
// ============================================================================

export const api = {
  openFolderDialog,
  openFolder,
  readDirectory,
  readFile,
  writeFile,
  createFile,
  createDirectory,
  deletePath,
  renamePath,
  searchFiles,
  getFileLanguage,
  sendHttpRequest,
  isTauri,
};

export default api;
