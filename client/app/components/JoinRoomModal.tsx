"use client";

import { useState, useCallback, useEffect } from "react";
import {
  VscClose,
  VscAdd,
  VscLinkExternal,
  VscCopy,
  VscCheck,
  VscDebugDisconnect,
  VscPass,
} from "react-icons/vsc";
import { createRoom, checkServerHealth } from "../hooks/useCollaboration";
import { useCollaborationStore } from "../store";
import { cn } from "../lib/utils";

interface JoinRoomModalProps {
  defaultName: string;
  onJoin: (roomId: string, name: string) => void;
  onClose: () => void;
}

export default function JoinRoomModal({
  defaultName,
  onJoin,
  onClose,
}: JoinRoomModalProps) {
  const [mode, setMode] = useState<"join" | "create">("join");
  const [roomId, setRoomId] = useState("");
  const [displayName, setDisplayName] = useState(defaultName || "");
  const [isCreating, setIsCreating] = useState(false);
  const [createdRoomId, setCreatedRoomId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverStatus, setServerStatus] = useState<
    "checking" | "online" | "offline"
  >("checking");
  const [customServerUrl, setCustomServerUrl] = useState("");

  const { serverUrl, setServerUrl } = useCollaborationStore();

  const effectiveServerUrl =
    customServerUrl.trim() || serverUrl || "http://localhost:5000";

  // Check server health on mount and when server URL changes
  useEffect(() => {
    const checkServer = async () => {
      setServerStatus("checking");
      const result = await checkServerHealth(effectiveServerUrl);
      setServerStatus(result.healthy ? "online" : "offline");
    };

    checkServer();
  }, [effectiveServerUrl]);

  const handleCreateRoom = useCallback(async () => {
    if (!displayName.trim()) {
      setError("Please enter your display name");
      return;
    }

    if (serverStatus !== "online") {
      setError(
        "Cannot create room - server is not available. Make sure the collaboration server is running.",
      );
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      console.log("Creating room with server URL:", effectiveServerUrl);
      const result = await createRoom(
        effectiveServerUrl,
        displayName + "'s Room",
      );

      if (result && result.roomId) {
        setCreatedRoomId(result.roomId);
        // Save the server URL if custom one was used
        if (customServerUrl.trim()) {
          setServerUrl(customServerUrl.trim());
        }
      } else {
        setError(
          "Failed to create room. Check the server connection and try again.",
        );
      }
    } catch (err) {
      console.error("Create room error:", err);
      setError(err instanceof Error ? err.message : "Failed to create room");
    } finally {
      setIsCreating(false);
    }
  }, [
    displayName,
    serverStatus,
    effectiveServerUrl,
    customServerUrl,
    setServerUrl,
  ]);

  const handleJoinRoom = useCallback(() => {
    if (!displayName.trim()) {
      setError("Please enter your display name");
      return;
    }

    const targetRoomId = createdRoomId || roomId.trim();

    if (!targetRoomId) {
      setError("Please enter a room ID");
      return;
    }

    if (serverStatus !== "online") {
      setError(
        "Cannot join room - server is not available. Make sure the collaboration server is running.",
      );
      return;
    }

    // Save the server URL if custom one was used
    if (customServerUrl.trim()) {
      setServerUrl(customServerUrl.trim());
    }

    onJoin(targetRoomId, displayName.trim());
  }, [
    displayName,
    roomId,
    createdRoomId,
    serverStatus,
    customServerUrl,
    setServerUrl,
    onJoin,
  ]);

  const handleCopyRoomId = () => {
    if (createdRoomId) {
      navigator.clipboard.writeText(createdRoomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isCreating) {
      if (mode === "create" && !createdRoomId) {
        handleCreateRoom();
      } else {
        handleJoinRoom();
      }
    }
    if (e.key === "Escape") {
      onClose();
    }
  };

  const retryServerCheck = async () => {
    setServerStatus("checking");
    setError(null);
    const isHealthy = await checkServerHealth(effectiveServerUrl);
    setServerStatus(isHealthy ? "online" : "offline");
    if (!isHealthy) {
      setError(
        "Server is not responding. Make sure to run: cd server && cargo run",
      );
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md bg-[#0c0c0d] border border-gray-800 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800/50">
          <h2 className="text-lg font-semibold text-white">
            {mode === "join" ? "Join Room" : "Create Room"}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          >
            <VscClose size={18} />
          </button>
        </div>

        {/* Server Status */}
        <div className="px-6 py-3 bg-gray-900/50 border-b border-gray-800/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {serverStatus === "checking" && (
                <>
                  <div className="w-3 h-3 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm text-yellow-400">
                    Checking server...
                  </span>
                </>
              )}
              {serverStatus === "online" && (
                <>
                  <VscPass className="text-green-400" size={16} />
                  <span className="text-sm text-green-400">Server online</span>
                </>
              )}
              {serverStatus === "offline" && (
                <>
                  <VscDebugDisconnect className="text-red-400" size={16} />
                  <span className="text-sm text-red-400">Server offline</span>
                </>
              )}
            </div>
            {serverStatus === "offline" && (
              <button
                onClick={retryServerCheck}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                Retry
              </button>
            )}
          </div>
        </div>

        {/* Mode Tabs */}
        <div className="flex border-b border-gray-800/50">
          <button
            onClick={() => {
              setMode("join");
              setCreatedRoomId(null);
              setError(null);
            }}
            className={cn(
              "flex-1 px-4 py-3 text-sm font-medium transition-all border-b-2",
              mode === "join"
                ? "text-blue-400 border-blue-500 bg-blue-500/5"
                : "text-gray-500 border-transparent hover:text-gray-300",
            )}
          >
            <VscLinkExternal className="inline mr-2" size={14} />
            Join Existing
          </button>
          <button
            onClick={() => {
              setMode("create");
              setError(null);
            }}
            className={cn(
              "flex-1 px-4 py-3 text-sm font-medium transition-all border-b-2",
              mode === "create"
                ? "text-blue-400 border-blue-500 bg-blue-500/5"
                : "text-gray-500 border-transparent hover:text-gray-300",
            )}
          >
            <VscAdd className="inline mr-2" size={14} />
            Create New
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Display Name */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              Your Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Enter your name..."
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent"
              autoFocus
            />
          </div>

          {/* Room ID Input (Join Mode) */}
          {mode === "join" && (
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                Room ID
              </label>
              <input
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder="Enter room ID..."
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-sm font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent"
              />
            </div>
          )}

          {/* Server URL (Advanced) */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              Server URL <span className="text-gray-600">(optional)</span>
            </label>
            <input
              type="text"
              value={customServerUrl}
              onChange={(e) => setCustomServerUrl(e.target.value)}
              placeholder={serverUrl || "http://localhost:5000"}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-sm font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent"
            />
          </div>

          {/* Create Mode - Show Created Room ID */}
          {mode === "create" && createdRoomId && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
              <p className="text-sm text-green-400 mb-2">
                Room created successfully!
              </p>
              <div className="flex items-center justify-between bg-gray-900/50 rounded-lg px-3 py-2">
                <span className="font-mono text-sm text-white">
                  {createdRoomId}
                </span>
                <button
                  onClick={handleCopyRoomId}
                  className="p-1.5 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
                  title="Copy Room ID"
                >
                  {copied ? (
                    <VscCheck size={14} className="text-green-400" />
                  ) : (
                    <VscCopy size={14} />
                  )}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Share this ID with others to invite them
              </p>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Server Offline Help */}
          {serverStatus === "offline" && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-3">
              <p className="text-sm text-yellow-400 font-medium mb-2">
                Server not running
              </p>
              <p className="text-xs text-gray-400 mb-2">
                Start the collaboration server:
              </p>
              <code className="block bg-gray-900 rounded px-3 py-2 text-xs text-gray-300 font-mono">
                cd server && cargo run
              </code>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-800/50 bg-gray-900/30">
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>

            {mode === "create" && !createdRoomId ? (
              <button
                onClick={handleCreateRoom}
                disabled={
                  isCreating || !displayName.trim() || serverStatus !== "online"
                }
                className={cn(
                  "flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all",
                  isCreating || !displayName.trim() || serverStatus !== "online"
                    ? "bg-gray-700 text-gray-500 cursor-not-allowed"
                    : "bg-blue-600 hover:bg-blue-500 text-white active:scale-95",
                )}
              >
                {isCreating ? (
                  <>
                    <div className="w-4 h-4 border-2 border-gray-500 border-t-white rounded-full animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <VscAdd size={14} />
                    Create Room
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={handleJoinRoom}
                disabled={
                  !displayName.trim() ||
                  (!roomId.trim() && !createdRoomId) ||
                  serverStatus !== "online"
                }
                className={cn(
                  "flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all",
                  !displayName.trim() ||
                    (!roomId.trim() && !createdRoomId) ||
                    serverStatus !== "online"
                    ? "bg-gray-700 text-gray-500 cursor-not-allowed"
                    : "bg-green-600 hover:bg-green-500 text-white active:scale-95",
                )}
              >
                <VscLinkExternal size={14} />
                Join Room
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
