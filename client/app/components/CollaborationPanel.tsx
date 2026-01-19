"use client";

import { useState, useEffect } from "react";
import {
  VscAccount,
  VscBroadcast,
  VscCircleFilled,
  VscCopy,
  VscCheck,
  VscMute,
  VscUnmute,
  VscCallOutgoing,
  VscClose,
  VscLinkExternal,
  VscCallIncoming,
  VscDebugDisconnect,
} from "react-icons/vsc";
import { Collaborator } from "../store";
import { cn } from "../lib/utils";

interface CollaborationPanelProps {
  isConnected: boolean;
  roomId: string | null;
  collaborators: Collaborator[];
  connectionStatus:
    | "disconnected"
    | "connecting"
    | "connected"
    | "reconnecting"
    | "error";
  onJoinRoom: () => void;
  onLeaveRoom: () => void;
  // Voice chat props
  isInVoiceChat?: boolean;
  isMuted?: boolean;
  isDeafened?: boolean;
  isSpeaking?: boolean;
  voicePeerCount?: number;
  onJoinVoice?: () => void;
  onLeaveVoice?: () => void;
  onToggleMute?: () => void;
  onToggleDeafen?: () => void;
}

export default function CollaborationPanel({
  isConnected,
  roomId,
  collaborators,
  connectionStatus,
  onJoinRoom,
  onLeaveRoom,
  isInVoiceChat = false,
  isMuted = false,
  isDeafened = false,
  isSpeaking = false,
  voicePeerCount = 0,
  onJoinVoice,
  onLeaveVoice,
  onToggleMute,
  onToggleDeafen,
}: CollaborationPanelProps) {
  const [copied, setCopied] = useState(false);
  const [showVoiceTooltip, setShowVoiceTooltip] = useState(false);

  const handleCopyRoomId = () => {
    if (roomId) {
      navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case "connected":
        return "text-green-400";
      case "connecting":
        return "text-yellow-400";
      case "error":
        return "text-red-400";
      default:
        return "text-gray-500";
    }
  };

  const getStatusText = () => {
    switch (connectionStatus) {
      case "connected":
        return "Connected";
      case "connecting":
        return "Connecting...";
      case "error":
        return "Connection Error";
      default:
        return "Disconnected";
    }
  };

  // Count collaborators in voice chat
  const voiceParticipants = collaborators.filter((c) => c.isInVoiceChat);

  return (
    <div className="w-72 h-full bg-[#0c0c0d] border-l border-gray-800/50 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-800/50">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <VscBroadcast size={16} className="text-blue-400" />
            Collaboration
          </h2>
          <div
            className={cn(
              "flex items-center gap-1.5 text-xs",
              getStatusColor(),
            )}
          >
            <VscCircleFilled
              size={8}
              className={
                connectionStatus === "connecting" ? "animate-pulse" : ""
              }
            />
            {getStatusText()}
          </div>
        </div>

        {/* Room Info or Join Button */}
        {isConnected && roomId ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between bg-gray-800/50 rounded-lg px-3 py-2">
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">
                  Room ID
                </p>
                <p className="text-sm font-mono text-gray-300">{roomId}</p>
              </div>
              <button
                onClick={handleCopyRoomId}
                className="p-2 hover:bg-gray-700 rounded-md transition-colors text-gray-400 hover:text-white"
                title="Copy Room ID"
              >
                {copied ? (
                  <VscCheck size={14} className="text-green-400" />
                ) : (
                  <VscCopy size={14} />
                )}
              </button>
            </div>

            <button
              onClick={onLeaveRoom}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-red-600/10 hover:bg-red-600/20 text-red-400 rounded-lg text-sm transition-colors"
            >
              <VscClose size={14} />
              Leave Room
            </button>
          </div>
        ) : (
          <button
            onClick={onJoinRoom}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-all active:scale-98"
          >
            <VscLinkExternal size={14} />
            Join or Create Room
          </button>
        )}
      </div>

      {/* Collaborators List */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 px-1">
            Collaborators ({collaborators.length})
          </h3>

          {collaborators.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-gray-600">
              <VscAccount size={32} className="mb-2 opacity-30" />
              <p className="text-sm">No collaborators</p>
              <p className="text-xs text-gray-700 mt-1">
                {isConnected
                  ? "Waiting for others to join..."
                  : "Join a room to collaborate"}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {collaborators.map((collaborator) => (
                <div
                  key={collaborator.id}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-800/30 transition-colors group",
                    collaborator.isInVoiceChat &&
                      "bg-green-500/5 border border-green-500/20",
                  )}
                >
                  {/* Avatar with speaking indicator */}
                  <div className="relative">
                    <div
                      className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0 transition-all",
                        collaborator.isInVoiceChat &&
                          "ring-2 ring-green-500 ring-offset-2 ring-offset-[#0c0c0d]",
                      )}
                      style={{ backgroundColor: collaborator.color }}
                    >
                      {collaborator.name.charAt(0).toUpperCase()}
                    </div>
                    {/* Online indicator */}
                    <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-[#0c0c0d]" />
                  </div>

                  {/* Name & Status */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-200 truncate">
                      {collaborator.name}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <VscCircleFilled
                        size={6}
                        className={
                          collaborator.isInVoiceChat
                            ? "text-green-400"
                            : "text-gray-500"
                        }
                      />
                      <span className="text-[10px] text-gray-500">
                        {collaborator.isInVoiceChat ? "In voice" : "Online"}
                      </span>
                      {collaborator.cursorPosition && (
                        <span className="text-[10px] text-gray-600">
                          • Line {collaborator.cursorPosition.line}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Voice Status Icon */}
                  {collaborator.isInVoiceChat && (
                    <div className="text-green-400 animate-pulse">
                      <VscCallOutgoing size={14} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Voice Chat Section */}
      {isConnected && (
        <div className="border-t border-gray-800/50">
          {/* Voice Chat Header */}
          <div className="px-4 pt-4 pb-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                <VscCallIncoming size={12} />
                Voice Chat
              </h3>
              {isInVoiceChat && (
                <span className="text-[10px] text-green-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                  {voicePeerCount + 1} connected
                </span>
              )}
            </div>
          </div>

          {/* Voice Participants */}
          {isInVoiceChat && voiceParticipants.length > 0 && (
            <div className="px-4 pb-2">
              <div className="flex flex-wrap gap-1.5">
                {voiceParticipants.map((p) => (
                  <div
                    key={p.id}
                    className={cn(
                      "flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-medium",
                      "bg-green-500/10 text-green-400 border border-green-500/20",
                    )}
                  >
                    <div
                      className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] text-white"
                      style={{ backgroundColor: p.color }}
                    >
                      {p.name.charAt(0).toUpperCase()}
                    </div>
                    {p.name}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Voice Controls */}
          <div className="p-4 pt-2">
            {isInVoiceChat ? (
              <div className="space-y-3">
                {/* Speaking Indicator */}
                <div
                  className={cn(
                    "flex items-center justify-center gap-2 px-3 py-2 rounded-lg transition-all",
                    isSpeaking
                      ? "bg-green-500/20 border border-green-500/30"
                      : "bg-gray-800/50 border border-gray-700/30",
                  )}
                >
                  <div
                    className={cn(
                      "flex items-center gap-1",
                      isSpeaking && "animate-pulse",
                    )}
                  >
                    {[...Array(3)].map((_, i) => (
                      <div
                        key={i}
                        className={cn(
                          "w-1 rounded-full transition-all duration-150",
                          isSpeaking ? "bg-green-400" : "bg-gray-600",
                          isSpeaking && i === 1 ? "h-4" : "h-2",
                        )}
                        style={{
                          animationDelay: `${i * 100}ms`,
                        }}
                      />
                    ))}
                  </div>
                  <span
                    className={cn(
                      "text-xs font-medium",
                      isSpeaking ? "text-green-400" : "text-gray-500",
                    )}
                  >
                    {isMuted
                      ? "Muted"
                      : isSpeaking
                        ? "Speaking..."
                        : "Not speaking"}
                  </span>
                </div>

                {/* Control Buttons */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={onToggleMute}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
                      isMuted
                        ? "bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-500/30"
                        : "bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700",
                    )}
                  >
                    {isMuted ? (
                      <>
                        <VscMute size={16} />
                        Muted
                      </>
                    ) : (
                      <>
                        <VscUnmute size={16} />
                        Unmute
                      </>
                    )}
                  </button>

                  <button
                    onClick={onLeaveVoice}
                    className="flex items-center justify-center p-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors"
                    title="Leave Voice Chat"
                  >
                    <VscDebugDisconnect size={16} />
                  </button>
                </div>

                {/* Deafen Toggle */}
                <button
                  onClick={onToggleDeafen}
                  className={cn(
                    "w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all",
                    isDeafened
                      ? "bg-orange-600/20 text-orange-400 hover:bg-orange-600/30 border border-orange-500/30"
                      : "bg-gray-800/50 text-gray-500 hover:bg-gray-700/50 border border-gray-700/30",
                  )}
                >
                  {isDeafened
                    ? "Deafened - Click to hear others"
                    : "Deafen (mute incoming audio)"}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <button
                  onClick={onJoinVoice}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium transition-all active:scale-98"
                >
                  <VscCallOutgoing size={16} />
                  Join Voice Chat
                </button>
                <p className="text-[10px] text-gray-600 text-center">
                  Talk with your collaborators in real-time
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="px-4 py-3 border-t border-gray-800/50 bg-gray-900/30">
        <p className="text-[10px] text-gray-600 text-center">
          {isConnected
            ? `${collaborators.length} collaborator${collaborators.length !== 1 ? "s" : ""} in this session`
            : "Start collaborating by joining a room"}
        </p>
      </div>
    </div>
  );
}
