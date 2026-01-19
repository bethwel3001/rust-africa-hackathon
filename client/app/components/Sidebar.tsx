import { useState } from "react";
import { 
  VscNewFile, VscNewFolder, VscTrash, VscEdit, 
  VscChevronDown, VscChevronRight, VscCode, VscJson 
} from "react-icons/vsc";
import { FaRust, FaFolder, FaFolderOpen } from "react-icons/fa";
import { FileSystemItem, ItemType } from "../page";

interface SidebarProps {
  fileSystem: FileSystemItem[];
  activeFileId: string | null;
  onOpenFile: (id: string) => void;
  onCreate: (parentId: string | null, type: ItemType) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, newName: string) => void;
  onToggleFolder: (id: string) => void;
}

export default function Sidebar({ 
  fileSystem, activeFileId, onOpenFile, onCreate, onDelete, onRename, onToggleFolder 
}: SidebarProps) {
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const getIcon = (item: FileSystemItem) => {
    if (item.type === "folder") {
      return item.isOpen ? <FaFolderOpen className="text-blue-400" /> : <FaFolder className="text-blue-400" />;
    }
    if (item.name.endsWith(".rs")) return <FaRust className="text-orange-400" />;
    if (item.name.endsWith(".toml") || item.name.endsWith(".json")) return <VscJson className="text-yellow-400" />;
    return <VscCode className="text-gray-400" />;
  };

  const startEditing = (e: React.MouseEvent, item: FileSystemItem) => {
    e.stopPropagation();
    setEditingId(item.id);
    setEditName(item.name);
  };

  const saveName = () => {
    if (editingId && editName.trim()) {
      onRename(editingId, editName);
    }
    setEditingId(null);
  };

  const renderTree = (parentId: string | null, depth: number = 0) => {
    const items = fileSystem.filter(item => item.parentId === parentId);
    
    if (items.length === 0) return null;

    return items.map(item => (
      <div key={item.id}>
        <div 
          onClick={() => item.type === "folder" ? onToggleFolder(item.id) : onOpenFile(item.id)}
          className={`
            group relative flex items-center py-1 cursor-pointer border-l-[3px] transition-all duration-150 ease-in-out select-none
            ${activeFileId === item.id 
              ? "bg-blue-500/10 border-blue-500 text-blue-400" 
              : "border-transparent text-gray-400 hover:bg-[#27272a] hover:text-white hover:border-gray-600"
            }
          `}
          style={{ paddingLeft: `${depth * 12 + 12}px` }}
        >
          <span className="mr-1 w-4 flex justify-center text-gray-500 group-hover:text-white transition-colors">
            {item.type === "folder" && (
              item.isOpen ? <VscChevronDown size={14} /> : <VscChevronRight size={14} />
            )}
          </span>

          <span className="mr-2 opacity-90 text-[13px]">{getIcon(item)}</span>

          {editingId === item.id ? (
            <input
              autoFocus
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => e.key === "Enter" && saveName()}
              onClick={(e) => e.stopPropagation()}
              className="bg-black text-white px-1 rounded w-full outline-none border border-blue-500 text-[13px] font-sans"
            />
          ) : (
            <span className="truncate flex-1 text-[13px] font-medium font-sans tracking-tight">{item.name}</span>
          )}

          {editingId !== item.id && (
            <div className="absolute right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-[#27272a] pl-2 shadow-[-10px_0_10px_-5px_#27272a]">
               {item.type === "folder" && (
                 <>
                  <button onClick={(e) => { e.stopPropagation(); onCreate(item.id, "file"); }} className="p-1 text-gray-400 hover:text-white hover:bg-gray-600 rounded"><VscNewFile size={13} /></button>
                  <button onClick={(e) => { e.stopPropagation(); onCreate(item.id, "folder"); }} className="p-1 text-gray-400 hover:text-white hover:bg-gray-600 rounded"><VscNewFolder size={13} /></button>
                 </>
               )}
               <button onClick={(e) => startEditing(e, item)} className="p-1 text-gray-400 hover:text-blue-400 hover:bg-gray-600 rounded"><VscEdit size={13} /></button>
               <button onClick={(e) => { e.stopPropagation(); onDelete(item.id); }} className="p-1 text-gray-400 hover:text-red-400 hover:bg-gray-600 rounded"><VscTrash size={13} /></button>
            </div>
          )}
        </div>

        {item.type === "folder" && item.isOpen && renderTree(item.id, depth + 1)}
      </div>
    ));
  };

  // Helper component for the Header Action Buttons
  const ActionButton = ({ onClick, icon, label }: { onClick: () => void, icon: React.ReactNode, label: string }) => (
    <div className="relative group">
        <button 
            onClick={onClick} 
            className="text-gray-400 hover:text-white bg-transparent hover:bg-[#27272a] p-2 rounded-lg transition-all duration-200 active:scale-95 border border-transparent hover:border-gray-700"
        >
            {icon}
        </button>
        {/* Tooltip */}
        <div className="absolute top-full right-0 mt-2 hidden group-hover:flex bg-gray-900 text-white text-[10px] font-bold px-2 py-1 rounded border border-gray-700 whitespace-nowrap z-50 shadow-xl">
            {label}
        </div>
    </div>
  );

  return (
    <div className="w-64 h-full bg-[#050505] border-r border-gray-800 flex flex-col font-sans">
      {/* Header */}
      <div className="h-12 px-4 flex justify-between items-center border-b border-gray-800/50 bg-[#050505]">
        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Explorer</span>
        <div className="flex gap-1">
            <ActionButton onClick={() => onCreate(null, "file")} icon={<VscNewFile size={16} />} label="New File" />
            <ActionButton onClick={() => onCreate(null, "folder")} icon={<VscNewFolder size={16} />} label="New Folder" />
        </div>
      </div>
      
      {/* List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar pt-2">
        {renderTree(null)}
      </div>
    </div>
  );
}