"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  VscTerminal,
  VscClose,
  VscAdd,
  VscTrash,
  VscChevronDown,
  VscChevronUp,
  VscSplitHorizontal,
} from "react-icons/vsc";
import { cn } from "../lib/utils";

interface TerminalTab {
  id: string;
  name: string;
  history: string[];
  currentLine: string;
  cursorPosition: number;
}

interface TerminalProps {
  isOpen: boolean;
  onClose: () => void;
  onToggle: () => void;
  workingDirectory?: string;
}

// Simulated command outputs for demo purposes
// In a real implementation, this would use Tauri commands to execute shell commands
const SIMULATED_COMMANDS: Record<string, string | ((args: string[]) => string)> = {
  help: `Available commands:
  help      - Show this help message
  clear     - Clear the terminal
  echo      - Print arguments to console
  ls        - List files (simulated)
  pwd       - Print working directory
  whoami    - Print current user
  date      - Print current date and time
  node -v   - Show Node.js version
  npm -v    - Show npm version
  cargo -V  - Show Cargo version
  git       - Git commands (simulated)`,

  clear: "__CLEAR__",

  pwd: (args) => "/home/user/projects/codecollab",

  whoami: () => "developer",

  date: () => new Date().toString(),

  "node -v": () => "v20.10.0",
  "npm -v": () => "10.2.3",
  "cargo -V": () => "cargo 1.77.0 (3fe68eabf 2024-02-29)",

  ls: (args) => {
    if (args.includes("-la") || args.includes("-l")) {
      return `total 32
drwxr-xr-x  5 user user 4096 Jan 15 10:30 .
drwxr-xr-x 10 user user 4096 Jan 15 09:00 ..
drwxr-xr-x  8 user user 4096 Jan 15 10:30 .git
-rw-r--r--  1 user user  234 Jan 15 10:30 .gitignore
drwxr-xr-x  3 user user 4096 Jan 15 10:30 client
-rw-r--r--  1 user user  456 Jan 15 10:30 README.md
drwxr-xr-x  3 user user 4096 Jan 15 10:30 server`;
    }
    return `client  README.md  server  .git  .gitignore`;
  },

  echo: (args) => args.join(" "),

  git: (args) => {
    if (args[0] === "status") {
      return `On branch main
Your branch is up to date with 'origin/main'.

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
        modified:   client/app/page.tsx

no changes added to commit (use "git add" and/or "git commit -a")`;
    }
    if (args[0] === "branch") {
      return `* main
  feature/voice-chat
  feature/terminal`;
    }
    return `git version 2.43.0`;
  },
};

export default function Terminal({
  isOpen,
  onClose,
  onToggle,
  workingDirectory = "~/projects/codecollab",
}: TerminalProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>([
    {
      id: "1",
      name: "Terminal 1",
      history: [
        { type: "output", content: "Welcome to CodeCollab Terminal" },
        { type: "output", content: 'Type "help" for available commands\n' },
      ] as any,
      currentLine: "",
      cursorPosition: 0,
    },
  ]);
  const [activeTabId, setActiveTabId] = useState("1");
  const [height, setHeight] = useState(300);
  const [isResizing, setIsResizing] = useState(false);

  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const historyIndexRef = useRef<number>(-1);
  const commandHistoryRef = useRef<string[]>([]);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  // Focus input when terminal is opened or tab changes
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen, activeTabId]);

  // Auto-scroll to bottom when history changes
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [activeTab?.history]);

  // Handle resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizing) {
        const newHeight = window.innerHeight - e.clientY;
        setHeight(Math.max(150, Math.min(600, newHeight)));
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  const executeCommand = useCallback((command: string) => {
    const trimmedCmd = command.trim();
    if (!trimmedCmd) return;

    // Add to command history
    commandHistoryRef.current.push(trimmedCmd);
    historyIndexRef.current = commandHistoryRef.current.length;

    // Parse command and args
    const parts = trimmedCmd.split(" ");
    const cmd = parts[0];
    const args = parts.slice(1);

    // Check for full command match first (like "node -v")
    let output: string;
    const fullCmd = parts.slice(0, 2).join(" ");

    if (SIMULATED_COMMANDS[fullCmd]) {
      const handler = SIMULATED_COMMANDS[fullCmd];
      output = typeof handler === "function" ? handler(args.slice(1)) : handler;
    } else if (SIMULATED_COMMANDS[cmd]) {
      const handler = SIMULATED_COMMANDS[cmd];
      output = typeof handler === "function" ? handler(args) : handler;
    } else {
      output = `bash: ${cmd}: command not found`;
    }

    // Update tab history
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id === activeTabId) {
          if (output === "__CLEAR__") {
            return {
              ...tab,
              history: [],
              currentLine: "",
            };
          }
          return {
            ...tab,
            history: [
              ...tab.history,
              { type: "command", content: trimmedCmd },
              { type: "output", content: output },
            ] as any,
            currentLine: "",
          };
        }
        return tab;
      })
    );
  }, [activeTabId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        executeCommand(activeTab.currentLine);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (historyIndexRef.current > 0) {
          historyIndexRef.current--;
          const cmd = commandHistoryRef.current[historyIndexRef.current];
          setTabs((prev) =>
            prev.map((tab) =>
              tab.id === activeTabId ? { ...tab, currentLine: cmd } : tab
            )
          );
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (historyIndexRef.current < commandHistoryRef.current.length - 1) {
          historyIndexRef.current++;
          const cmd = commandHistoryRef.current[historyIndexRef.current];
          setTabs((prev) =>
            prev.map((tab) =>
              tab.id === activeTabId ? { ...tab, currentLine: cmd } : tab
            )
          );
        } else {
          historyIndexRef.current = commandHistoryRef.current.length;
          setTabs((prev) =>
            prev.map((tab) =>
              tab.id === activeTabId ? { ...tab, currentLine: "" } : tab
            )
          );
        }
      } else if (e.key === "l" && e.ctrlKey) {
        e.preventDefault();
        executeCommand("clear");
      } else if (e.key === "c" && e.ctrlKey) {
        e.preventDefault();
        setTabs((prev) =>
          prev.map((tab) => {
            if (tab.id === activeTabId) {
              return {
                ...tab,
                history: [
                  ...tab.history,
                  { type: "command", content: tab.currentLine + "^C" },
                ] as any,
                currentLine: "",
              };
            }
            return tab;
          })
        );
      }
    },
    [activeTab, activeTabId, executeCommand]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTabId
            ? { ...tab, currentLine: e.target.value }
            : tab
        )
      );
    },
    [activeTabId]
  );

  const addNewTab = useCallback(() => {
    const newId = Date.now().toString();
    setTabs((prev) => [
      ...prev,
      {
        id: newId,
        name: `Terminal ${prev.length + 1}`,
        history: [],
        currentLine: "",
        cursorPosition: 0,
      },
    ]);
    setActiveTabId(newId);
  }, []);

  const closeTab = useCallback(
    (tabId: string) => {
      if (tabs.length === 1) return;

      setTabs((prev) => prev.filter((t) => t.id !== tabId));
      if (activeTabId === tabId) {
        const remaining = tabs.filter((t) => t.id !== tabId);
        setActiveTabId(remaining[0]?.id || "1");
      }
    },
    [tabs, activeTabId]
  );

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="fixed bottom-4 right-80 z-40 flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg shadow-lg transition-all border border-gray-700"
      >
        <VscTerminal size={16} />
        <span className="text-sm font-medium">Terminal</span>
        <VscChevronUp size={14} />
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-0 left-12 right-72 z-40 bg-[#0c0c0d] border-t border-gray-800 flex flex-col"
      style={{ height }}
    >
      {/* Resize Handle */}
      <div
        className={cn(
          "absolute top-0 left-0 right-0 h-1 cursor-ns-resize hover:bg-blue-500/50 transition-colors",
          isResizing && "bg-blue-500"
        )}
        onMouseDown={handleMouseDown}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1 bg-[#0a0a0b] border-b border-gray-800/50">
        {/* Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-t text-xs font-medium cursor-pointer transition-colors group",
                tab.id === activeTabId
                  ? "bg-[#0c0c0d] text-white border-t border-l border-r border-gray-700/50"
                  : "text-gray-500 hover:text-gray-300 hover:bg-gray-800/50"
              )}
              onClick={() => setActiveTabId(tab.id)}
            >
              <VscTerminal size={12} />
              <span>{tab.name}</span>
              {tabs.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity"
                >
                  <VscClose size={12} />
                </button>
              )}
            </div>
          ))}
          <button
            onClick={addNewTab}
            className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-800 rounded transition-colors"
            title="New Terminal"
          >
            <VscAdd size={14} />
          </button>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => executeCommand("clear")}
            className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-800 rounded transition-colors"
            title="Clear Terminal"
          >
            <VscTrash size={14} />
          </button>
          <button
            onClick={onToggle}
            className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-800 rounded transition-colors"
            title="Minimize Terminal"
          >
            <VscChevronDown size={14} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-gray-800 rounded transition-colors"
            title="Close Terminal"
          >
            <VscClose size={14} />
          </button>
        </div>
      </div>

      {/* Terminal Content */}
      <div
        ref={terminalRef}
        className="flex-1 overflow-y-auto p-3 font-mono text-sm"
        onClick={() => inputRef.current?.focus()}
      >
        {/* History */}
        {(activeTab.history as any[]).map((entry, index) => (
          <div key={index} className="whitespace-pre-wrap">
            {entry.type === "command" ? (
              <div className="flex items-start gap-2">
                <span className="text-green-400 shrink-0">
                  {workingDirectory}
                </span>
                <span className="text-gray-400 shrink-0">$</span>
                <span className="text-white">{entry.content}</span>
              </div>
            ) : (
              <div className="text-gray-300 ml-0">{entry.content}</div>
            )}
          </div>
        ))}

        {/* Current Input Line */}
        <div className="flex items-start gap-2">
          <span className="text-green-400 shrink-0">{workingDirectory}</span>
          <span className="text-gray-400 shrink-0">$</span>
          <input
            ref={inputRef}
            type="text"
            value={activeTab.currentLine}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-white outline-none border-none caret-white"
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
        </div>
      </div>

      {/* Status Bar */}
      <div className="flex items-center justify-between px-3 py-1 bg-[#0a0a0b] border-t border-gray-800/50 text-[10px] text-gray-500">
        <div className="flex items-center gap-3">
          <span>bash</span>
          <span>•</span>
          <span>{workingDirectory}</span>
        </div>
        <div className="flex items-center gap-3">
          <span>Lines: {activeTab.history.length}</span>
          <span>•</span>
          <span>UTF-8</span>
        </div>
      </div>
    </div>
  );
}
