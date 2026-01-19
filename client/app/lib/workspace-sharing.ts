// ============================================================================
// WORKSPACE SHARING MODULE
// ============================================================================
// This module handles broadcasting workspace state (folders, files, edits)
// between peers in a collaboration room. It uses JSON messages sent via
// the collaboration WebSocket connection.

import type { FileNode } from "./tauri";

// ============================================================================
// TYPES
// ============================================================================

export interface SharedFileNode {
  id: string;
  name: string;
  path: string;
  is_dir: boolean;
  children?: SharedFileNode[];
  extension?: string;
}

export interface SharedFile {
  id: string;
  path: string;
  name: string;
  content: string;
  language: string;
  version: number;
}

export interface WorkspaceState {
  hostPeerId: string;
  hostName: string;
  workspacePath: string;
  workspaceRoot: SharedFileNode | null;
  openFiles: SharedFile[];
  activeFileId: string | null;
  expandedFolders: string[];
}

// Message types for workspace sharing
export type WorkspaceMessage =
  | {
      type: "workspace:share";
      peerId: string;
      peerName: string;
      workspacePath: string;
      workspaceRoot: SharedFileNode;
      expandedFolders: string[];
    }
  | {
      type: "workspace:request";
      peerId: string;
      peerName: string;
    }
  | {
      type: "workspace:clear";
      peerId: string;
    }
  | {
      type: "file:open";
      peerId: string;
      peerName: string;
      file: SharedFile;
      setActive: boolean;
    }
  | {
      type: "file:close";
      peerId: string;
      fileId: string;
    }
  | {
      type: "file:edit";
      peerId: string;
      fileId: string;
      content: string;
      version: number;
    }
  | {
      type: "file:save";
      peerId: string;
      fileId: string;
    }
  | {
      type: "file:active";
      peerId: string;
      fileId: string | null;
    }
  | {
      type: "folder:toggle";
      peerId: string;
      path: string;
      expanded: boolean;
    }
  | {
      type: "cursor:move";
      peerId: string;
      peerName: string;
      peerColor: string;
      fileId: string;
      line: number;
      column: number;
      selection?: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
      };
    };

// ============================================================================
// WORKSPACE SHARING MANAGER
// ============================================================================

export type WorkspaceMessageHandler = (message: WorkspaceMessage) => void;

export class WorkspaceSharingManager {
  private peerId: string;
  private peerName: string;
  private peerColor: string;
  private sendFn: ((data: string) => void) | null = null;
  private handlers: Set<WorkspaceMessageHandler> = new Set();
  private isHost: boolean = false;
  private currentWorkspace: WorkspaceState | null = null;

  constructor(peerId: string, peerName: string, peerColor: string) {
    this.peerId = peerId;
    this.peerName = peerName;
    this.peerColor = peerColor;
  }

  // ==========================================================================
  // CONNECTION MANAGEMENT
  // ==========================================================================

  /**
   * Set the send function for outgoing messages.
   */
  setSendFunction(sendFn: (data: string) => void): void {
    this.sendFn = sendFn;
  }

  /**
   * Update peer info (called when Welcome message is received).
   */
  updatePeerInfo(peerId: string, peerName: string, peerColor: string): void {
    this.peerId = peerId;
    this.peerName = peerName;
    this.peerColor = peerColor;
  }

  /**
   * Subscribe to workspace messages.
   */
  subscribe(handler: WorkspaceMessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /**
   * Handle an incoming workspace message.
   */
  handleMessage(data: string): boolean {
    try {
      const parsed = JSON.parse(data);

      // Check if it's a workspace message
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof parsed.type === "string" &&
        parsed.type.startsWith("workspace:") ||
        parsed.type.startsWith("file:") ||
        parsed.type.startsWith("folder:") ||
        parsed.type.startsWith("cursor:")
      ) {
        const message = parsed as WorkspaceMessage;

        // Notify all handlers
        this.handlers.forEach((handler) => handler(message));

        return true;
      }
    } catch {
      // Not a JSON message, ignore
    }

    return false;
  }

  // ==========================================================================
  // SENDING MESSAGES
  // ==========================================================================

  private send(message: WorkspaceMessage): void {
    if (this.sendFn) {
      const json = JSON.stringify(message);
      console.log("[WorkspaceSharing] Sending:", message.type);
      this.sendFn(json);
    } else {
      console.warn("[WorkspaceSharing] No send function set");
    }
  }

  // ==========================================================================
  // HOST OPERATIONS (sharing your workspace)
  // ==========================================================================

  /**
   * Share your workspace with all peers in the room.
   */
  shareWorkspace(
    workspacePath: string,
    workspaceRoot: FileNode,
    expandedFolders: string[]
  ): void {
    this.isHost = true;

    const sharedRoot = this.convertFileNode(workspaceRoot);

    this.send({
      type: "workspace:share",
      peerId: this.peerId,
      peerName: this.peerName,
      workspacePath,
      workspaceRoot: sharedRoot,
      expandedFolders,
    });

    console.log("[WorkspaceSharing] Shared workspace:", workspacePath);
  }

  /**
   * Clear/unshare your workspace.
   */
  clearWorkspace(): void {
    this.isHost = false;

    this.send({
      type: "workspace:clear",
      peerId: this.peerId,
    });
  }

  /**
   * Broadcast that a file was opened.
   */
  shareOpenFile(file: SharedFile, setActive: boolean = true): void {
    this.send({
      type: "file:open",
      peerId: this.peerId,
      peerName: this.peerName,
      file,
      setActive,
    });
  }

  /**
   * Broadcast that a file was closed.
   */
  shareCloseFile(fileId: string): void {
    this.send({
      type: "file:close",
      peerId: this.peerId,
      fileId,
    });
  }

  /**
   * Broadcast a file edit.
   */
  shareFileEdit(fileId: string, content: string, version: number): void {
    this.send({
      type: "file:edit",
      peerId: this.peerId,
      fileId,
      content,
      version,
    });
  }

  /**
   * Broadcast that a file was saved.
   */
  shareFileSave(fileId: string): void {
    this.send({
      type: "file:save",
      peerId: this.peerId,
      fileId,
    });
  }

  /**
   * Broadcast active file change.
   */
  shareActiveFile(fileId: string | null): void {
    this.send({
      type: "file:active",
      peerId: this.peerId,
      fileId,
    });
  }

  /**
   * Broadcast folder toggle.
   */
  shareFolderToggle(path: string, expanded: boolean): void {
    this.send({
      type: "folder:toggle",
      peerId: this.peerId,
      path,
      expanded,
    });
  }

  /**
   * Broadcast cursor position.
   */
  shareCursor(
    fileId: string,
    line: number,
    column: number,
    selection?: {
      startLine: number;
      startColumn: number;
      endLine: number;
      endColumn: number;
    }
  ): void {
    this.send({
      type: "cursor:move",
      peerId: this.peerId,
      peerName: this.peerName,
      peerColor: this.peerColor,
      fileId,
      line,
      column,
      selection,
    });
  }

  // ==========================================================================
  // GUEST OPERATIONS (receiving shared workspace)
  // ==========================================================================

  /**
   * Request workspace from the host.
   */
  requestWorkspace(): void {
    this.send({
      type: "workspace:request",
      peerId: this.peerId,
      peerName: this.peerName,
    });
  }

  /**
   * Check if we are the host.
   */
  isWorkspaceHost(): boolean {
    return this.isHost;
  }

  /**
   * Get current workspace state.
   */
  getWorkspaceState(): WorkspaceState | null {
    return this.currentWorkspace;
  }

  /**
   * Set workspace state (called when receiving workspace:share).
   */
  setWorkspaceState(state: WorkspaceState): void {
    this.currentWorkspace = state;
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  /**
   * Convert a FileNode to SharedFileNode.
   */
  private convertFileNode(node: FileNode): SharedFileNode {
    return {
      id: node.id,
      name: node.name,
      path: node.path,
      is_dir: node.is_dir,
      extension: node.extension,
      children: node.children?.map((child) => this.convertFileNode(child)),
    };
  }

  /**
   * Convert a SharedFileNode back to FileNode.
   */
  static toFileNode(shared: SharedFileNode): FileNode {
    return {
      id: shared.id,
      name: shared.name,
      path: shared.path,
      is_dir: shared.is_dir,
      extension: shared.extension,
      children: shared.children?.map((child) =>
        WorkspaceSharingManager.toFileNode(child)
      ),
    };
  }

  /**
   * Get language from file extension.
   */
  static getLanguageFromPath(path: string): string {
    const ext = path.split(".").pop()?.toLowerCase() || "";
    const languageMap: Record<string, string> = {
      ts: "typescript",
      tsx: "typescript",
      js: "javascript",
      jsx: "javascript",
      json: "json",
      html: "html",
      css: "css",
      scss: "scss",
      less: "less",
      md: "markdown",
      py: "python",
      rs: "rust",
      go: "go",
      java: "java",
      c: "c",
      cpp: "cpp",
      h: "c",
      hpp: "cpp",
      cs: "csharp",
      rb: "ruby",
      php: "php",
      swift: "swift",
      kt: "kotlin",
      scala: "scala",
      sql: "sql",
      sh: "shell",
      bash: "shell",
      zsh: "shell",
      yml: "yaml",
      yaml: "yaml",
      xml: "xml",
      toml: "toml",
      ini: "ini",
      conf: "ini",
      env: "dotenv",
      dockerfile: "dockerfile",
      makefile: "makefile",
      cmake: "cmake",
      gradle: "gradle",
      vue: "vue",
      svelte: "svelte",
    };

    return languageMap[ext] || "plaintext";
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let sharedManager: WorkspaceSharingManager | null = null;

export function getWorkspaceSharingManager(): WorkspaceSharingManager | null {
  return sharedManager;
}

export function createWorkspaceSharingManager(
  peerId: string,
  peerName: string,
  peerColor: string
): WorkspaceSharingManager {
  sharedManager = new WorkspaceSharingManager(peerId, peerName, peerColor);
  return sharedManager;
}

export function clearWorkspaceSharingManager(): void {
  sharedManager = null;
}
