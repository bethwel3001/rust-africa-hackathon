"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import Editor, { Monaco, OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import { Collaborator, OpenFile } from "../store";
import { useCollaborationStore } from "../store";
import { debounce } from "../lib/utils";
import {
  VscSave,
  VscSourceControl,
  VscCircleFilled,
  VscAccount,
} from "react-icons/vsc";

interface CodeEditorProps {
  file: OpenFile;
  collaborators: Collaborator[];
  onContentChange: (content: string) => void;
  onCursorChange: (line: number, column: number) => void;
  onSave: () => void;
}

interface CursorDecoration {
  id: string;
  decoration: string[];
}

export default function CodeEditor({
  file,
  collaborators,
  onContentChange,
  onCursorChange,
  onSave,
}: CodeEditorProps) {
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationsRef = useRef<Map<string, string[]>>(new Map());
  const cursorWidgetsRef = useRef<Map<string, MonacoEditor.IContentWidget>>(
    new Map(),
  );
  const [isEditorReady, setIsEditorReady] = useState(false);

  const { remoteCursors, userId } = useCollaborationStore();

  // Handle editor mount
  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setIsEditorReady(true);

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
      suggest: {
        showKeywords: true,
        showSnippets: true,
      },
    });

    // Handle cursor position changes
    editor.onDidChangeCursorPosition((e) => {
      onCursorChange(e.position.lineNumber, e.position.column);
    });

    // Handle keyboard shortcuts
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSave();
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
        "editor.selectionHighlightBackground": "#add6ff26",
        "editorBracketMatch.background": "#0064001a",
        "editorBracketMatch.border": "#888888",
      },
    });

    monaco.editor.setTheme("codecollab-dark");
  };

  // Handle content changes with debounce
  const debouncedContentChange = useCallback(
    debounce((value: string) => {
      onContentChange(value);
    }, 300),
    [onContentChange],
  );

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined) {
      debouncedContentChange(value);
    }
  };

  // Memoize active collaborators in current file
  const activeCollaboratorsInFile = useMemo(() => {
    const active: Array<{
      collaborator: Collaborator;
      position: { line: number; column: number };
    }> = [];
    remoteCursors.forEach((position, oderId) => {
      if (oderId === userId) return;
      if (position.fileId !== file.id) return;
      const collaborator = collaborators.find((c) => c.id === oderId);
      if (collaborator) {
        active.push({
          collaborator,
          position: { line: position.line, column: position.column },
        });
      }
    });
    return active;
  }, [remoteCursors, userId, file.id, collaborators]);

  // Update collaborative cursors
  useEffect(() => {
    if (!isEditorReady || !editorRef.current || !monacoRef.current) return;

    const editor = editorRef.current;
    const monaco = monacoRef.current;

    // Clear old decorations and widgets
    decorationsRef.current.forEach((decorations) => {
      editor.removeDecorations(decorations);
    });
    decorationsRef.current.clear();

    cursorWidgetsRef.current.forEach((widget) => {
      editor.removeContentWidget(widget);
    });
    cursorWidgetsRef.current.clear();

    // Add new cursor decorations for each active collaborator
    activeCollaboratorsInFile.forEach(({ collaborator, position }) => {
      const oderId = collaborator.id;

      // Create cursor line decoration with highlight
      const decorations = editor.deltaDecorations(
        [],
        [
          {
            range: new monaco.Range(
              position.line,
              position.column,
              position.line,
              position.column,
            ),
            options: {
              className: `remote-cursor-${oderId}`,
              afterContentClassName: `remote-cursor-after-${oderId}`,
              stickiness:
                monaco.editor.TrackedRangeStickiness
                  .NeverGrowsWhenTypingAtEdges,
            },
          },
          // Add a subtle line highlight for the collaborator's line
          {
            range: new monaco.Range(position.line, 1, position.line, 1),
            options: {
              isWholeLine: true,
              className: `remote-line-highlight-${oderId}`,
            },
          },
        ],
      );

      decorationsRef.current.set(oderId, decorations);

      // Create enhanced cursor label widget with name badge
      const widget: MonacoEditor.IContentWidget = {
        getId: () => `cursor-widget-${oderId}`,
        getDomNode: () => {
          const container = document.createElement("div");
          container.className = "remote-cursor-widget-container";
          container.style.position = "relative";
          container.style.pointerEvents = "none";
          container.style.zIndex = "1000";

          // Name badge
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
            background-color: ${collaborator.color};
            color: white;
            margin-top: -22px;
            margin-left: 2px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
            animation: cursor-badge-appear 0.2s ease-out;
          `;

          // Avatar initial
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
          avatar.textContent = collaborator.name.charAt(0).toUpperCase();

          // Name text
          const nameText = document.createElement("span");
          nameText.textContent = collaborator.name;

          badge.appendChild(avatar);
          badge.appendChild(nameText);
          container.appendChild(badge);

          return container;
        },
        getPosition: () => ({
          position: { lineNumber: position.line, column: position.column },
          preference: [
            monaco.editor.ContentWidgetPositionPreference.ABOVE,
            monaco.editor.ContentWidgetPositionPreference.BELOW,
          ],
        }),
      };

      editor.addContentWidget(widget);
      cursorWidgetsRef.current.set(oderId, widget);

      // Inject enhanced cursor styles dynamically
      const styleId = `cursor-style-${oderId}`;
      let styleEl = document.getElementById(styleId);
      if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = styleId;
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = `
        .remote-cursor-after-${oderId}::after {
          content: "";
          position: absolute;
          width: 2px;
          height: 20px;
          background-color: ${collaborator.color};
          animation: cursor-blink-${oderId} 1s ease-in-out infinite;
          box-shadow: 0 0 4px ${collaborator.color};
        }
        .remote-line-highlight-${oderId} {
          background-color: ${collaborator.color}10;
          border-left: 2px solid ${collaborator.color};
        }
        @keyframes cursor-blink-${oderId} {
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
  }, [activeCollaboratorsInFile, isEditorReady]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clean up style elements
      remoteCursors.forEach((_, oderId) => {
        const styleEl = document.getElementById(`cursor-style-${oderId}`);
        if (styleEl) {
          styleEl.remove();
        }
      });
    };
  }, [remoteCursors]);

  return (
    <div className="flex-1 h-full flex flex-col bg-[#0c0c0d] overflow-hidden">
      {/* Editor Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#0a0a0b] border-b border-gray-800/50">
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">{file.path}</span>
          {file.isDirty && (
            <span className="flex items-center gap-1 text-xs text-yellow-500">
              <VscCircleFilled size={8} />
              Unsaved
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Active Collaborators in this file */}
          {activeCollaboratorsInFile.length > 0 && (
            <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-gray-800/50">
              <VscAccount size={12} className="text-gray-400" />
              <span className="text-xs text-gray-400">Editing:</span>
              <div className="flex items-center -space-x-1.5">
                {activeCollaboratorsInFile
                  .slice(0, 3)
                  .map(({ collaborator }) => (
                    <div
                      key={collaborator.id}
                      className="w-6 h-6 rounded-full border-2 border-[#0a0a0b] flex items-center justify-center text-[9px] font-bold text-white relative group"
                      style={{ backgroundColor: collaborator.color }}
                    >
                      {collaborator.name.charAt(0).toUpperCase()}
                      {/* Tooltip */}
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                        {collaborator.name}
                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                      </div>
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

          {/* Save Button */}
          <button
            onClick={onSave}
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

          {/* All Collaborators in Room */}
          {collaborators.length > 1 && (
            <div className="flex items-center -space-x-2 ml-2">
              {collaborators.slice(0, 4).map((collab) => (
                <div
                  key={collab.id}
                  className="w-7 h-7 rounded-full border-2 border-[#0a0a0b] flex items-center justify-center text-[10px] font-bold text-white relative group cursor-pointer hover:z-10 hover:scale-110 transition-transform"
                  style={{ backgroundColor: collab.color }}
                >
                  {collab.name.charAt(0).toUpperCase()}
                  {/* Tooltip with status */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                    <div className="font-medium">{collab.name}</div>
                    {collab.cursorPosition && (
                      <div className="text-gray-400 text-[10px]">
                        Line {collab.cursorPosition.line}
                      </div>
                    )}
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                  </div>
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
          value={file.content}
          onChange={handleEditorChange}
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
            readOnly: false,
            automaticLayout: true,
          }}
        />
      </div>

      {/* Status Bar */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-[#0a0a0b] border-t border-gray-800/50 text-xs text-gray-500">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <VscSourceControl size={12} />
            {file.language}
          </span>
          <span>UTF-8</span>
          <span>LF</span>
        </div>

        <div className="flex items-center gap-4">
          {activeCollaboratorsInFile.length > 0 && (
            <span className="flex items-center gap-1.5 text-blue-400">
              <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
              {activeCollaboratorsInFile.length} editing here
            </span>
          )}
          {collaborators.length > 1 && (
            <span className="flex items-center gap-1.5 text-green-400">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full" />
              {collaborators.length} in room
            </span>
          )}
          <span>Ln 1, Col 1</span>
        </div>
      </div>
    </div>
  );
}
