"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import ActivityBar from "./components/ActivityBar";
import Sidebar from "./components/Sidebar";
import CodeEditor from "./components/CodeEditor";
import ApiTester from "./components/ApiTester";
import AiChat from "./components/AiChat";
import CollaborationPanel from "./components/CollaborationPanel";
import JoinRoomModal from "./components/JoinRoomModal";
import Terminal from "./components/Terminal";
import { useFileStore, useCollaborationStore, useUiStore } from "./store";
import {
  openFolderDialog,
  openFolder,
  readFile,
  writeFile,
  createFile,
  createDirectory,
  deletePath,
  renamePath,
  isTauri,
  FileNode,
} from "./lib/tauri";
import { useCollaboration } from "./hooks/useCollaboration";
import { useVoiceChat } from "./hooks/useVoiceChat";
import { VscLiveShare, VscClose, VscTerminal } from "react-icons/vsc";

export default function Home() {
  const [isMounted, setIsMounted] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);

  // WebSocket ref for voice chat
  const wsRef = useRef<WebSocket | null>(null);

  // Stores
  const { activeView, setActiveView, showCollaborators, toggleCollaborators } =
    useUiStore();
  const {
    projectRoot,
    projectPath,
    setProjectRoot,
    setProjectPath,
    openFiles,
    activeFileId,
    setActiveFile,
    openFile,
    closeFile,
    expandedFolders,
    toggleFolder,
    updateFileContent,
    markFileSaved,
  } = useFileStore();
  const { collaborators, isConnected, roomId, userName, setUserName } =
    useCollaborationStore();

  // Collaboration hook
  const {
    connect,
    disconnect,
    sendCursorUpdate,
    connectionStatus,
    documentManager,
  } = useCollaboration();

  // Voice chat hook
  const {
    isConnected: isVoiceConnected,
    isMuted,
    isSpeaking,
    participantCount,
    connect: connectVoice,
    disconnect: disconnectVoice,
    toggleMute,
  } = useVoiceChat();

  // Load initial data
  useEffect(() => {
    setIsMounted(true);

    // Load saved username
    const savedName = localStorage.getItem("codecollab_username");
    if (savedName) {
      setUserName(savedName);
    }

    // Load saved view
    const savedView = localStorage.getItem("codecollab_view") as
      | "files"
      | "testing"
      | "chat"
      | null;
    if (savedView) {
      setActiveView(savedView);
    }

    // Load terminal state
    const terminalState = localStorage.getItem("codecollab_terminal");
    if (terminalState === "open") {
      setIsTerminalOpen(true);
    }

    console.log("App mounted, Tauri available:", isTauri());
  }, [setActiveView, setUserName]);

  // Handle view change with persistence
  const handleViewChange = (view: "files" | "testing" | "chat") => {
    setActiveView(view);
    localStorage.setItem("codecollab_view", view);
  };

  // Handle terminal toggle
  const handleTerminalToggle = useCallback(() => {
    setIsTerminalOpen((prev) => {
      const newState = !prev;
      localStorage.setItem("codecollab_terminal", newState ? "open" : "closed");
      return newState;
    });
  }, []);

  const handleTerminalClose = useCallback(() => {
    setIsTerminalOpen(false);
    localStorage.setItem("codecollab_terminal", "closed");
  }, []);

  // Open folder dialog
  const handleOpenFolder = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      console.log("Opening folder dialog...");
      const path = await openFolderDialog();
      console.log("Selected path:", path);

      if (path) {
        console.log("Loading folder contents...");
        const folder = await openFolder(path);
        console.log("Folder loaded:", folder);

        setProjectRoot(folder);
        setProjectPath(path);
        // Auto-expand root
        toggleFolder(path);
      }
    } catch (err) {
      console.error("Failed to open folder:", err);
      setError(err instanceof Error ? err.message : "Failed to open folder");
    } finally {
      setIsLoading(false);
    }
  }, [setProjectRoot, setProjectPath, toggleFolder]);

  // Refresh folder
  const handleRefreshFolder = useCallback(async () => {
    const currentPath = useFileStore.getState().projectPath;
    if (!currentPath) {
      handleOpenFolder();
      return;
    }

    setIsLoading(true);
    try {
      const folder = await openFolder(currentPath);
      setProjectRoot(folder);
    } catch (err) {
      console.error("Failed to refresh folder:", err);
    } finally {
      setIsLoading(false);
    }
  }, [handleOpenFolder, setProjectRoot]);

  // Handle file click
  const handleFileClick = useCallback(
    async (node: FileNode) => {
      if (node.is_dir) {
        toggleFolder(node.path);
        return;
      }

      // Check if already open
      const existing = openFiles.find((f) => f.path === node.path);
      if (existing) {
        setActiveFile(existing.id);
        return;
      }

      try {
        console.log("Reading file:", node.path);
        const content = await readFile(node.path);
        console.log("File content loaded, language:", content.language);

        openFile({
          id: node.id,
          path: node.path,
          name: node.name,
          content: content.content,
          language: content.language,
          isDirty: false,
          version: 0,
        });
      } catch (err) {
        console.error("Failed to read file:", err);
        setError(err instanceof Error ? err.message : "Failed to read file");
      }
    },
    [openFiles, setActiveFile, openFile, toggleFolder],
  );

  // Handle file save
  const handleSaveFile = useCallback(
    async (fileId: string) => {
      const file = openFiles.find((f) => f.id === fileId);
      if (!file) return;

      try {
        await writeFile(file.path, file.content);
        markFileSaved(fileId);
        console.log("File saved:", file.path);
      } catch (err) {
        console.error("Failed to save file:", err);
        setError(err instanceof Error ? err.message : "Failed to save file");
      }
    },
    [openFiles, markFileSaved],
  );

  // Handle create file
  const handleCreateFile = useCallback(
    async (dirPath: string, name: string) => {
      try {
        console.log("Creating file:", dirPath, name);
        await createFile(dirPath, name);
        // Refresh the folder to show the new file
        await handleRefreshFolder();
      } catch (err) {
        console.error("Failed to create file:", err);
        setError(err instanceof Error ? err.message : "Failed to create file");
        throw err;
      }
    },
    [handleRefreshFolder],
  );

  // Handle create directory
  const handleCreateDirectory = useCallback(
    async (parentPath: string, name: string) => {
      try {
        console.log("Creating directory:", parentPath, name);
        await createDirectory(parentPath, name);
        // Refresh the folder to show the new directory
        await handleRefreshFolder();
      } catch (err) {
        console.error("Failed to create directory:", err);
        setError(
          err instanceof Error ? err.message : "Failed to create directory",
        );
        throw err;
      }
    },
    [handleRefreshFolder],
  );

  // Handle delete path
  const handleDeletePath = useCallback(
    async (path: string) => {
      try {
        console.log("Deleting path:", path);
        await deletePath(path);
        // Refresh the folder
        await handleRefreshFolder();
        // Close the file if it's open
        const openFileToClose = openFiles.find((f) => f.path === path);
        if (openFileToClose) {
          closeFile(openFileToClose.id);
        }
      } catch (err) {
        console.error("Failed to delete path:", err);
        setError(err instanceof Error ? err.message : "Failed to delete");
        throw err;
      }
    },
    [handleRefreshFolder, openFiles, closeFile],
  );

  // Handle rename path
  const handleRenamePath = useCallback(
    async (oldPath: string, newName: string) => {
      try {
        console.log("Renaming path:", oldPath, "to", newName);
        await renamePath(oldPath, newName);
        // Refresh the folder
        await handleRefreshFolder();
      } catch (err) {
        console.error("Failed to rename path:", err);
        setError(err instanceof Error ? err.message : "Failed to rename");
        throw err;
      }
    },
    [handleRefreshFolder],
  );

  // Handle editor content change
  const handleContentChange = useCallback(
    (fileId: string, content: string) => {
      updateFileContent(fileId, content);

      // Update CRDT document if connected
      if (isConnected && documentManager) {
        const file = openFiles.find((f) => f.id === fileId);
        if (file) {
          documentManager.setFile(file.path, content, file.language);
        }
      }
    },
    [updateFileContent, isConnected, documentManager, openFiles],
  );

  // Handle cursor position change
  const handleCursorChange = useCallback(
    (fileId: string, line: number, column: number) => {
      if (isConnected) {
        sendCursorUpdate(fileId, line, column);
      }
    },
    [isConnected, sendCursorUpdate],
  );

  // Handle join room
  const handleJoinRoom = useCallback(
    (roomIdToJoin: string, name: string) => {
      setUserName(name);
      localStorage.setItem("codecollab_username", name);
      connect(roomIdToJoin, name);
      setShowJoinModal(false);
    },
    [connect, setUserName],
  );

  // Handle voice chat join
  const handleJoinVoice = useCallback(async () => {
    try {
      await connectVoice();
    } catch (err) {
      setError(
        "Failed to join voice chat. Please check microphone permissions.",
      );
    }
  }, [connectVoice]);

  // Get active file
  const activeFile = openFiles.find((f) => f.id === activeFileId) || null;

  // Get working directory for terminal
  const workingDirectory = projectPath
    ? projectPath.split("/").pop() || "~"
    : "~";

  if (!isMounted) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#09090b]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <span className="text-gray-400 text-sm">Loading CodeCollab...</span>
        </div>
      </div>
    );
  }

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-[#09090b] text-white font-sans selection:bg-blue-500/30 selection:text-white">
      {/* Activity Bar */}
      <ActivityBar activeView={activeView} setActiveView={handleViewChange} />

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {activeView === "files" && (
          <div className="flex w-full h-full">
            {/* Sidebar */}
            <Sidebar
              projectRoot={projectRoot}
              expandedFolders={expandedFolders}
              onFileClick={handleFileClick}
              onOpenFolder={handleOpenFolder}
              onRefresh={handleRefreshFolder}
              onCreateFile={handleCreateFile}
              onCreateDirectory={handleCreateDirectory}
              onDeletePath={handleDeletePath}
              onRenamePath={handleRenamePath}
              openFiles={openFiles}
              activeFileId={activeFileId}
            />

            {/* Editor Area */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Error Banner */}
              {error && (
                <div className="flex items-center justify-between px-4 py-2 bg-red-500/20 border-b border-red-500/30 text-red-400 text-sm">
                  <span>{error}</span>
                  <button
                    onClick={() => setError(null)}
                    className="p-1 hover:bg-red-500/20 rounded"
                  >
                    <VscClose size={14} />
                  </button>
                </div>
              )}

              {/* Loading Indicator */}
              {isLoading && (
                <div className="flex items-center justify-center px-4 py-2 bg-blue-500/20 border-b border-blue-500/30">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent mr-2" />
                  <span className="text-blue-400 text-sm">Loading...</span>
                </div>
              )}

              {/* Tab Bar */}
              {openFiles.length > 0 && (
                <div className="flex bg-[#0a0a0b] border-b border-gray-800 overflow-x-auto">
                  {openFiles.map((file) => (
                    <div
                      key={file.id}
                      onClick={() => setActiveFile(file.id)}
                      className={`
                        group flex items-center gap-2 px-4 py-2 text-sm border-r border-gray-800 cursor-pointer
                        ${
                          activeFileId === file.id
                            ? "bg-[#111113] text-white border-t-2 border-t-blue-500"
                            : "text-gray-400 hover:bg-[#111113] border-t-2 border-t-transparent"
                        }
                      `}
                    >
                      <span className="truncate max-w-[120px]">
                        {file.name}
                      </span>
                      {file.isDirty && (
                        <span className="w-2 h-2 rounded-full bg-blue-400" />
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          closeFile(file.id);
                        }}
                        className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-gray-700"
                      >
                        <VscClose size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Editor */}
              <div
                className="flex-1 overflow-hidden"
                style={{
                  marginBottom: isTerminalOpen ? 0 : 0,
                }}
              >
                {activeFile ? (
                  <CodeEditor
                    file={activeFile}
                    collaborators={collaborators}
                    onContentChange={(content) =>
                      handleContentChange(activeFile.id, content)
                    }
                    onCursorChange={(line, col) =>
                      handleCursorChange(activeFile.id, line, col)
                    }
                    onSave={() => handleSaveFile(activeFile.id)}
                  />
                ) : (
                  <div className="flex-1 h-full flex flex-col items-center justify-center text-gray-500 bg-[#0c0c0d]">
                    <div className="text-6xl mb-4 opacity-20">📝</div>
                    <p className="text-lg mb-2">No file open</p>
                    <p className="text-sm text-gray-600 mb-4">
                      {projectRoot
                        ? "Select a file from the sidebar to start editing"
                        : "Open a folder to start working on your project"}
                    </p>
                    {!projectRoot && (
                      <button
                        onClick={handleOpenFolder}
                        disabled={isLoading}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 rounded-lg text-white text-sm transition-colors"
                      >
                        {isLoading ? "Loading..." : "Open Folder"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Collaboration Panel */}
            {showCollaborators && (
              <CollaborationPanel
                isConnected={isConnected}
                roomId={roomId}
                collaborators={collaborators}
                connectionStatus={connectionStatus}
                onJoinRoom={() => setShowJoinModal(true)}
                onLeaveRoom={disconnect}
                // Voice chat props
                isInVoiceChat={isVoiceConnected}
                isMuted={isMuted}
                isSpeaking={isSpeaking}
                voicePeerCount={participantCount}
                onJoinVoice={handleJoinVoice}
                onLeaveVoice={disconnectVoice}
                onToggleMute={toggleMute}
              />
            )}
          </div>
        )}

        {activeView === "testing" && (
          <div className="w-full h-full">
            <ApiTester />
          </div>
        )}

        {activeView === "chat" && (
          <div className="w-full h-full">
            <AiChat />
          </div>
        )}
      </div>

      {/* Terminal */}
      <Terminal
        isOpen={isTerminalOpen}
        onClose={handleTerminalClose}
        onToggle={handleTerminalToggle}
        workingDirectory={`~/${workingDirectory}`}
      />

      {/* Floating Buttons */}
      <div className="fixed bottom-6 right-6 flex items-center gap-3 z-50">
        {/* Terminal Button */}
        {!isTerminalOpen && activeView === "files" && (
          <button
            onClick={handleTerminalToggle}
            className="p-3 rounded-full shadow-lg transition-all bg-gray-700 hover:bg-gray-600"
            title="Open Terminal"
          >
            <VscTerminal size={20} />
          </button>
        )}

        {/* Collaboration Button */}
        <button
          onClick={toggleCollaborators}
          className={`
            p-4 rounded-full shadow-lg transition-all
            ${
              isConnected
                ? "bg-green-600 hover:bg-green-500"
                : "bg-blue-600 hover:bg-blue-500"
            }
          `}
          title={isConnected ? `Connected to ${roomId}` : "Start Collaboration"}
        >
          <VscLiveShare size={24} />
          {isConnected && collaborators.length > 1 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-xs flex items-center justify-center">
              {collaborators.length}
            </span>
          )}
          {isVoiceConnected && (
            <span className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-400 rounded-full border-2 border-[#09090b] animate-pulse" />
          )}
        </button>
      </div>

      {/* Join Room Modal */}
      {showJoinModal && (
        <JoinRoomModal
          defaultName={userName}
          onJoin={handleJoinRoom}
          onClose={() => setShowJoinModal(false)}
        />
      )}
    </main>
  );
}
