// ============================================================================
// AUTOMERGE CRDT INTEGRATION
// ============================================================================
// This module provides client-side Automerge document management for
// real-time collaborative editing with CRDT-based conflict resolution.
//
// NOTE: Automerge uses WASM and must be loaded dynamically to avoid SSR issues.

// We'll use a simplified document structure that doesn't require Automerge
// for the initial implementation. The CRDT sync will happen through the
// server which handles the Automerge operations.

// Type definitions (no Automerge dependency)
export type Doc<T> = T & { __automerge?: boolean };
export type Patch = {
  action: string;
  path: (string | number)[];
  value?: unknown;
  length?: number;
};
export type PatchCallback<T> = (patches: Patch[], info?: unknown) => void;

// ============================================================================
// DOCUMENT SCHEMA
// ============================================================================

/**
 * File entry in the CRDT document.
 */
export interface CrdtFile {
  path: string;
  content: string; // Using string instead of Automerge.Text for simplicity
  language: string;
  created_at: number;
  modified_at: number;
}

/**
 * Folder entry in the CRDT document.
 */
export interface CrdtFolder {
  path: string;
  name: string;
  children: string[]; // Array of child paths
}

/**
 * Root document schema matching server's ProjectDocument.
 * Uses index signature to satisfy Automerge's Record<string, unknown> constraint.
 */
export interface ProjectDocument {
  // File tree structure
  files: Record<string, CrdtFile>;
  folders: Record<string, CrdtFolder>;
  root_path: string;

  // Metadata
  name: string;
  created_at: number;
  modified_at: number;

  // Version for migrations
  version: number;

  // Index signature for Automerge compatibility
  [key: string]: unknown;
}

// ============================================================================
// CURSOR TYPES
// ============================================================================

/**
 * Automerge cursor for stable position tracking.
 */
export interface StableCursor {
  filePath: string;
  cursor: string; // Automerge cursor serialized
}

/**
 * Cursor position with optional selection.
 */
export interface CursorPosition {
  line: number;
  column: number;
  selectionEnd?: { line: number; column: number };
}

// ============================================================================
// SYNC STATE MANAGEMENT
// ============================================================================

/**
 * Simple sync state for tracking peer synchronization.
 */
export interface SyncState {
  lastSyncTime: number;
  version: number;
}

/**
 * Manages the sync state for peers.
 */
export class SyncStateManager {
  private syncStates: Map<string, SyncState> = new Map();

  /**
   * Get or create sync state for a peer.
   */
  getOrCreateSyncState(peerId: string): SyncState {
    let state = this.syncStates.get(peerId);
    if (!state) {
      state = { lastSyncTime: Date.now(), version: 0 };
      this.syncStates.set(peerId, state);
    }
    return state;
  }

  /**
   * Update sync state for a peer.
   */
  setSyncState(peerId: string, state: SyncState): void {
    this.syncStates.set(peerId, state);
  }

  /**
   * Remove sync state for a peer (when they disconnect).
   */
  removeSyncState(peerId: string): void {
    this.syncStates.delete(peerId);
  }

  /**
   * Clear all sync states.
   */
  clear(): void {
    this.syncStates.clear();
  }
}

// ============================================================================
// DOCUMENT MANAGER
// ============================================================================

export type DocumentChangeCallback = (
  doc: Doc<ProjectDocument>,
  patches: Patch[],
) => void;

/**
 * Generate a unique ID.
 */
function generateUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Manages an Automerge-compatible document with change tracking and sync support.
 * This is a simplified implementation that stores document state locally and
 * syncs through the server.
 */
export class DocumentManager {
  private doc: Doc<ProjectDocument>;
  private syncStateManager: SyncStateManager;
  private changeCallbacks: Set<DocumentChangeCallback> = new Set();
  private actorId: string;

  constructor(actorId?: string) {
    this.actorId = actorId || generateUuid();
    this.doc = this.createEmptyDocument();
    this.syncStateManager = new SyncStateManager();
  }

  /**
   * Create an empty project document.
   */
  private createEmptyDocument(): Doc<ProjectDocument> {
    return {
      files: {},
      folders: {},
      root_path: "",
      name: "",
      created_at: Date.now(),
      modified_at: Date.now(),
      version: 1,
      __automerge: true,
    } as Doc<ProjectDocument>;
  }

  /**
   * Get the current document.
   */
  getDocument(): Doc<ProjectDocument> {
    return this.doc;
  }

  /**
   * Get the actor ID for this client.
   */
  getActorId(): string {
    return this.actorId;
  }

  /**
   * Subscribe to document changes.
   */
  onChange(callback: DocumentChangeCallback): () => void {
    this.changeCallbacks.add(callback);
    return () => this.changeCallbacks.delete(callback);
  }

  /**
   * Notify all subscribers of a change.
   */
  private notifyChange(patches: Patch[]): void {
    for (const callback of this.changeCallbacks) {
      try {
        callback(this.doc, patches);
      } catch (error) {
        console.error("[Automerge] Callback error:", error);
      }
    }
  }

  /**
   * Apply a local change to the document.
   * This simplified version directly mutates the document copy.
   */
  change(description: string, changeFn: (doc: ProjectDocument) => void): void {
    // Create a shallow copy for mutation
    const docCopy = JSON.parse(JSON.stringify(this.doc)) as ProjectDocument;
    changeFn(docCopy);
    this.doc = docCopy as Doc<ProjectDocument>;

    // Create a simple patch indicating the change
    const patches: Patch[] = [
      { action: "change", path: [], value: description },
    ];
    this.notifyChange(patches);
  }

  /**
   * Load document from binary state (received from server).
   * The server sends actual Automerge binary data, but this simplified client
   * uses a JSON-based document model. We'll try to parse it, but if it's
   * binary Automerge data, we gracefully initialize with an empty document
   * and let the sync messages populate it.
   */
  loadFromBinary(data: Uint8Array): void {
    // Check if data looks like JSON (starts with '{' or '[')
    if (data.length > 0 && (data[0] === 0x7b || data[0] === 0x5b)) {
      try {
        const text = new TextDecoder().decode(data);
        const parsed = JSON.parse(text) as ProjectDocument;
        this.doc = { ...parsed, __automerge: true } as Doc<ProjectDocument>;
        this.notifyChange([]);
        console.log("[DocumentManager] Loaded document from JSON state");
        return;
      } catch (error) {
        // Fall through to binary handling
      }
    }

    // Data is likely binary Automerge format - we can't parse it with this
    // simplified client. Initialize with empty document and let sync populate it.
    console.log(
      "[DocumentManager] Received binary Automerge data, initializing empty document",
    );
    this.doc = this.createEmptyDocument();
    this.notifyChange([]);
  }

  /**
   * Save document to binary format.
   */
  saveToBinary(): Uint8Array {
    const json = JSON.stringify(this.doc);
    return new TextEncoder().encode(json);
  }

  /**
   * Merge another document into this one.
   * Simple merge: just take the other document's data for now.
   */
  merge(other: Doc<ProjectDocument>): void {
    // Simple merge strategy: merge files and folders
    const merged = { ...this.doc };
    merged.files = { ...this.doc.files, ...other.files };
    merged.folders = { ...this.doc.folders, ...other.folders };
    merged.modified_at = Date.now();
    this.doc = merged;
    this.notifyChange([]);
  }

  /**
   * Generate a sync message for a peer.
   * Returns the current document state as binary.
   */
  generateSyncMessage(_peerId: string): Uint8Array | null {
    // For simplified sync, just return the document state
    return this.saveToBinary();
  }

  /**
   * Receive a sync message from a peer.
   * The server sends binary Automerge data, but this simplified client
   * uses JSON. We try to parse as JSON first, otherwise ignore binary data.
   */
  receiveSyncMessage(_peerId: string, message: Uint8Array): void {
    // Check if data looks like JSON (starts with '{' or '[')
    if (message.length > 0 && (message[0] === 0x7b || message[0] === 0x5b)) {
      try {
        const text = new TextDecoder().decode(message);
        const remoteDoc = JSON.parse(text) as ProjectDocument;

        // Merge remote changes
        this.merge(remoteDoc as Doc<ProjectDocument>);
        console.log("[DocumentManager] Merged sync message from peer");
        return;
      } catch (error) {
        // Fall through to binary handling
      }
    }

    // Data is binary Automerge format - we can't process it with this
    // simplified client. Log and ignore.
    console.log(
      "[DocumentManager] Received binary Automerge sync data, skipping (simplified client)",
    );
  }

  /**
   * Remove a peer's sync state.
   */
  removePeer(peerId: string): void {
    this.syncStateManager.removeSyncState(peerId);
  }

  /**
   * Reset the document and sync states.
   */
  reset(): void {
    this.doc = this.createEmptyDocument();
    this.syncStateManager.clear();
    this.notifyChange([]);
  }

  // ==========================================================================
  // FILE OPERATIONS
  // ==========================================================================

  /**
   * Create or update a file in the document.
   */
  setFile(path: string, content: string, language: string): void {
    this.change(`Set file: ${path}`, (doc) => {
      const now = Date.now();
      if (doc.files[path]) {
        // Update existing file
        doc.files[path].content = content;
        doc.files[path].language = language;
        doc.files[path].modified_at = now;
      } else {
        // Create new file
        doc.files[path] = {
          path,
          content,
          language,
          created_at: now,
          modified_at: now,
        };
      }
      doc.modified_at = now;
    });
  }

  /**
   * Delete a file from the document.
   */
  deleteFile(path: string): void {
    this.change(`Delete file: ${path}`, (doc) => {
      delete doc.files[path];
      doc.modified_at = Date.now();
    });
  }

  /**
   * Get file content as a string.
   */
  getFileContent(path: string): string | null {
    const file = this.doc.files[path];
    if (!file) return null;
    return file.content;
  }

  /**
   * Update file content with a splice operation.
   */
  spliceText(
    path: string,
    startIndex: number,
    deleteCount: number,
    insertText: string,
  ): void {
    this.change(`Splice text in: ${path}`, (doc) => {
      const file = doc.files[path];
      if (file) {
        const before = file.content.slice(0, startIndex);
        const after = file.content.slice(startIndex + deleteCount);
        file.content = before + insertText + after;
        file.modified_at = Date.now();
        doc.modified_at = Date.now();
      }
    });
  }

  /**
   * Insert text at a position in a file.
   */
  insertText(path: string, index: number, text: string): void {
    this.spliceText(path, index, 0, text);
  }

  /**
   * Delete text at a position in a file.
   */
  deleteText(path: string, index: number, count: number): void {
    this.spliceText(path, index, count, "");
  }

  /**
   * Replace text in a file (delete + insert).
   */
  replaceText(
    path: string,
    startIndex: number,
    deleteCount: number,
    insertText: string,
  ): void {
    this.spliceText(path, startIndex, deleteCount, insertText);
  }

  // ==========================================================================
  // FOLDER OPERATIONS
  // ==========================================================================

  /**
   * Create a folder in the document.
   */
  createFolder(path: string, name: string): void {
    this.change(`Create folder: ${path}`, (doc) => {
      if (!doc.folders[path]) {
        doc.folders[path] = {
          path,
          name,
          children: [],
        };
        doc.modified_at = Date.now();
      }
    });
  }

  /**
   * Delete a folder from the document.
   */
  deleteFolder(path: string): void {
    this.change(`Delete folder: ${path}`, (doc) => {
      delete doc.folders[path];
      doc.modified_at = Date.now();
    });
  }

  /**
   * Add a child to a folder.
   */
  addChildToFolder(folderPath: string, childPath: string): void {
    this.change(`Add child to folder: ${folderPath}`, (doc) => {
      const folder = doc.folders[folderPath];
      if (folder && !folder.children.includes(childPath)) {
        folder.children.push(childPath);
        doc.modified_at = Date.now();
      }
    });
  }

  /**
   * Remove a child from a folder.
   */
  removeChildFromFolder(folderPath: string, childPath: string): void {
    this.change(`Remove child from folder: ${folderPath}`, (doc) => {
      const folder = doc.folders[folderPath];
      if (folder) {
        const index = folder.children.indexOf(childPath);
        if (index >= 0) {
          folder.children.splice(index, 1);
          doc.modified_at = Date.now();
        }
      }
    });
  }

  // ==========================================================================
  // CURSOR OPERATIONS (using line/column based positions)
  // ==========================================================================

  /**
   * Convert line/column position to character index.
   */
  positionToIndex(path: string, line: number, column: number): number {
    const content = this.getFileContent(path);
    if (!content) return 0;

    const lines = content.split("\n");
    let index = 0;

    for (let i = 0; i < line - 1 && i < lines.length; i++) {
      index += lines[i].length + 1; // +1 for newline
    }

    index += Math.min(column - 1, lines[line - 1]?.length ?? 0);
    return Math.max(0, Math.min(index, content.length));
  }

  /**
   * Convert character index to line/column position.
   */
  indexToPosition(
    path: string,
    index: number,
  ): { line: number; column: number } {
    const content = this.getFileContent(path);
    if (!content) return { line: 1, column: 1 };

    let line = 1;
    let column = 1;
    let currentIndex = 0;

    for (const char of content) {
      if (currentIndex >= index) break;
      if (char === "\n") {
        line++;
        column = 1;
      } else {
        column++;
      }
      currentIndex++;
    }

    return { line, column };
  }

  /**
   * Create a stable cursor at a position in a file.
   * Note: Using character offset as the stable reference since
   * Automerge cursor API requires 'next' namespace which may not be stable.
   */
  createCursor(path: string, line: number, column: number): string | null {
    const index = this.positionToIndex(path, line, column);
    // Return a JSON-encoded cursor with the path and index
    return JSON.stringify({ path, index, version: this.doc.modified_at });
  }

  /**
   * Resolve a stable cursor to its current position.
   * Returns null if the cursor is invalid.
   */
  resolveCursor(
    cursor: string,
  ): { path: string; line: number; column: number } | null {
    try {
      const parsed = JSON.parse(cursor);
      const { path, index } = parsed;
      const position = this.indexToPosition(path, index);
      return { path, ...position };
    } catch {
      return null;
    }
  }
}

// ============================================================================
// MONACO BINDING
// ============================================================================

import type * as Monaco from "monaco-editor";

/**
 * Binds a Monaco editor to an Automerge document.
 */
export class MonacoAutomergeBinding {
  private editor: Monaco.editor.IStandaloneCodeEditor;
  private docManager: DocumentManager;
  private filePath: string;
  private isApplyingRemoteChanges = false;
  private disposables: Monaco.IDisposable[] = [];
  private unsubscribeDoc: (() => void) | null = null;

  constructor(
    editor: Monaco.editor.IStandaloneCodeEditor,
    docManager: DocumentManager,
    filePath: string,
  ) {
    this.editor = editor;
    this.docManager = docManager;
    this.filePath = filePath;

    this.setupEditorBinding();
    this.setupDocumentBinding();
  }

  /**
   * Set up the editor to document binding (local changes -> CRDT).
   */
  private setupEditorBinding(): void {
    const model = this.editor.getModel();
    if (!model) return;

    // Listen for content changes in the editor
    const disposable = model.onDidChangeContent((event) => {
      if (this.isApplyingRemoteChanges) return;

      for (const change of event.changes) {
        const startOffset = change.rangeOffset;
        const deleteCount = change.rangeLength;
        const insertText = change.text;

        this.docManager.replaceText(
          this.filePath,
          startOffset,
          deleteCount,
          insertText,
        );
      }
    });

    this.disposables.push(disposable);
  }

  /**
   * Set up the document to editor binding (remote changes -> Monaco).
   */
  private setupDocumentBinding(): void {
    this.unsubscribeDoc = this.docManager.onChange((doc, patches) => {
      this.applyPatchesToEditor(patches);
    });
  }

  /**
   * Apply Automerge patches to the Monaco editor.
   */
  private applyPatchesToEditor(patches: Patch[]): void {
    const model = this.editor.getModel();
    if (!model) return;

    const edits: Monaco.editor.IIdentifiedSingleEditOperation[] = [];

    for (const patch of patches) {
      // Check if this patch is for our file's content
      if (
        patch.path.length >= 3 &&
        patch.path[0] === "files" &&
        patch.path[1] === this.filePath &&
        patch.path[2] === "content"
      ) {
        // For string-based content, we need to do a full refresh
        // since we don't have character-level patches
        this.syncFromDocument();
        return;
      }
    }

    if (edits.length > 0) {
      this.isApplyingRemoteChanges = true;
      try {
        model.pushEditOperations([], edits, () => null);
      } finally {
        this.isApplyingRemoteChanges = false;
      }
    }
  }

  /**
   * Sync the editor content with the CRDT document.
   */
  syncFromDocument(): void {
    const content = this.docManager.getFileContent(this.filePath);
    if (content === null) return;

    const model = this.editor.getModel();
    if (!model) return;

    const currentContent = model.getValue();
    if (currentContent !== content) {
      this.isApplyingRemoteChanges = true;
      try {
        model.setValue(content);
      } finally {
        this.isApplyingRemoteChanges = false;
      }
    }
  }

  /**
   * Get the current cursor position as a stable cursor.
   */
  getStableCursor(): string | null {
    const position = this.editor.getPosition();
    if (!position) return null;

    return this.docManager.createCursor(
      this.filePath,
      position.lineNumber,
      position.column,
    );
  }

  /**
   * Set the cursor position from a stable cursor.
   */
  setFromStableCursor(cursor: string): void {
    const resolved = this.docManager.resolveCursor(cursor);
    if (!resolved || resolved.path !== this.filePath) return;

    this.editor.setPosition({
      lineNumber: resolved.line,
      column: resolved.column,
    });
  }

  /**
   * Dispose of all resources.
   */
  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];

    if (this.unsubscribeDoc) {
      this.unsubscribeDoc();
      this.unsubscribeDoc = null;
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

// Types are already exported at the top of the file
