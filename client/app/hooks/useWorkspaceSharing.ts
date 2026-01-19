// ============================================================================
// WORKSPACE SHARING HOOK
// ============================================================================
// This hook manages workspace sharing state and operations between peers.
// It handles broadcasting local workspace changes and receiving remote changes.

import { useEffect, useRef, useCallback, useState } from "react";
import { useFileStore, useCollaborationStore } from "../store";
import type { FileNode } from "../lib/tauri";
import {
  WorkspaceSharingManager,
  createWorkspaceSharingManager,
  clearWorkspaceSharingManager,
  type WorkspaceMessage,
  type SharedFile,
  type SharedFileNode,
} from "../lib/workspace-sharing";

// ============================================================================
// TYPES
// ============================================================================

export interface RemoteCursor {
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
}

export interface UseWorkspaceSharingOptions {
  enabled?: boolean;
  autoShareOnOpen?: boolean;
}

export interface UseWorkspaceSharingReturn {
  // State
  isHost: boolean;
  isReceivingWorkspace: boolean;
  remoteWorkspaceHost: string | null;
  remoteCursors: Map<string, RemoteCursor>;

  // Actions
  shareWorkspace: () => void;
  stopSharing: () => void;
  requestWorkspace: () => void;
  shareOpenFile: (file: SharedFile, setActive?: boolean) => void;
  shareCloseFile: (fileId: string) => void;
  shareFileEdit: (fileId: string, content: string, version: number) => void;
  shareFileSave: (fileId: string) => void;
  shareActiveFile: (fileId: string | null) => void;
  shareFolderToggle: (path: string, expanded: boolean) => void;
  shareCursor: (
    fileId: string,
    line: number,
    column: number,
    selection?: RemoteCursor["selection"]
  ) => void;

  // Manager access
  manager: WorkspaceSharingManager | null;
}

// ============================================================================
// HOOK IMPLEMENTATION
// ============================================================================

export function useWorkspaceSharing(
  wsRef: React.RefObject<WebSocket | null>,
  options: UseWorkspaceSharingOptions = {}
): UseWorkspaceSharingReturn {
  const { enabled = true, autoShareOnOpen = true } = options;

  // State
  const [isHost, setIsHost] = useState(false);
  const [isReceivingWorkspace, setIsReceivingWorkspace] = useState(false);
  const [remoteWorkspaceHost, setRemoteWorkspaceHost] = useState<string | null>(
    null
  );
  const [remoteCursors, setRemoteCursors] = useState<Map<string, RemoteCursor>>(
    new Map()
  );

  // Refs
  const managerRef = useRef<WorkspaceSharingManager | null>(null);

  // Store access
  const {
    projectRoot,
    projectPath,
    expandedFolders,
    openFiles,
    activeFileId,
    setProjectRoot,
    setProjectPath,
    openFile,
    closeFile,
    setActiveFile,
    updateFileContent,
    toggleFolder,
    expandFolder,
    collapseFolder,
  } = useFileStore();

  const { peerId, userName, peerColor, isConnected } = useCollaborationStore(
    (state) => ({
      peerId: state.peerId,
      userName: state.userName,
      peerColor:
        state.collaborators.find((c) => c.id === state.peerId)?.color ||
        "#3b82f6",
      isConnected: state.isConnected,
    })
  );

  // ==========================================================================
  // INITIALIZE MANAGER
  // ==========================================================================

  useEffect(() => {
    if (!enabled || !isConnected || !peerId) {
      return;
    }

    // Create manager
    const manager = createWorkspaceSharingManager(
      peerId,
      userName,
      peerColor || "#3b82f6"
    );
    managerRef.current = manager;

    // Set up send function
    const ws = wsRef.current;
    if (ws) {
      manager.setSendFunction((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          // Send as text message (JSON)
          ws.send(data);
        }
      });
    }

    return () => {
      clearWorkspaceSharingManager();
      managerRef.current = null;
    };
  }, [enabled, isConnected, peerId, userName, peerColor, wsRef]);

  // ==========================================================================
  // MESSAGE HANDLING
  // ==========================================================================

  const handleWorkspaceMessage = useCallback(
    (message: WorkspaceMessage) => {
      // Don't process our own messages
      if ("peerId" in message && message.peerId === peerId) {
        return;
      }

      console.log("[WorkspaceSharing] Received:", message.type);

      switch (message.type) {
        case "workspace:share": {
          // Someone is sharing their workspace
          setIsReceivingWorkspace(true);
          setRemoteWorkspaceHost(message.peerName);

          // Convert and set the workspace
          const fileNode = WorkspaceSharingManager.toFileNode(
            message.workspaceRoot
          );
          setProjectRoot(fileNode);
          setProjectPath(message.workspacePath);

          // Apply expanded folders
          message.expandedFolders.forEach((path) => {
            expandFolder(path);
          });

          console.log(
            "[WorkspaceSharing] Received workspace from:",
            message.peerName
          );
          break;
        }

        case "workspace:request": {
          // Someone is requesting the workspace - share it if we're host
          if (isHost && projectRoot && projectPath) {
            managerRef.current?.shareWorkspace(
              projectPath,
              projectRoot,
              Array.from(expandedFolders)
            );

            // Also share all open files
            openFiles.forEach((file) => {
              managerRef.current?.shareOpenFile(
                {
                  id: file.id,
                  path: file.path,
                  name: file.name,
                  content: file.content,
                  language: file.language,
                  version: file.version,
                },
                file.id === activeFileId
              );
            });
          }
          break;
        }

        case "workspace:clear": {
          // Host stopped sharing
          if (isReceivingWorkspace) {
            setIsReceivingWorkspace(false);
            setRemoteWorkspaceHost(null);
            // Optionally clear the workspace
            // setProjectRoot(null);
            // setProjectPath(null);
          }
          break;
        }

        case "file:open": {
          // Remote peer opened a file
          openFile({
            id: message.file.id,
            path: message.file.path,
            name: message.file.name,
            content: message.file.content,
            language: message.file.language,
            isDirty: false,
            version: message.file.version,
          });

          if (message.setActive) {
            setActiveFile(message.file.id);
          }
          break;
        }

        case "file:close": {
          // Remote peer closed a file
          closeFile(message.fileId);
          break;
        }

        case "file:edit": {
          // Remote peer edited a file
          updateFileContent(message.fileId, message.content);
          break;
        }

        case "file:active": {
          // Remote peer changed active file
          if (message.fileId) {
            setActiveFile(message.fileId);
          }
          break;
        }

        case "folder:toggle": {
          // Remote peer toggled a folder
          if (message.expanded) {
            expandFolder(message.path);
          } else {
            collapseFolder(message.path);
          }
          break;
        }

        case "cursor:move": {
          // Remote peer moved cursor
          setRemoteCursors((prev) => {
            const updated = new Map(prev);
            updated.set(message.peerId, {
              peerId: message.peerId,
              peerName: message.peerName,
              peerColor: message.peerColor,
              fileId: message.fileId,
              line: message.line,
              column: message.column,
              selection: message.selection,
            });
            return updated;
          });
          break;
        }
      }
    },
    [
      peerId,
      isHost,
      isReceivingWorkspace,
      projectRoot,
      projectPath,
      expandedFolders,
      openFiles,
      activeFileId,
      setProjectRoot,
      setProjectPath,
      openFile,
      closeFile,
      setActiveFile,
      updateFileContent,
      expandFolder,
      collapseFolder,
    ]
  );

  // Subscribe to workspace messages
  useEffect(() => {
    const manager = managerRef.current;
    if (!manager) return;

    const unsubscribe = manager.subscribe(handleWorkspaceMessage);
    return unsubscribe;
  }, [handleWorkspaceMessage]);

  // ==========================================================================
  // AUTO-SHARE ON WORKSPACE OPEN
  // ==========================================================================

  useEffect(() => {
    if (autoShareOnOpen && isConnected && projectRoot && projectPath && !isReceivingWorkspace) {
      // Auto-share when we open a folder while connected
      setIsHost(true);
      managerRef.current?.shareWorkspace(
        projectPath,
        projectRoot,
        Array.from(expandedFolders)
      );
    }
  }, [
    autoShareOnOpen,
    isConnected,
    projectRoot,
    projectPath,
    isReceivingWorkspace,
    expandedFolders,
  ]);

  // ==========================================================================
  // ACTIONS
  // ==========================================================================

  const shareWorkspace = useCallback(() => {
    if (projectRoot && projectPath) {
      setIsHost(true);
      managerRef.current?.shareWorkspace(
        projectPath,
        projectRoot,
        Array.from(expandedFolders)
      );
    }
  }, [projectRoot, projectPath, expandedFolders]);

  const stopSharing = useCallback(() => {
    setIsHost(false);
    managerRef.current?.clearWorkspace();
  }, []);

  const requestWorkspace = useCallback(() => {
    managerRef.current?.requestWorkspace();
  }, []);

  const shareOpenFile = useCallback(
    (file: SharedFile, setActive: boolean = true) => {
      if (isHost) {
        managerRef.current?.shareOpenFile(file, setActive);
      }
    },
    [isHost]
  );

  const shareCloseFile = useCallback(
    (fileId: string) => {
      if (isHost) {
        managerRef.current?.shareCloseFile(fileId);
      }
    },
    [isHost]
  );

  const shareFileEdit = useCallback(
    (fileId: string, content: string, version: number) => {
      // Allow edits from both host and guests
      managerRef.current?.shareFileEdit(fileId, content, version);
    },
    []
  );

  const shareFileSave = useCallback(
    (fileId: string) => {
      if (isHost) {
        managerRef.current?.shareFileSave(fileId);
      }
    },
    [isHost]
  );

  const shareActiveFile = useCallback(
    (fileId: string | null) => {
      if (isHost) {
        managerRef.current?.shareActiveFile(fileId);
      }
    },
    [isHost]
  );

  const shareFolderToggle = useCallback(
    (path: string, expanded: boolean) => {
      if (isHost) {
        managerRef.current?.shareFolderToggle(path, expanded);
      }
    },
    [isHost]
  );

  const shareCursor = useCallback(
    (
      fileId: string,
      line: number,
      column: number,
      selection?: RemoteCursor["selection"]
    ) => {
      managerRef.current?.shareCursor(fileId, line, column, selection);
    },
    []
  );

  // ==========================================================================
  // CLEAN UP STALE CURSORS
  // ==========================================================================

  useEffect(() => {
    // Remove cursors from disconnected peers
    const interval = setInterval(() => {
      // This would ideally check against the collaborators list
      // For now, we just keep all cursors
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  // ==========================================================================
  // RETURN
  // ==========================================================================

  return {
    isHost,
    isReceivingWorkspace,
    remoteWorkspaceHost,
    remoteCursors,

    shareWorkspace,
    stopSharing,
    requestWorkspace,
    shareOpenFile,
    shareCloseFile,
    shareFileEdit,
    shareFileSave,
    shareActiveFile,
    shareFolderToggle,
    shareCursor,

    manager: managerRef.current,
  };
}
