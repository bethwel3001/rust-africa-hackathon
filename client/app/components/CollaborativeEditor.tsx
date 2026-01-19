"use client";

// ============================================================================
// COLLABORATIVE EDITOR COMPONENT
// ============================================================================
// This component demonstrates the integration of Monaco Editor with Automerge
// CRDT for real-time collaborative editing. It combines:
// - useCollaboration: Binary protocol WebSocket connection
// - useAutomergeEditor: Monaco-Automerge binding with stable cursors
// - useVoiceChat: LiveKit-based voice communication

import { useEffect, useCallback, useState, useMemo } from "react";
import Editor, { Monaco, OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import { useCollaboration } from "../hooks/useCollaboration";
import { useAutomergeEditor, CursorInfo } from "../hooks/useAutomergeEditor";
import { useVoiceChat } from "../hooks/useVoiceChat";
import { useCollaborationStore, useFileStore, OpenFile } from "../store";
import { PresenceStatus } from "../lib/protocol";
import {
  VscSave,
  VscCircleFilled,
  VscAccount,
  VscMic,
  VscMute,
  VscDebugDisconnect,
  VscPlug,
} from "react-icons/vsc";

// ============================================================================
// TYPES
// ============================================================================

interface CollaborativeEditorProps {
  file: OpenFile;
  projectId: string;
  userName: string;
  onSave?: (content: string) => void;
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function CollaborativeEditor({
  file,
  projectId,
  userName,
  onSave,
}: CollaborativeEditorProps) {
  // Local state
  const [monacoInstance, setMonacoInstance] = useState<Monaco | null>(null);

  // Store access
  const { collaborators, remoteCursors, userId } = useCollaborationStore();
  const { updateFileContent } = useFileStore();

  // ============================================================================
  // COLLABORATION HOOK
  // ============================================================================

  const {
    connectionStatus,
    isConnected,
    peerId,
    peerColor,
    documentManager,
    connect,
    disconnect,
    openFile,
    closeFile,
    sendCursorUpdate,
    sendPresenceUpdate,
    sendChatMessage,
    joinVoiceChat,
    leaveVoiceChat,
  } = useCollaboration({
    serverUrl: "ws://localhost:5000",
    autoReconnect: true,
    onConnectionChange: (status) => {
      console.log("[CollaborativeEditor] Connection status:", status);
    },
  });

  // ============================================================================
  // AUTOMERGE EDITOR HOOK
  // ============================================================================

  const {
    editorRef,
    isBindingActive,
    content,
    bindEditor,
    unbindEditor,
    syncFromDocument,
    applyRemoteCursors,
    clearRemoteCursors,
  } = useAutomergeEditor({
    documentManager,
    filePath: file.path,
    onCursorChange: (line, column) => {
      // Send cursor update to other peers
      sendCursorUpdate(file.path, line, column);
    },
    onContentChange: (newContent) => {
      // Update local file store for dirty tracking
      updateFileContent(file.id, newContent);
    },
    cursorDebounceMs: 50,
  });

  // ============================================================================
  // VOICE CHAT HOOK
  // ============================================================================

  const {
    isConnected: isVoiceConnected,
    isConnecting: isVoiceConnecting,
    isMuted,
    isSpeaking,
    participants: voiceParticipants,
    participantCount,
    toggleMute,
  } = useVoiceChat();

  // ============================================================================
  // CONNECTION MANAGEMENT
  // ============================================================================

  // Connect to collaboration server on mount
  useEffect(() => {
    if (!isConnected && projectId && userName) {
      connect(projectId, userName).catch((error) => {
        console.error("[CollaborativeEditor] Failed to connect:", error);
      });
    }

    return () => {
      // Disconnect on unmount
      disconnect();
    };
  }, [projectId, userName, isConnected, connect, disconnect]);

  // Open file when connected
  useEffect(() => {
    if (isConnected && file.path) {
      openFile(file.path);

      // Update presence
      sendPresenceUpdate(PresenceStatus.Active, file.path);

      return () => {
        closeFile(file.path);
      };
    }
  }, [isConnected, file.path, openFile, closeFile, sendPresenceUpdate]);

  // ============================================================================
  // REMOTE CURSORS
  // ============================================================================

  // Convert store cursors to CursorInfo array for the editor hook
  const remoteCursorInfos: CursorInfo[] = useMemo(() => {
    const cursors: CursorInfo[] = [];

    remoteCursors.forEach((position, oderId) => {
      // Skip our own cursor
      if (oderId === userId || oderId === peerId) return;

      // Find collaborator info
      const collaborator = collaborators.find((c) => c.id === oderId);
      if (!collaborator) return;

      cursors.push({
        peerId: oderId,
        peerName: collaborator.name,
        peerColor: collaborator.color,
        filePath: position.fileId,
        line: position.line,
        column: position.column,
      });
    });

    return cursors;
  }, [remoteCursors, userId, peerId, collaborators]);

  // Apply remote cursors when they change
  useEffect(() => {
    if (isBindingActive) {
      applyRemoteCursors(remoteCursorInfos);
    }
  }, [isBindingActive, remoteCursorInfos, applyRemoteCursors]);

  // ============================================================================
  // EDITOR SETUP
  // ============================================================================

  const handleEditorDidMount: OnMount = useCallback(
    (editor, monaco) => {
      setMonacoInstance(monaco);

      // Configure editor settings
      editor.updateOptions({
        minimap: { enabled: true, scale: 1 },
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        fontLigatures: true,
        lineHeight: 22,
        letterSpacing: 0.5,
        cursorBlinking: "smooth",
        cursorSmoothCaretAnimation: "on",
        smoothScrolling: true,
        scrollBeyondLastLine: false,
        renderLineHighlight: "all",
        renderWhitespace: "selection",
        bracketPairColorization: { enabled: true },
        padding: { top: 16, bottom: 16 },
      });

      // Define custom theme
      monaco.editor.defineTheme("codecollab-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [
          { token: "comment", foreground: "6A9955", fontStyle: "italic" },
          { token: "keyword", foreground: "569CD6" },
          { token: "string", foreground: "CE9178" },
          { token: "number", foreground: "B5CEA8" },
          { token: "type", foreground: "4EC9B0" },
          { token: "function", foreground: "DCDCAA" },
          { token: "variable", foreground: "9CDCFE" },
          { token: "operator", foreground: "D4D4D4" },
        ],
        colors: {
          "editor.background": "#0c0c0d",
          "editor.foreground": "#D4D4D4",
          "editor.lineHighlightBackground": "#1a1a1d",
          "editor.selectionBackground": "#264F78",
          "editor.inactiveSelectionBackground": "#3A3D41",
          "editorCursor.foreground": "#AEAFAD",
          "editorLineNumber.foreground": "#3b3b3b",
          "editorLineNumber.activeForeground": "#6e6e6e",
          "editorIndentGuide.background": "#1e1e1e",
          "editorIndentGuide.activeBackground": "#3b3b3b",
        },
      });
      monaco.editor.setTheme("codecollab-dark");

      // Handle save shortcut
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        handleSave();
      });

      // Bind editor to Automerge
      bindEditor(editor);
    },
    [bindEditor],
  );

  // ============================================================================
  // SAVE HANDLER
  // ============================================================================

  const handleSave = useCallback(() => {
    const currentContent = content || file.content;
    onSave?.(currentContent);
  }, [content, file.content, onSave]);

  // ============================================================================
  // ACTIVE COLLABORATORS IN THIS FILE
  // ============================================================================

  const activeCollaboratorsInFile = useMemo(() => {
    return remoteCursorInfos.filter((cursor) => cursor.filePath === file.path);
  }, [remoteCursorInfos, file.path]);

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="flex-1 h-full flex flex-col bg-[#0c0c0d] overflow-hidden">
      {/* Editor Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#0a0a0b] border-b border-gray-800/50">
        <div className="flex items-center gap-3">
          {/* Connection Status */}
          <div className="flex items-center gap-2">
            {isConnected ? (
              <VscPlug className="text-green-400" size={14} />
            ) : (
              <VscDebugDisconnect className="text-gray-500" size={14} />
            )}
            <span
              className={`text-xs ${isConnected ? "text-green-400" : "text-gray-500"}`}
            >
              {connectionStatus}
            </span>
          </div>

          {/* File Path */}
          <span className="text-sm text-gray-400">{file.path}</span>

          {/* Dirty Indicator */}
          {file.isDirty && (
            <span className="flex items-center gap-1 text-xs text-yellow-500">
              <VscCircleFilled size={8} />
              Unsaved
            </span>
          )}

          {/* Binding Status */}
          {isBindingActive && (
            <span className="text-xs text-blue-400">CRDT Active</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Active Collaborators in this file */}
          {activeCollaboratorsInFile.length > 0 && (
            <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-gray-800/50">
              <VscAccount size={12} className="text-gray-400" />
              <span className="text-xs text-gray-400">Editing:</span>
              <div className="flex items-center -space-x-1.5">
                {activeCollaboratorsInFile.slice(0, 3).map((cursor) => (
                  <div
                    key={cursor.peerId}
                    className="w-6 h-6 rounded-full border-2 border-[#0a0a0b] flex items-center justify-center text-[9px] font-bold text-white relative group"
                    style={{ backgroundColor: cursor.peerColor }}
                    title={cursor.peerName}
                  >
                    {cursor.peerName.charAt(0).toUpperCase()}
                  </div>
                ))}
                {activeCollaboratorsInFile.length > 3 && (
                  <div className="w-6 h-6 rounded-full border-2 border-[#0a0a0b] bg-gray-700 flex items-center justify-center text-[9px] text-gray-300">
                    +{activeCollaboratorsInFile.length - 3}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Voice Chat Button */}
          {isConnected && (
            <button
              onClick={isVoiceConnected ? toggleMute : joinVoiceChat}
              className={`
                flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all
                ${
                  isVoiceConnected
                    ? isMuted
                      ? "bg-red-600 hover:bg-red-500 text-white"
                      : "bg-green-600 hover:bg-green-500 text-white"
                    : "bg-gray-700 hover:bg-gray-600 text-gray-300"
                }
              `}
              title={
                isVoiceConnected ? (isMuted ? "Unmute" : "Mute") : "Join Voice"
              }
            >
              {isMuted ? <VscMute size={14} /> : <VscMic size={14} />}
              {isVoiceConnected && participantCount > 0 && (
                <span>{participantCount}</span>
              )}
            </button>
          )}

          {/* Save Button */}
          <button
            onClick={handleSave}
            disabled={!file.isDirty}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all
              ${
                file.isDirty
                  ? "bg-blue-600 hover:bg-blue-500 text-white"
                  : "bg-gray-800 text-gray-500 cursor-not-allowed"
              }
            `}
            title="Save (Ctrl+S)"
          >
            <VscSave size={14} />
            Save
          </button>

          {/* All Collaborators Avatars */}
          {collaborators.length > 0 && (
            <div className="flex items-center -space-x-2 ml-2">
              {collaborators.slice(0, 4).map((collab) => (
                <div
                  key={collab.id}
                  className="w-7 h-7 rounded-full border-2 border-[#0a0a0b] flex items-center justify-center text-[10px] font-bold text-white relative group cursor-pointer hover:z-10 hover:scale-110 transition-transform"
                  style={{ backgroundColor: collab.color }}
                  title={collab.name}
                >
                  {collab.name.charAt(0).toUpperCase()}
                  {/* Online indicator */}
                  <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border border-[#0a0a0b]" />
                </div>
              ))}
              {collaborators.length > 4 && (
                <div className="w-7 h-7 rounded-full border-2 border-[#0a0a0b] bg-gray-700 flex items-center justify-center text-[10px] text-gray-300">
                  +{collaborators.length - 4}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Monaco Editor */}
      <div className="flex-1 overflow-hidden">
        <Editor
          height="100%"
          language={file.language}
          value={content ?? file.content}
          onMount={handleEditorDidMount}
          theme="codecollab-dark"
          loading={
            <div className="flex items-center justify-center h-full bg-[#0c0c0d]">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-gray-500 text-sm">Loading editor...</span>
              </div>
            </div>
          }
          options={{
            readOnly: !isConnected,
            automaticLayout: true,
          }}
        />
      </div>

      {/* Status Bar */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-[#0a0a0b] border-t border-gray-800/50 text-xs text-gray-500">
        <div className="flex items-center gap-4">
          <span>{file.language}</span>
          <span>UTF-8</span>
          <span>LF</span>
          {peerColor && (
            <span className="flex items-center gap-1">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: peerColor }}
              />
              {userName}
            </span>
          )}
        </div>

        <div className="flex items-center gap-4">
          {isBindingActive && (
            <span className="flex items-center gap-1.5 text-purple-400">
              <span className="w-1.5 h-1.5 bg-purple-400 rounded-full" />
              CRDT Sync
            </span>
          )}
          {activeCollaboratorsInFile.length > 0 && (
            <span className="flex items-center gap-1.5 text-blue-400">
              <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
              {activeCollaboratorsInFile.length} editing here
            </span>
          )}
          {collaborators.length > 0 && (
            <span className="flex items-center gap-1.5 text-green-400">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full" />
              {collaborators.length + 1} in room
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
