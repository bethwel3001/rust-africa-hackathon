// ============================================================================
// AUTOMERGE EDITOR HOOK
// ============================================================================
// This hook provides a binding between Monaco Editor and Automerge CRDT for
// real-time collaborative editing with stable cursor positions.

import { useEffect, useRef, useCallback, useState } from "react";
import type * as Monaco from "monaco-editor";
import { DocumentManager, MonacoAutomergeBinding } from "../lib/automerge";

// ============================================================================
// TYPES
// ============================================================================

export interface CursorInfo {
  peerId: string;
  peerName: string;
  peerColor: string;
  filePath: string;
  line: number;
  column: number;
  selectionEnd?: { line: number; column: number };
  stableCursor?: string;
}

export interface UseAutomergeEditorOptions {
  /** The document manager instance from useCollaboration */
  documentManager: DocumentManager | null;
  /** The file path being edited */
  filePath: string;
  /** Callback when local cursor position changes */
  onCursorChange?: (line: number, column: number) => void;
  /** Callback when local content changes (for dirty state tracking) */
  onContentChange?: (content: string) => void;
  /** Debounce delay for cursor updates in ms */
  cursorDebounceMs?: number;
}

export interface UseAutomergeEditorReturn {
  /** Ref to attach to Monaco editor onMount callback */
  editorRef: React.RefObject<Monaco.editor.IStandaloneCodeEditor | null>;
  /** Whether the binding is active */
  isBindingActive: boolean;
  /** Current file content from CRDT */
  content: string | null;
  /** Bind the editor to Automerge (call in onMount) */
  bindEditor: (editor: Monaco.editor.IStandaloneCodeEditor) => void;
  /** Unbind the editor (call on unmount or file change) */
  unbindEditor: () => void;
  /** Sync editor content from CRDT document */
  syncFromDocument: () => void;
  /** Get stable cursor at current position */
  getStableCursor: () => string | null;
  /** Set cursor from stable cursor */
  setFromStableCursor: (cursor: string) => void;
  /** Apply remote cursor decorations */
  applyRemoteCursors: (cursors: CursorInfo[]) => void;
  /** Clear all remote cursor decorations */
  clearRemoteCursors: () => void;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_CURSOR_DEBOUNCE_MS = 50;

// ============================================================================
// HOOK IMPLEMENTATION
// ============================================================================

export function useAutomergeEditor(
  options: UseAutomergeEditorOptions,
): UseAutomergeEditorReturn {
  const {
    documentManager,
    filePath,
    onCursorChange,
    onContentChange,
    cursorDebounceMs = DEFAULT_CURSOR_DEBOUNCE_MS,
  } = options;

  // Refs
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const bindingRef = useRef<MonacoAutomergeBinding | null>(null);
  const cursorDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const decorationsRef = useRef<Map<string, string[]>>(new Map());
  const widgetsRef = useRef<Map<string, Monaco.editor.IContentWidget>>(
    new Map(),
  );

  // State
  const [isBindingActive, setIsBindingActive] = useState(false);
  const [content, setContent] = useState<string | null>(null);

  // ============================================================================
  // DOCUMENT CHANGE HANDLING
  // ============================================================================

  const handleDocumentChange = useCallback(() => {
    if (documentManager) {
      const newContent = documentManager.getFileContent(filePath);
      if (newContent !== content) {
        setContent(newContent);
        onContentChange?.(newContent || "");
      }
    }
  }, [documentManager, filePath, content, onContentChange]);

  // Subscribe to document changes
  useEffect(() => {
    if (!documentManager) return;

    const unsubscribe = documentManager.onChange(handleDocumentChange);

    // Initialize content
    const initialContent = documentManager.getFileContent(filePath);
    setContent(initialContent);

    return unsubscribe;
  }, [documentManager, filePath, handleDocumentChange]);

  // ============================================================================
  // EDITOR BINDING
  // ============================================================================

  const bindEditor = useCallback(
    (editor: Monaco.editor.IStandaloneCodeEditor) => {
      // Unbind any existing binding
      if (bindingRef.current) {
        bindingRef.current.dispose();
        bindingRef.current = null;
      }

      editorRef.current = editor;

      if (!documentManager) {
        console.warn("[AutomergeEditor] No document manager available");
        return;
      }

      // Create the binding
      try {
        bindingRef.current = new MonacoAutomergeBinding(
          editor,
          documentManager,
          filePath,
        );
        setIsBindingActive(true);

        // Sync initial content
        bindingRef.current.syncFromDocument();

        console.log("[AutomergeEditor] Binding created for:", filePath);
      } catch (error) {
        console.error("[AutomergeEditor] Failed to create binding:", error);
        setIsBindingActive(false);
      }

      // Set up cursor change listener with debounce
      const disposable = editor.onDidChangeCursorPosition((e) => {
        if (cursorDebounceRef.current) {
          clearTimeout(cursorDebounceRef.current);
        }

        cursorDebounceRef.current = setTimeout(() => {
          const position = e.position;
          onCursorChange?.(position.lineNumber, position.column);
        }, cursorDebounceMs);
      });

      // Return cleanup function
      return () => {
        disposable.dispose();
        if (cursorDebounceRef.current) {
          clearTimeout(cursorDebounceRef.current);
        }
      };
    },
    [documentManager, filePath, onCursorChange, cursorDebounceMs],
  );

  const unbindEditor = useCallback(() => {
    if (bindingRef.current) {
      bindingRef.current.dispose();
      bindingRef.current = null;
    }

    // Clear decorations
    clearRemoteCursors();

    setIsBindingActive(false);
    editorRef.current = null;

    console.log("[AutomergeEditor] Binding disposed for:", filePath);
  }, [filePath]);

  // Cleanup on unmount or file path change
  useEffect(() => {
    return () => {
      unbindEditor();
    };
  }, [filePath, unbindEditor]);

  // ============================================================================
  // SYNC OPERATIONS
  // ============================================================================

  const syncFromDocument = useCallback(() => {
    bindingRef.current?.syncFromDocument();
  }, []);

  const getStableCursor = useCallback((): string | null => {
    if (!editorRef.current || !documentManager) return null;
    const position = editorRef.current.getPosition();
    if (!position) return null;
    return documentManager.createCursor(
      filePath,
      position.lineNumber,
      position.column,
    );
  }, [documentManager, filePath]);

  const setFromStableCursor = useCallback(
    (cursor: string) => {
      if (!editorRef.current || !documentManager) return;
      const resolved = documentManager.resolveCursor(cursor);
      if (resolved && resolved.path === filePath) {
        editorRef.current.setPosition({
          lineNumber: resolved.line,
          column: resolved.column,
        });
      }
    },
    [documentManager, filePath],
  );

  // ============================================================================
  // REMOTE CURSOR DECORATIONS
  // ============================================================================

  const clearRemoteCursors = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    // Remove all decorations
    decorationsRef.current.forEach((decorations) => {
      editor.removeDecorations(decorations);
    });
    decorationsRef.current.clear();

    // Remove all widgets
    widgetsRef.current.forEach((widget) => {
      editor.removeContentWidget(widget);
    });
    widgetsRef.current.clear();

    // Remove injected styles
    document.querySelectorAll('[id^="cursor-style-"]').forEach((el) => {
      el.remove();
    });
  }, []);

  const applyRemoteCursors = useCallback(
    (cursors: CursorInfo[]) => {
      const editor = editorRef.current;
      if (!editor) return;

      const monaco = (window as unknown as { monaco?: typeof Monaco }).monaco;
      if (!monaco) return;

      // Clear old decorations
      clearRemoteCursors();

      // Apply new cursor decorations for each remote peer
      cursors
        .filter((cursor) => cursor.filePath === filePath)
        .forEach((cursor) => {
          const { peerId, peerName, peerColor, line, column, selectionEnd } =
            cursor;

          // Create decorations
          const decorations: Monaco.editor.IModelDeltaDecoration[] = [
            // Cursor position
            {
              range: new monaco.Range(line, column, line, column),
              options: {
                className: `remote-cursor-${peerId}`,
                afterContentClassName: `remote-cursor-after-${peerId}`,
                stickiness:
                  monaco.editor.TrackedRangeStickiness
                    .NeverGrowsWhenTypingAtEdges,
              },
            },
            // Line highlight
            {
              range: new monaco.Range(line, 1, line, 1),
              options: {
                isWholeLine: true,
                className: `remote-line-highlight-${peerId}`,
              },
            },
          ];

          // Add selection decoration if present
          if (selectionEnd) {
            decorations.push({
              range: new monaco.Range(
                line,
                column,
                selectionEnd.line,
                selectionEnd.column,
              ),
              options: {
                className: `remote-selection-${peerId}`,
              },
            });
          }

          const appliedDecorations = editor.deltaDecorations([], decorations);
          decorationsRef.current.set(peerId, appliedDecorations);

          // Create name badge widget
          const widget: Monaco.editor.IContentWidget = {
            getId: () => `cursor-widget-${peerId}`,
            getDomNode: () => {
              const container = document.createElement("div");
              container.className = "remote-cursor-widget-container";
              container.style.cssText = `
              position: relative;
              pointer-events: none;
              z-index: 1000;
            `;

              const badge = document.createElement("div");
              badge.className = "remote-cursor-badge";
              badge.style.cssText = `
              display: flex;
              align-items: center;
              gap: 4px;
              padding: 2px 8px;
              border-radius: 3px 3px 3px 0;
              font-size: 11px;
              font-weight: 600;
              white-space: nowrap;
              background-color: ${peerColor};
              color: white;
              margin-top: -22px;
              margin-left: 2px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.3);
              animation: cursor-badge-appear 0.2s ease-out;
            `;

              const avatar = document.createElement("span");
              avatar.style.cssText = `
              width: 14px;
              height: 14px;
              border-radius: 50%;
              background-color: rgba(255,255,255,0.3);
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 9px;
              font-weight: bold;
            `;
              avatar.textContent = peerName.charAt(0).toUpperCase();

              const nameText = document.createElement("span");
              nameText.textContent = peerName;

              badge.appendChild(avatar);
              badge.appendChild(nameText);
              container.appendChild(badge);

              return container;
            },
            getPosition: () => ({
              position: { lineNumber: line, column },
              preference: [
                monaco.editor.ContentWidgetPositionPreference.ABOVE,
                monaco.editor.ContentWidgetPositionPreference.BELOW,
              ],
            }),
          };

          editor.addContentWidget(widget);
          widgetsRef.current.set(peerId, widget);

          // Inject cursor styles
          const styleId = `cursor-style-${peerId}`;
          let styleEl = document.getElementById(styleId);
          if (!styleEl) {
            styleEl = document.createElement("style");
            styleEl.id = styleId;
            document.head.appendChild(styleEl);
          }
          styleEl.textContent = `
          .remote-cursor-after-${peerId}::after {
            content: "";
            position: absolute;
            width: 2px;
            height: 20px;
            background-color: ${peerColor};
            animation: cursor-blink-${peerId} 1s ease-in-out infinite;
            box-shadow: 0 0 4px ${peerColor};
          }
          .remote-line-highlight-${peerId} {
            background-color: ${peerColor}10;
            border-left: 2px solid ${peerColor};
          }
          .remote-selection-${peerId} {
            background-color: ${peerColor}30;
          }
          @keyframes cursor-blink-${peerId} {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
          @keyframes cursor-badge-appear {
            from {
              opacity: 0;
              transform: translateY(-4px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `;
        });
    },
    [filePath, clearRemoteCursors],
  );

  // ============================================================================
  // RETURN VALUE
  // ============================================================================

  return {
    editorRef,
    isBindingActive,
    content,
    bindEditor,
    unbindEditor,
    syncFromDocument,
    getStableCursor,
    setFromStableCursor,
    applyRemoteCursors,
    clearRemoteCursors,
  };
}

export default useAutomergeEditor;
