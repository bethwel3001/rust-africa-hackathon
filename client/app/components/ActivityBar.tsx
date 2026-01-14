import { VscFiles, VscBeaker } from "react-icons/vsc";

interface ActivityBarProps {
  activeView: string;
  setActiveView: (view: string) => void;
}

export default function ActivityBar({ activeView, setActiveView }: ActivityBarProps) {
  const icons = [
    { 
      id: 'files', 
      label: 'Explorer',
      icon: <VscFiles size={32} strokeWidth={0.5} /> 
    },
    { 
      id: 'testing', 
      label: 'API Tester',
      icon: <VscBeaker size={32} strokeWidth={0.5} /> 
    },
  ];

  return (
    <div className="w-20 h-full bg-[#050505] border-r border-gray-800 flex flex-col items-center py-6 z-40 relative">
      
      <div className="flex flex-col gap-8 w-full px-2">
        {icons.map((item) => (
          <div key={item.id} className="relative group flex justify-center">
            
            {/* Active Indicator */}
            {activeView === item.id && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-10 bg-blue-500 rounded-r-full shadow-[0_0_15px_rgba(59,130,246,0.8)]" />
            )}

            <button
              onClick={() => setActiveView(item.id)}
              className={`
                p-4 rounded-2xl transition-all duration-200 relative cursor-pointer
                ${activeView === item.id 
                  ? "text-blue-400 bg-blue-500/10 scale-105" 
                  : "text-gray-500 hover:text-white hover:bg-gray-800 hover:scale-105 hover:shadow-lg"
                }
              `}
            >
              {item.icon}
            </button>

            {/* Tooltip */}
            <div className="absolute left-20 top-1/2 -translate-y-1/2 bg-gray-900 text-white text-xs font-bold px-3 py-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap border border-gray-700 shadow-xl z-50">
              {item.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}