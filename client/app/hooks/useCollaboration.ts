// ============================================================================
// COLLABORATION HOOK WITH BINARY PROTOCOL & AUTOMERGE CRDT
// ============================================================================

import { useEffect, useRef, useCallback, useState } from "react";
import { useCollaborationStore, useFileStore } from "../store";
import { SyncProtocol, PresenceStatus } from "../lib/protocol";
import type { ServerMessage, PeerInfo } from "../lib/protocol";
import { DocumentManager } from "../lib/automerge";
import { generateId } from "../lib/utils";

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_SERVER_URL = "ws://localhost:5000";
const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_DELAY = 30000;
const PING_INTERVAL = 25000;
const SYNC_DEBOUNCE_MS = 50;

// ============================================================================
// TYPES
// ============================================================================

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export interface UseCollaborationOptions {
  serverUrl?: string;
  autoReconnect?: boolean;
  onConnectionChange?: (status: ConnectionStatus) => void;
}

export interface UseCollaborationReturn {
  // Connection state
  connectionStatus: ConnectionStatus;
  isConnected: boolean;
  peerId: string | null;
  peerColor: string | null;

  // Document manager for CRDT operations
  documentManager: DocumentManager | null;

  // Connection methods
  connect: (projectId: string, userName: string) => Promise<void>;
  disconnect: () => void;

  // File operations
  openFile: (filePath: string) => void;
  closeFile: (filePath: string) => void;

  // Cursor & presence
  sendCursorUpdate: (
    filePath: string,
    line: number,
    column: number,
    selectionEnd?: [number, number],
  ) => void;
  sendPresenceUpdate: (status: PresenceStatus, activeFile?: string) => void;

  // Chat
  sendChatMessage: (content: string) => void;

  // Voice
  joinVoiceChat: () => void;
  leaveVoiceChat: () => void;

  // Sync
  requestSync: () => void;
}

// ============================================================================
// HOOK IMPLEMENTATION
// ============================================================================

export function useCollaboration(
  options: UseCollaborationOptions = {},
): UseCollaborationReturn {
  const {
    serverUrl = DEFAULT_SERVER_URL,
    autoReconnect = true,
    onConnectionChange,
  } = options;

  // Refs for WebSocket and state management
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptRef = useRef(0);

  // Refs for message handlers to avoid stale closures
  const handlersRef = useRef<{
    handleWelcome: (msg: Extract<ServerMessage, { type: "Welcome" }>) => void;
    handleProjectJoined: (
      msg: Extract<ServerMessage, { type: "ProjectJoined" }>,
    ) => void;
    handlePeerJoined: (
      msg: Extract<ServerMessage, { type: "PeerJoined" }>,
    ) => void;
    handlePeerLeft: (msg: Extract<ServerMessage, { type: "PeerLeft" }>) => void;
    handleProjectLeft: (
      msg: Extract<ServerMessage, { type: "ProjectLeft" }>,
    ) => void;
    handleSyncMessage: (
      msg: Extract<ServerMessage, { type: "SyncMessage" }>,
    ) => void;
    handleSyncComplete: (
      msg: Extract<ServerMessage, { type: "SyncComplete" }>,
    ) => void;
    handleFileContent: (
      msg: Extract<ServerMessage, { type: "FileContent" }>,
    ) => void;
    handleFileNotFound: (
      msg: Extract<ServerMessage, { type: "FileNotFound" }>,
    ) => void;
    handleCursorBroadcast: (
      msg: Extract<ServerMessage, { type: "CursorBroadcast" }>,
    ) => void;
    handlePresenceBroadcast: (
      msg: Extract<ServerMessage, { type: "PresenceBroadcast" }>,
    ) => void;
    handleChatBroadcast: (
      msg: Extract<ServerMessage, { type: "ChatBroadcast" }>,
    ) => void;
    handleVoiceToken: (
      msg: Extract<ServerMessage, { type: "VoiceToken" }>,
    ) => void;
    handleError: (msg: Extract<ServerMessage, { type: "Error" }>) => void;
    handleGoodbye: (msg: Extract<ServerMessage, { type: "Goodbye" }>) => void;
  } | null>(null);

  // Connection state
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");
  const [peerId, setPeerId] = useState<string | null>(null);
  const [peerColor, setPeerColor] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  // Document manager for Automerge CRDT
  const documentManagerRef = useRef<DocumentManager | null>(null);

  // Project context
  const projectIdRef = useRef<string | null>(null);
  const userNameRef = useRef<string>("Anonymous");

  // Store access
  const {
    setConnected,
    setRoomId,
    setUserId,
    setUserName,
    addCollaborator,
    removeCollaborator,
    updateCursor,
    addChatMessage,
  } = useCollaborationStore();

  const { updateFileContent, openFiles } = useFileStore();

  // ============================================================================
  // STATUS UPDATES
  // ============================================================================

  const updateConnectionStatus = useCallback(
    (status: ConnectionStatus) => {
      setConnectionStatus(status);
      setConnected(status === "connected");
      onConnectionChange?.(status);
    },
    [setConnected, onConnectionChange],
  );

  // ============================================================================
  // WEBSOCKET SEND
  // ============================================================================

  const sendBinary = useCallback((data: Uint8Array): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(data);
        return true;
      } catch (error) {
        console.error("[WS] Failed to send binary message:", error);
        return false;
      }
    }
    console.warn("[WS] Cannot send - not connected");
    return false;
  }, []);

  // ============================================================================
  // SYNC MANAGEMENT
  // ============================================================================

  const scheduleSyncMessage = useCallback(() => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }

    syncTimeoutRef.current = setTimeout(() => {
      const docManager = documentManagerRef.current;
      const projectId = projectIdRef.current;

      if (!docManager || !projectId) return;

      // Generate sync message for the server (server acts as sync peer)
      const syncData = docManager.generateSyncMessage("server");
      if (syncData) {
        const message = SyncProtocol.createSyncMessage(projectId, syncData);
        sendBinary(message);
      }
    }, SYNC_DEBOUNCE_MS);
  }, [sendBinary]);

  // ============================================================================
  // MESSAGE HANDLING
  // ============================================================================

  const handleServerMessage = useCallback((data: ArrayBuffer) => {
    try {
      const message = SyncProtocol.decodeServer(data);
      console.log("[WS] Received:", message.type);

      const handlers = handlersRef.current;
      if (!handlers) {
        console.warn("[WS] Handlers not initialized yet");
        return;
      }

      switch (message.type) {
        case "Welcome":
          handlers.handleWelcome(message);
          break;
        case "ProjectJoined":
          handlers.handleProjectJoined(message);
          break;
        case "PeerJoined":
          handlers.handlePeerJoined(message);
          break;
        case "PeerLeft":
          handlers.handlePeerLeft(message);
          break;
        case "ProjectLeft":
          handlers.handleProjectLeft(message);
          break;
        case "SyncMessage":
          handlers.handleSyncMessage(message);
          break;
        case "SyncComplete":
          handlers.handleSyncComplete(message);
          break;
        case "FileContent":
          handlers.handleFileContent(message);
          break;
        case "FileNotFound":
          handlers.handleFileNotFound(message);
          break;
        case "CursorBroadcast":
          handlers.handleCursorBroadcast(message);
          break;
        case "PresenceBroadcast":
          handlers.handlePresenceBroadcast(message);
          break;
        case "ChatBroadcast":
          handlers.handleChatBroadcast(message);
          break;
        case "VoiceToken":
          handlers.handleVoiceToken(message);
          break;
        case "Pong":
          // Keepalive acknowledged
          break;
        case "Error":
          handlers.handleError(message);
          break;
        case "Goodbye":
          handlers.handleGoodbye(message);
          break;
        default:
          console.warn(
            "[WS] Unknown message type:",
            (message as ServerMessage).type,
          );
      }
    } catch (error) {
      console.error("[WS] Failed to decode message:", error);
    }
  }, []);

  // Individual message handlers
  const handleWelcome = useCallback(
    (msg: Extract<ServerMessage, { type: "Welcome" }>) => {
      console.log("[WS] Welcome received, peer_id:", msg.peer_id);

      setPeerId(msg.peer_id);
      setPeerColor(msg.color);
      setSessionToken(msg.session_token);
      setUserId(msg.peer_id);

      // Reset reconnect counter on successful connection
      reconnectAttemptRef.current = 0;
      updateConnectionStatus("connected");

      // Initialize document manager with our actor ID
      if (!documentManagerRef.current) {
        documentManagerRef.current = new DocumentManager(msg.peer_id);
      }

      // Join project if we have one pending
      const projectId = projectIdRef.current;
      if (projectId) {
        const joinMsg = SyncProtocol.createJoinProject(projectId, true);
        sendBinary(joinMsg);
      }
    },
    [setUserId, updateConnectionStatus, sendBinary],
  );

  const handleProjectJoined = useCallback(
    (msg: Extract<ServerMessage, { type: "ProjectJoined" }>) => {
      console.log(
        "[WS] Joined project:",
        msg.project_id,
        "peers:",
        msg.peers.length,
      );

      setRoomId(msg.project_id);

      // Add existing peers as collaborators
      for (const peer of msg.peers) {
        addCollaborator({
          id: peer.peer_id,
          name: peer.name,
          color: peer.color,
          cursorPosition: undefined,
          isInVoiceChat: false,
        });
      }

      // Load document state if provided
      if (msg.document_state && documentManagerRef.current) {
        try {
          documentManagerRef.current.loadFromBinary(msg.document_state);
          console.log("[WS] Loaded document state from server");
        } catch (error) {
          console.error("[WS] Failed to load document state:", error);
        }
      }

      // Request initial sync
      const syncRequest = SyncProtocol.createSyncRequest(msg.project_id);
      sendBinary(syncRequest);
    },
    [setRoomId, addCollaborator, sendBinary],
  );

  const handlePeerJoined = useCallback(
    (msg: Extract<ServerMessage, { type: "PeerJoined" }>) => {
      console.log("[WS] Peer joined:", msg.peer.name);

      addCollaborator({
        id: msg.peer.peer_id,
        name: msg.peer.name,
        color: msg.peer.color,
        cursorPosition: undefined,
        isInVoiceChat: false,
      });
    },
    [addCollaborator],
  );

  const handlePeerLeft = useCallback(
    (msg: Extract<ServerMessage, { type: "PeerLeft" }>) => {
      console.log("[WS] Peer left:", msg.peer_id);

      removeCollaborator(msg.peer_id);

      // Clean up sync state for this peer
      documentManagerRef.current?.removePeer(msg.peer_id);
    },
    [removeCollaborator],
  );

  const handleProjectLeft = useCallback(
    (msg: Extract<ServerMessage, { type: "ProjectLeft" }>) => {
      console.log("[WS] Left project:", msg.project_id);
      setRoomId(null);
    },
    [setRoomId],
  );

  const handleSyncMessage = useCallback(
    (msg: Extract<ServerMessage, { type: "SyncMessage" }>) => {
      const docManager = documentManagerRef.current;
      if (!docManager) return;

      // The server is our sync peer
      const peerId = msg.from_peer || "server";

      try {
        docManager.receiveSyncMessage(peerId, msg.sync_data);

        // Check if we need to send more sync messages
        const response = docManager.generateSyncMessage(peerId);
        if (response) {
          const syncMsg = SyncProtocol.createSyncMessage(
            msg.project_id,
            response,
          );
          sendBinary(syncMsg);
        }
      } catch (error) {
        console.error("[WS] Failed to process sync message:", error);
      }
    },
    [sendBinary],
  );

  const handleSyncComplete = useCallback(
    (msg: Extract<ServerMessage, { type: "SyncComplete" }>) => {
      console.log("[WS] Sync complete for project:", msg.project_id);
    },
    [],
  );

  const handleFileContent = useCallback(
    (msg: Extract<ServerMessage, { type: "FileContent" }>) => {
      console.log("[WS] File content received:", msg.file_path);

      // Update the CRDT document with the file content
      documentManagerRef.current?.setFile(
        msg.file_path,
        msg.content,
        msg.language,
      );

      // Also update the file store for immediate UI display
      const fileId = msg.file_path;
      updateFileContent(fileId, msg.content);
    },
    [updateFileContent],
  );

  const handleFileNotFound = useCallback(
    (msg: Extract<ServerMessage, { type: "FileNotFound" }>) => {
      console.warn("[WS] File not found:", msg.file_path);
    },
    [],
  );

  const handleCursorBroadcast = useCallback(
    (msg: Extract<ServerMessage, { type: "CursorBroadcast" }>) => {
      // Skip our own cursor updates
      if (msg.peer_id === peerId) return;

      updateCursor(msg.peer_id, {
        fileId: msg.file_path,
        line: msg.line,
        column: msg.column,
      });

      // Update collaborator info
      addCollaborator({
        id: msg.peer_id,
        name: msg.peer_name,
        color: msg.peer_color,
        cursorPosition: {
          fileId: msg.file_path,
          line: msg.line,
          column: msg.column,
        },
      });
    },
    [peerId, updateCursor, addCollaborator],
  );

  const handlePresenceBroadcast = useCallback(
    (msg: Extract<ServerMessage, { type: "PresenceBroadcast" }>) => {
      if (msg.peer_id === peerId) return;

      addCollaborator({
        id: msg.peer_id,
        name: msg.peer_name,
        color: "#888888", // Default color, could be stored
        cursorPosition: msg.active_file
          ? { fileId: msg.active_file, line: 1, column: 1 }
          : undefined,
      });
    },
    [peerId, addCollaborator],
  );

  const handleChatBroadcast = useCallback(
    (msg: Extract<ServerMessage, { type: "ChatBroadcast" }>) => {
      addChatMessage({
        id: generateId(),
        userId: msg.peer_id,
        userName: msg.peer_name,
        message: msg.content,
        timestamp: msg.timestamp,
      });
    },
    [addChatMessage],
  );

  const handleVoiceToken = useCallback(
    (msg: Extract<ServerMessage, { type: "VoiceToken" }>) => {
      console.log("[WS] Voice token received for room:", msg.room_name);
      // Emit event for voice chat component to handle
      window.dispatchEvent(
        new CustomEvent("voiceToken", {
          detail: {
            token: msg.token,
            roomName: msg.room_name,
            serverUrl: msg.server_url,
          },
        }),
      );
    },
    [],
  );

  const handleError = useCallback(
    (msg: Extract<ServerMessage, { type: "Error" }>) => {
      console.error("[WS] Server error:", msg.code, msg.message);
    },
    [],
  );

  const handleGoodbye = useCallback(
    (msg: Extract<ServerMessage, { type: "Goodbye" }>) => {
      console.log("[WS] Server goodbye:", msg.reason);
    },
    [],
  );

  // ============================================================================
  // CONNECTION MANAGEMENT
  // ============================================================================

  const connect = useCallback(
    async (projectId: string, userName: string): Promise<void> => {
      // Store project context
      projectIdRef.current = projectId;
      userNameRef.current = userName;

      // Clean up existing connection
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      // Clear any pending reconnect
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      updateConnectionStatus("connecting");

      return new Promise((resolve, reject) => {
        try {
          // Build WebSocket URL - must include project_id in path
          const wsUrl = serverUrl.startsWith("ws")
            ? `${serverUrl}/ws/${projectId}`
            : `ws://${serverUrl.replace(/^https?:\/\//, "")}/ws/${projectId}`;

          console.log("[WS] Connecting to:", wsUrl);

          const ws = new WebSocket(wsUrl);
          ws.binaryType = "arraybuffer";
          wsRef.current = ws;

          ws.onopen = () => {
            console.log("[WS] Connected");

            // Send Hello message
            const helloMsg = SyncProtocol.createHello(
              userName,
              peerId ?? undefined,
              sessionToken ?? undefined,
            );
            ws.send(helloMsg);

            // Set up ping interval
            pingIntervalRef.current = setInterval(() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(SyncProtocol.createPing());
              }
            }, PING_INTERVAL);

            resolve();
          };

          ws.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer) {
              handleServerMessage(event.data);
            } else {
              console.warn("[WS] Received non-binary message, ignoring");
            }
          };

          ws.onerror = (error) => {
            console.error("[WS] Error:", error);
            updateConnectionStatus("error");
            reject(error);
          };

          ws.onclose = (event) => {
            console.log("[WS] Closed:", event.code, event.reason);

            // Clear ping interval
            if (pingIntervalRef.current) {
              clearInterval(pingIntervalRef.current);
              pingIntervalRef.current = null;
            }

            // Update status
            if (autoReconnect && projectIdRef.current) {
              updateConnectionStatus("reconnecting");
              scheduleReconnect();
            } else {
              updateConnectionStatus("disconnected");
            }
          };
        } catch (error) {
          console.error("[WS] Connection error:", error);
          updateConnectionStatus("error");
          reject(error);
        }
      });
    },
    [
      serverUrl,
      peerId,
      sessionToken,
      autoReconnect,
      updateConnectionStatus,
      handleServerMessage,
    ],
  );

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) return;

    const attempt = reconnectAttemptRef.current;
    const delay = Math.min(
      RECONNECT_DELAY * Math.pow(2, attempt),
      MAX_RECONNECT_DELAY,
    );

    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${attempt + 1})`);

    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectTimeoutRef.current = null;
      reconnectAttemptRef.current++;

      const projectId = projectIdRef.current;
      const userName = userNameRef.current;

      if (projectId) {
        connect(projectId, userName).catch((error) => {
          console.error("[WS] Reconnection failed:", error);
        });
      }
    }, delay);
  }, [connect]);

  const disconnect = useCallback(() => {
    // Clear auto-reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Clear ping interval
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }

    // Clear sync timeout
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }

    // Clear project context to prevent auto-reconnect
    projectIdRef.current = null;

    // Send goodbye and close
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(SyncProtocol.createGoodbye("User disconnected"));
      wsRef.current.close(1000, "User disconnected");
    }
    wsRef.current = null;

    // Reset state
    updateConnectionStatus("disconnected");
    setRoomId(null);
    documentManagerRef.current?.reset();
  }, [updateConnectionStatus, setRoomId]);

  // ============================================================================
  // FILE OPERATIONS
  // ============================================================================

  const openFile = useCallback(
    (filePath: string) => {
      const projectId = projectIdRef.current;
      if (!projectId) return;

      const msg = SyncProtocol.createOpenFile(projectId, filePath);
      sendBinary(msg);
    },
    [sendBinary],
  );

  const closeFile = useCallback(
    (filePath: string) => {
      const projectId = projectIdRef.current;
      if (!projectId) return;

      const msg = SyncProtocol.createCloseFile(projectId, filePath);
      sendBinary(msg);
    },
    [sendBinary],
  );

  // ============================================================================
  // CURSOR & PRESENCE
  // ============================================================================

  const sendCursorUpdate = useCallback(
    (
      filePath: string,
      line: number,
      column: number,
      selectionEnd?: [number, number],
    ) => {
      const projectId = projectIdRef.current;
      if (!projectId) return;

      const msg = SyncProtocol.createCursorUpdate(
        projectId,
        filePath,
        line,
        column,
        selectionEnd,
      );
      sendBinary(msg);
    },
    [sendBinary],
  );

  const sendPresenceUpdate = useCallback(
    (status: PresenceStatus, activeFile?: string) => {
      const projectId = projectIdRef.current;
      if (!projectId) return;

      const msg = SyncProtocol.createPresenceUpdate(
        projectId,
        status,
        activeFile,
      );
      sendBinary(msg);
    },
    [sendBinary],
  );

  // ============================================================================
  // CHAT
  // ============================================================================

  const sendChatMessage = useCallback(
    (content: string) => {
      const projectId = projectIdRef.current;
      if (!projectId) return;

      const msg = SyncProtocol.createChatMessage(projectId, content);
      sendBinary(msg);

      // Optimistically add to local chat
      addChatMessage({
        id: generateId(),
        userId: peerId || "unknown",
        userName: userNameRef.current,
        message: content,
        timestamp: Date.now(),
      });
    },
    [sendBinary, addChatMessage, peerId],
  );

  // ============================================================================
  // VOICE
  // ============================================================================

  const joinVoiceChat = useCallback(() => {
    const projectId = projectIdRef.current;
    if (!projectId) return;

    const msg = SyncProtocol.createVoiceJoin(projectId);
    sendBinary(msg);
  }, [sendBinary]);

  const leaveVoiceChat = useCallback(() => {
    const projectId = projectIdRef.current;
    if (!projectId) return;

    const msg = SyncProtocol.createVoiceLeave(projectId);
    sendBinary(msg);
  }, [sendBinary]);

  // ============================================================================
  // SYNC
  // ============================================================================

  const requestSync = useCallback(() => {
    const projectId = projectIdRef.current;
    if (!projectId) return;

    const msg = SyncProtocol.createSyncRequest(projectId);
    sendBinary(msg);
  }, [sendBinary]);

  // ============================================================================
  // DOCUMENT CHANGE SUBSCRIPTION
  // ============================================================================

  useEffect(() => {
    const docManager = documentManagerRef.current;
    if (!docManager) return;

    // Subscribe to document changes and schedule sync
    const unsubscribe = docManager.onChange(() => {
      scheduleSyncMessage();
    });

    return unsubscribe;
  }, [scheduleSyncMessage]);

  // ============================================================================
  // KEEP HANDLERS REF UPDATED
  // ============================================================================

  useEffect(() => {
    handlersRef.current = {
      handleWelcome,
      handleProjectJoined,
      handlePeerJoined,
      handlePeerLeft,
      handleProjectLeft,
      handleSyncMessage,
      handleSyncComplete,
      handleFileContent,
      handleFileNotFound,
      handleCursorBroadcast,
      handlePresenceBroadcast,
      handleChatBroadcast,
      handleVoiceToken,
      handleError,
      handleGoodbye,
    };
  }, [
    handleWelcome,
    handleProjectJoined,
    handlePeerJoined,
    handlePeerLeft,
    handleProjectLeft,
    handleSyncMessage,
    handleSyncComplete,
    handleFileContent,
    handleFileNotFound,
    handleCursorBroadcast,
    handlePresenceBroadcast,
    handleChatBroadcast,
    handleVoiceToken,
    handleError,
    handleGoodbye,
  ]);

  // ============================================================================
  // CLEANUP
  // ============================================================================

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  // ============================================================================
  // RETURN VALUE
  // ============================================================================

  return {
    // Connection state
    connectionStatus,
    isConnected: connectionStatus === "connected",
    peerId,
    peerColor,

    // Document manager
    documentManager: documentManagerRef.current,

    // Connection methods
    connect,
    disconnect,

    // File operations
    openFile,
    closeFile,

    // Cursor & presence
    sendCursorUpdate,
    sendPresenceUpdate,

    // Chat
    sendChatMessage,

    // Voice
    joinVoiceChat,
    leaveVoiceChat,

    // Sync
    requestSync,
  };
}

// ============================================================================
// UTILITY FUNCTIONS (exported for backward compatibility)
// ============================================================================

export async function createRoom(
  serverUrl: string,
  name: string,
): Promise<{ roomId: string; roomName: string }> {
  const baseUrl = serverUrl.replace(/^ws/, "http").replace(/\/ws$/, "");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${baseUrl}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      return {
        roomId: data.project_id || data.room_id || data.id,
        roomName: data.name || name,
      };
    }

    throw new Error(`Failed to create room: ${response.statusText}`);
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export async function checkServerHealth(
  serverUrl: string,
): Promise<{ healthy: boolean; version?: string }> {
  const baseUrl = serverUrl.replace(/^ws/, "http").replace(/\/ws$/, "");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      return { healthy: true, version: data.version };
    }

    return { healthy: false };
  } catch {
    clearTimeout(timeoutId);
    return { healthy: false };
  }
}

export async function getRoomInfo(
  serverUrl: string,
  roomId: string,
): Promise<{ exists: boolean; userCount: number }> {
  const baseUrl = serverUrl.replace(/^ws/, "http").replace(/\/ws$/, "");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${baseUrl}/api/rooms/${roomId}`, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      return {
        exists: true,
        userCount: data.user_count || data.peers?.length || 0,
      };
    }

    return { exists: false, userCount: 0 };
  } catch {
    clearTimeout(timeoutId);
    return { exists: false, userCount: 0 };
  }
}

export default useCollaboration;
