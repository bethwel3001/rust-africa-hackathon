import { create } from "zustand";
import { FileNode, FileContent, HttpHeader, HttpResponse } from "../lib/tauri";
import type { DocumentManager } from "../lib/automerge";

// ============================================================================
// TYPES
// ============================================================================

export interface Collaborator {
  id: string;
  name: string;
  color: string;
  avatar?: string;
  cursorPosition?: CursorPosition;
  isInVoiceChat?: boolean;
}

export interface CursorPosition {
  fileId: string;
  line: number;
  column: number;
}

export interface OpenFile {
  id: string;
  path: string;
  name: string;
  content: string;
  language: string;
  isDirty: boolean;
  version: number;
}

export interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  message: string;
  timestamp: number;
}

export interface ApiRequest {
  id: string;
  name: string;
  method: string;
  url: string;
  headers: HttpHeader[];
  body: string;
}

export interface ApiHistoryItem {
  id: string;
  request: ApiRequest;
  response: HttpResponse | null;
  timestamp: number;
}

// ============================================================================
// FILE STORE
// ============================================================================

interface FileStore {
  // Project state
  projectRoot: FileNode | null;
  projectPath: string | null;
  expandedFolders: Set<string>;

  // Open files
  openFiles: OpenFile[];
  activeFileId: string | null;

  // Actions
  setProjectRoot: (root: FileNode | null) => void;
  setProjectPath: (path: string | null) => void;
  toggleFolder: (path: string) => void;
  expandFolder: (path: string) => void;
  collapseFolder: (path: string) => void;

  openFile: (file: OpenFile) => void;
  closeFile: (fileId: string) => void;
  setActiveFile: (fileId: string) => void;
  updateFileContent: (fileId: string, content: string) => void;
  markFileSaved: (fileId: string) => void;
  updateFileNode: (path: string, node: FileNode) => void;
  removeFileNode: (path: string) => void;
}

export const useFileStore = create<FileStore>((set, get) => ({
  projectRoot: null,
  projectPath: null,
  expandedFolders: new Set<string>(),
  openFiles: [],
  activeFileId: null,

  setProjectRoot: (root) => set({ projectRoot: root }),
  setProjectPath: (path) => set({ projectPath: path }),

  toggleFolder: (path) =>
    set((state) => {
      const newExpanded = new Set(state.expandedFolders);
      if (newExpanded.has(path)) {
        newExpanded.delete(path);
      } else {
        newExpanded.add(path);
      }
      return { expandedFolders: newExpanded };
    }),

  expandFolder: (path) =>
    set((state) => {
      const newExpanded = new Set(state.expandedFolders);
      newExpanded.add(path);
      return { expandedFolders: newExpanded };
    }),

  collapseFolder: (path) =>
    set((state) => {
      const newExpanded = new Set(state.expandedFolders);
      newExpanded.delete(path);
      return { expandedFolders: newExpanded };
    }),

  openFile: (file) =>
    set((state) => {
      const exists = state.openFiles.find((f) => f.id === file.id);
      if (exists) {
        return { activeFileId: file.id };
      }
      return {
        openFiles: [...state.openFiles, file],
        activeFileId: file.id,
      };
    }),

  closeFile: (fileId) =>
    set((state) => {
      const newOpenFiles = state.openFiles.filter((f) => f.id !== fileId);
      let newActiveId = state.activeFileId;

      if (state.activeFileId === fileId) {
        const idx = state.openFiles.findIndex((f) => f.id === fileId);
        if (newOpenFiles.length > 0) {
          newActiveId =
            newOpenFiles[Math.max(0, idx - 1)]?.id || newOpenFiles[0]?.id;
        } else {
          newActiveId = null;
        }
      }

      return {
        openFiles: newOpenFiles,
        activeFileId: newActiveId,
      };
    }),

  setActiveFile: (fileId) => set({ activeFileId: fileId }),

  updateFileContent: (fileId, content) =>
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.id === fileId ? { ...f, content, isDirty: true } : f,
      ),
    })),

  markFileSaved: (fileId) =>
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.id === fileId ? { ...f, isDirty: false } : f,
      ),
    })),

  updateFileNode: (path, node) =>
    set((state) => {
      if (!state.projectRoot) return state;
      // Recursively update the node in the tree
      const updateNode = (current: FileNode): FileNode => {
        if (current.path === path) {
          return node;
        }
        if (current.children) {
          return {
            ...current,
            children: current.children.map(updateNode),
          };
        }
        return current;
      };
      return { projectRoot: updateNode(state.projectRoot) };
    }),

  removeFileNode: (path) =>
    set((state) => {
      if (!state.projectRoot) return state;
      const removeNode = (current: FileNode): FileNode => {
        if (current.children) {
          return {
            ...current,
            children: current.children
              .filter((c) => c.path !== path)
              .map(removeNode),
          };
        }
        return current;
      };
      return { projectRoot: removeNode(state.projectRoot) };
    }),
}));

// ============================================================================
// COLLABORATION STORE
// ============================================================================

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export interface PeerPresence {
  peerId: string;
  name: string;
  color: string;
  status: "active" | "idle" | "away" | "offline";
  activeFile: string | null;
  lastActive: number;
}

interface CollaborationStore {
  // Connection state
  isConnected: boolean;
  connectionStatus: ConnectionStatus;
  roomId: string | null;
  userId: string | null;
  userName: string;
  userColor: string | null;
  sessionToken: string | null;

  // Collaborators
  collaborators: Collaborator[];
  remoteCursors: Map<string, CursorPosition>;
  peerPresence: Map<string, PeerPresence>;

  // Voice chat
  isInVoiceChat: boolean;
  isMuted: boolean;
  voiceToken: string | null;
  voiceRoomName: string | null;
  voiceServerUrl: string | null;

  // Chat
  chatMessages: ChatMessage[];

  // Server URL
  serverUrl: string;

  // Document manager reference (not stored in zustand, managed externally)
  documentManagerRef: DocumentManager | null;

  // Actions
  setConnected: (connected: boolean) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setRoomId: (roomId: string | null) => void;
  setUserId: (userId: string | null) => void;
  setUserName: (name: string) => void;
  setUserColor: (color: string | null) => void;
  setSessionToken: (token: string | null) => void;
  setServerUrl: (url: string) => void;

  addCollaborator: (collaborator: Collaborator) => void;
  removeCollaborator: (userId: string) => void;
  clearCollaborators: () => void;
  updateCursor: (userId: string, position: CursorPosition) => void;
  updatePeerPresence: (presence: PeerPresence) => void;
  removePeerPresence: (peerId: string) => void;

  setVoiceChat: (active: boolean) => void;
  setMuted: (muted: boolean) => void;
  setVoiceToken: (
    token: string | null,
    roomName: string | null,
    serverUrl: string | null,
  ) => void;

  addChatMessage: (message: ChatMessage) => void;
  clearChat: () => void;

  setDocumentManager: (manager: DocumentManager | null) => void;

  // Reset all collaboration state
  resetCollaboration: () => void;
}

export const useCollaborationStore = create<CollaborationStore>((set) => ({
  isConnected: false,
  connectionStatus: "disconnected",
  roomId: null,
  userId: null,
  userName: "Anonymous",
  userColor: null,
  sessionToken: null,
  collaborators: [],
  remoteCursors: new Map(),
  peerPresence: new Map(),
  isInVoiceChat: false,
  isMuted: false,
  voiceToken: null,
  voiceRoomName: null,
  voiceServerUrl: null,
  chatMessages: [],
  serverUrl: "ws://localhost:5000",
  documentManagerRef: null,

  setConnected: (connected) => set({ isConnected: connected }),
  setConnectionStatus: (status) =>
    set({
      connectionStatus: status,
      isConnected: status === "connected",
    }),
  setRoomId: (roomId) => set({ roomId }),
  setUserId: (userId) => set({ userId }),
  setUserName: (name) => set({ userName: name }),
  setUserColor: (color) => set({ userColor: color }),
  setSessionToken: (token) => set({ sessionToken: token }),
  setServerUrl: (url) => set({ serverUrl: url }),

  addCollaborator: (collaborator) =>
    set((state) => {
      const exists = state.collaborators.find((c) => c.id === collaborator.id);
      if (exists) {
        return {
          collaborators: state.collaborators.map((c) =>
            c.id === collaborator.id ? { ...c, ...collaborator } : c,
          ),
        };
      }
      return { collaborators: [...state.collaborators, collaborator] };
    }),

  removeCollaborator: (userId) =>
    set((state) => ({
      collaborators: state.collaborators.filter((c) => c.id !== userId),
      remoteCursors: new Map(
        [...state.remoteCursors].filter(([k]) => k !== userId),
      ),
      peerPresence: new Map(
        [...state.peerPresence].filter(([k]) => k !== userId),
      ),
    })),

  clearCollaborators: () =>
    set({
      collaborators: [],
      remoteCursors: new Map(),
      peerPresence: new Map(),
    }),

  updateCursor: (userId, position) =>
    set((state) => {
      const newCursors = new Map(state.remoteCursors);
      newCursors.set(userId, position);
      return { remoteCursors: newCursors };
    }),

  updatePeerPresence: (presence) =>
    set((state) => {
      const newPresence = new Map(state.peerPresence);
      newPresence.set(presence.peerId, presence);
      return { peerPresence: newPresence };
    }),

  removePeerPresence: (peerId) =>
    set((state) => {
      const newPresence = new Map(state.peerPresence);
      newPresence.delete(peerId);
      return { peerPresence: newPresence };
    }),

  setVoiceChat: (active) => set({ isInVoiceChat: active }),
  setMuted: (muted) => set({ isMuted: muted }),
  setVoiceToken: (token, roomName, serverUrl) =>
    set({
      voiceToken: token,
      voiceRoomName: roomName,
      voiceServerUrl: serverUrl,
    }),

  addChatMessage: (message) =>
    set((state) => ({
      chatMessages: [...state.chatMessages, message].slice(-100), // Keep last 100 messages
    })),

  clearChat: () => set({ chatMessages: [] }),

  setDocumentManager: (manager) => set({ documentManagerRef: manager }),

  resetCollaboration: () =>
    set({
      isConnected: false,
      connectionStatus: "disconnected",
      roomId: null,
      collaborators: [],
      remoteCursors: new Map(),
      peerPresence: new Map(),
      isInVoiceChat: false,
      voiceToken: null,
      voiceRoomName: null,
      voiceServerUrl: null,
      chatMessages: [],
      documentManagerRef: null,
    }),
}));

// ============================================================================
// API TESTER STORE
// ============================================================================

interface ApiTesterStore {
  // Current request
  method: string;
  url: string;
  headers: HttpHeader[];
  body: string;

  // Response
  response: HttpResponse | null;
  isLoading: boolean;
  error: string | null;

  // History
  history: ApiHistoryItem[];

  // Saved requests
  savedRequests: ApiRequest[];

  // Actions
  setMethod: (method: string) => void;
  setUrl: (url: string) => void;
  setHeaders: (headers: HttpHeader[]) => void;
  addHeader: () => void;
  updateHeader: (index: number, header: HttpHeader) => void;
  removeHeader: (index: number) => void;
  setBody: (body: string) => void;

  setResponse: (response: HttpResponse | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  addToHistory: (item: ApiHistoryItem) => void;
  clearHistory: () => void;

  saveRequest: (request: ApiRequest) => void;
  deleteRequest: (id: string) => void;
  loadRequest: (request: ApiRequest) => void;
}

export const useApiTesterStore = create<ApiTesterStore>((set) => ({
  method: "GET",
  url: "https://jsonplaceholder.typicode.com/posts/1",
  headers: [{ key: "Content-Type", value: "application/json", enabled: true }],
  body: "{\n  \n}",
  response: null,
  isLoading: false,
  error: null,
  history: [],
  savedRequests: [],

  setMethod: (method) => set({ method }),
  setUrl: (url) => set({ url }),
  setHeaders: (headers) => set({ headers }),

  addHeader: () =>
    set((state) => ({
      headers: [...state.headers, { key: "", value: "", enabled: true }],
    })),

  updateHeader: (index, header) =>
    set((state) => ({
      headers: state.headers.map((h, i) => (i === index ? header : h)),
    })),

  removeHeader: (index) =>
    set((state) => ({
      headers: state.headers.filter((_, i) => i !== index),
    })),

  setBody: (body) => set({ body }),
  setResponse: (response) => set({ response }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),

  addToHistory: (item) =>
    set((state) => ({
      history: [item, ...state.history].slice(0, 50), // Keep last 50
    })),

  clearHistory: () => set({ history: [] }),

  saveRequest: (request) =>
    set((state) => ({
      savedRequests: [...state.savedRequests, request],
    })),

  deleteRequest: (id) =>
    set((state) => ({
      savedRequests: state.savedRequests.filter((r) => r.id !== id),
    })),

  loadRequest: (request) =>
    set({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: request.body,
    }),
}));

// ============================================================================
// UI STORE
// ============================================================================

interface UiStore {
  // View state
  activeView: "files" | "testing" | "chat";
  sidebarCollapsed: boolean;
  showCollaborators: boolean;
  showChat: boolean;

  // Modals
  showSettings: boolean;
  showJoinRoom: boolean;
  showCreateRoom: boolean;

  // Actions
  setActiveView: (view: "files" | "testing" | "chat") => void;
  toggleSidebar: () => void;
  toggleCollaborators: () => void;
  toggleChat: () => void;
  setShowSettings: (show: boolean) => void;
  setShowJoinRoom: (show: boolean) => void;
  setShowCreateRoom: (show: boolean) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  activeView: "files",
  sidebarCollapsed: false,
  showCollaborators: true,
  showChat: false,
  showSettings: false,
  showJoinRoom: false,
  showCreateRoom: false,

  setActiveView: (view) => set({ activeView: view }),
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  toggleCollaborators: () =>
    set((state) => ({ showCollaborators: !state.showCollaborators })),
  toggleChat: () => set((state) => ({ showChat: !state.showChat })),
  setShowSettings: (show) => set({ showSettings: show }),
  setShowJoinRoom: (show) => set({ showJoinRoom: show }),
  setShowCreateRoom: (show) => set({ showCreateRoom: show }),
}));
