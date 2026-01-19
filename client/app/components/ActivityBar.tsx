import {
  VscFiles,
  VscBeaker,
  VscCommentDiscussion,
  VscSettingsGear,
  VscLiveShare,
} from "react-icons/vsc";
import { useCollaborationStore } from "../store";

interface ActivityBarProps {
  activeView: "files" | "testing" | "chat";
  setActiveView: (view: "files" | "testing" | "chat") => void;
}

export default function ActivityBar({
  activeView,
  setActiveView,
}: ActivityBarProps) {
  const { isConnected, collaborators } = useCollaborationStore();

  const icons = [
    { id: "files" as const, icon: <VscFiles size={24} />, label: "Explorer" },
    {
      id: "testing" as const,
      icon: <VscBeaker size={24} />,
      label: "API Testing",
    },
    {
      id: "chat" as const,
      icon: <VscCommentDiscussion size={24} />,
      label: "AI Chat",
    },
  ];

  return (
    <div className="w-14 h-full bg-[#09090b] border-r border-gray-800/50 flex flex-col items-center py-3 justify-between">
      {/* Top Icons */}
      <div className="flex flex-col gap-1">
        {icons.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveView(item.id)}
            title={item.label}
            className={`
              relative p-3 rounded-lg transition-all duration-200
              ${
                activeView === item.id
                  ? "text-white bg-gray-800/80"
                  : "text-gray-500 hover:text-gray-300 hover:bg-gray-800/40"
              }
            `}
          >
            {/* Active indicator */}
            {activeView === item.id && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-6 bg-blue-500 rounded-r" />
            )}
            {item.icon}
          </button>
        ))}
      </div>

      {/* Bottom Icons */}
      <div className="flex flex-col gap-1">
        {/* Collaboration Status */}
        <div
          className={`
            relative p-3 rounded-lg
            ${isConnected ? "text-green-400" : "text-gray-500"}
          `}
          title={
            isConnected
              ? `Connected (${collaborators.length} users)`
              : "Not connected"
          }
        >
          <VscLiveShare size={24} />
          {isConnected && (
            <span className="absolute bottom-2 right-2 w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          )}
          {isConnected && collaborators.length > 1 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-blue-500 rounded-full text-[10px] flex items-center justify-center text-white font-medium">
              {collaborators.length}
            </span>
          )}
        </div>

        {/* Settings */}
        <button
          className="p-3 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800/40 transition-all duration-200"
          title="Settings"
        >
          <VscSettingsGear size={24} />
        </button>
      </div>
    </div>
  );
}
