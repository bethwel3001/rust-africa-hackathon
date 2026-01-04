import { useState } from "react";
import { VscNewFile, VscTrash, VscEdit, VscChevronDown, VscCode, VscJson } from "react-icons/vsc";
import { FaRust } from "react-icons/fa";
import { FileItem } from "../page"; 

interface SidebarProps {
  files: FileItem[];
  activeFileId: string;
  onFileClick: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
  onRename: (id: string, newName: string) => void;
}

export default function Sidebar({ files, activeFileId, onFileClick, onCreate, onDelete, onRename }: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const startEditing = (e: React.MouseEvent, file: FileItem) => {
    e.stopPropagation();
    setEditingId(file.id);
    setEditName(file.name);
  };

  const saveName = () => {
    if (editingId && editName.trim()) {
      onRename(editingId, editName);
    }
    setEditingId(null);
  };

  const getIcon = (name: string) => {
    if (name.endsWith(".rs")) return <FaRust className="text-orange-400" />;
    if (name.endsWith(".toml") || name.endsWith(".json")) return <VscJson className="text-yellow-400" />;
    return <VscCode className="text-blue-400" />;
  };

  return (
    <div className="w-64 h-full bg-[#101012] border-r border-gray-800 flex flex-col">
      {/* Header */}
      <div className="p-4 flex justify-between items-center group">
        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Explorer</span>
        <button 
          onClick={onCreate}
          className="text-gray-400 hover:text-white p-1 rounded hover:bg-gray-800 transition-colors" 
          title="New File"
        >
          <VscNewFile />
        </button>
      </div>
      
      {/* File Tree */}
      <div className="flex flex-col text-sm">
        <div className="px-2 py-1 flex items-center text-gray-400 font-bold mb-1">
          <VscChevronDown className="mr-1" />
          <span>PROJECT-ROOT</span>
        </div>
        
        {files.map((file) => (
          <div 
            key={file.id}
            onClick={() => onFileClick(file.id)}
            className={`
              group relative flex items-center px-4 py-1.5 cursor-pointer border-l-2 transition-all
              ${activeFileId === file.id 
                ? "bg-blue-500/10 border-blue-500 text-blue-400" 
                : "border-transparent text-gray-400 hover:bg-[#18181b] hover:text-gray-200"
              }
            `}
          >
            {/* File Icon & Name (or Input) */}
            <span className="mr-2 text-base opacity-80">{getIcon(file.name)}</span>
            
            {editingId === file.id ? (
              <input
                autoFocus
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => e.key === "Enter" && saveName()}
                onClick={(e) => e.stopPropagation()}
                className="bg-gray-800 text-white px-1 rounded w-full outline-none border border-blue-500 text-xs"
              />
            ) : (
              <span className="truncate flex-1">{file.name}</span>
            )}

            {/* Hover Actions (Rename / Delete) */}
            {editingId !== file.id && (
              <div className="absolute right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-[#18181b] pl-2 shadow-[-10px_0_10px_-5px_#18181b]">
                <button 
                  onClick={(e) => startEditing(e, file)}
                  className="p-1 hover:text-white hover:bg-gray-700 rounded"
                >
                  <VscEdit size={12} />
                </button>
                <button 
                  onClick={(e) => onDelete(file.id, e)}
                  className="p-1 hover:text-red-400 hover:bg-gray-700 rounded"
                >
                  <VscTrash size={12} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}