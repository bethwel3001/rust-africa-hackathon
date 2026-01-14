import { VscClose } from "react-icons/vsc";
import { FileSystemItem, Collaborator } from "../page";

interface CodeEditorProps {
  activeFile: FileSystemItem | undefined;
  openFiles: FileSystemItem[];
  collaborators: Collaborator[];
  onCloseFile: (id: string, e: React.MouseEvent) => void;
  onSwitchFile: (id: string) => void;
  onUpdateContent: (id: string, content: string) => void;
}

export default function CodeEditor({ 
  activeFile, openFiles, collaborators, onCloseFile, onSwitchFile, onUpdateContent 
}: CodeEditorProps) {
  
  return (
    <div className="flex-1 h-full bg-[#09090b] flex flex-col min-w-0 font-sans">
        
        {/* Tab Bar (Matches Sidebar Font) */}
        <div className="flex bg-[#101012] border-b border-gray-800 overflow-x-auto no-scrollbar">
            {openFiles.map(file => (
                <div 
                    key={file.id}
                    onClick={() => onSwitchFile(file.id)}
                    className={`
                        group flex items-center gap-2 px-3 py-2.5 text-[13px] cursor-pointer border-r border-gray-800 min-w-[120px] max-w-[200px] select-none
                        ${activeFile?.id === file.id 
                            ? "bg-[#09090b] text-white border-t-2 border-t-blue-500" 
                            : "bg-[#101012] text-gray-500 hover:bg-[#18181b] border-t-2 border-t-transparent"
                        }
                    `}
                >
                    <span className="truncate flex-1">{file.name}</span>
                    <button 
                        onClick={(e) => onCloseFile(file.id, e)}
                        className={`p-0.5 rounded-md hover:bg-gray-700 ${activeFile?.id === file.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                    >
                        <VscClose size={14} />
                    </button>
                </div>
            ))}
        </div>

        {/* EDITOR AREA */}
        {activeFile ? (
            <div className="flex-1 relative flex flex-col">
                <div className="absolute top-2 right-4 z-30 flex items-center gap-3 bg-[#09090b]/80 backdrop-blur-sm px-3 py-1 rounded-full border border-gray-800 transition-opacity hover:opacity-100">
                    <div className="flex -space-x-2">
                        {collaborators.map((user) => (
                            <div 
                                key={user.id} 
                                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white border-2 border-[#101012] relative cursor-help"
                                style={{ backgroundColor: user.color }}
                                title={`${user.name} is editing...`}
                            >
                                {user.name.charAt(0)}
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex-1 flex overflow-hidden relative">
                    {/* Line Numbers (Matches Sidebar Font) */}
                    <div className="w-12 pt-8 text-right text-gray-600 bg-[#09090b] select-none text-[13px] leading-6 pr-3 border-r border-gray-800/30 font-mono">
                        {Array.from({ length: 50 }).map((_, i) => (
                            <div key={i}>{i + 1}</div>
                        ))}
                    </div>

                    <div className="relative flex-1 h-full">
                        {/* INPUT AREA (Matched Text Size) */}
                        <textarea 
                            value={activeFile.content || ""}
                            onChange={(e) => onUpdateContent(activeFile.id, e.target.value)}
                            className="absolute inset-0 w-full h-full bg-transparent text-gray-300 p-8 pl-4 font-mono text-[13px] leading-6 resize-none focus:outline-none custom-scrollbar z-10"
                            spellCheck={false}
                        />

                        {/* Cursors */}
                        <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden">
                             {collaborators.map((user) => {
                                 if (user.name === "You" || !user.cursorX || !user.cursorY) return null;
                                 return (
                                     <div 
                                        key={user.id}
                                        className="absolute flex flex-col items-start transition-all duration-100 ease-linear"
                                        style={{ top: `${user.cursorY}px`, left: `${user.cursorX}px` }}
                                     >
                                        <div className="h-5 w-[2px] animate-pulse" style={{ backgroundColor: user.color }} />
                                        <div className="px-1.5 py-0.5 text-[9px] text-white rounded-br-md rounded-bl-md shadow-lg" style={{ backgroundColor: user.color }}>
                                            {user.name}
                                        </div>
                                     </div>
                                 );
                             })}
                        </div>
                    </div>
                </div>
            </div>
        ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-600">
                <p>Select a file to start coding</p>
            </div>
        )}
    </div>
  );
}