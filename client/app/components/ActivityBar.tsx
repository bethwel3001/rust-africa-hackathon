import { VscFiles, VscBeaker, VscCommentDiscussion, VscSettingsGear } from "react-icons/vsc";

interface ActivityBarProps {
  activeView: string;
  setActiveView: (view: string) => void;
}

export default function ActivityBar({ activeView, setActiveView }: ActivityBarProps) {
  const icons = [
    { id: 'files', icon: <VscFiles size={24} /> },
    { id: 'testing', icon: <VscBeaker size={24} /> },
    { id: 'chat', icon: <VscCommentDiscussion size={24} /> },
  ];

  return (
    <div className="w-16 h-full bg-black border-r border-border flex flex-col items-center py-4 justify-between">
      <div className="flex flex-col gap-6">
        {icons.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveView(item.id)}
            className={`p-3 rounded-xl transition-all duration-200 ${
              activeView === item.id 
                ? "text-primary bg-primary-dim" 
                : "text-gray-500 hover:text-white"
            }`}
          >
            {item.icon}
          </button>
        ))}
      </div>
      <div className="pb-4 text-gray-500 hover:text-white cursor-pointer">
        <VscSettingsGear size={24} />
      </div>
    </div>
  );
}