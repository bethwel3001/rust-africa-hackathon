"use client";
import { useState, useEffect, useRef } from "react";
import { VscNewFile, VscNewFolder, VscClose } from "react-icons/vsc";

interface NewItemModalProps {
  isOpen: boolean;
  type: "file" | "folder";
  onClose: () => void;
  onSubmit: (name: string) => void;
}

export default function NewItemModal({ isOpen, type, onClose, onSubmit }: NewItemModalProps) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setName("");
      // Auto-focus input for speed
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) onSubmit(name);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <form 
        onSubmit={handleSubmit}
        className="w-96 bg-[#101012] border border-gray-700 rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-800 flex justify-between items-center bg-[#18181b]">
          <span className="text-sm font-semibold flex items-center gap-2 text-gray-200">
            {type === "file" ? <VscNewFile className="text-blue-400"/> : <VscNewFolder className="text-blue-400"/>}
            Create New {type === "file" ? "File" : "Folder"}
          </span>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-white">
            <VscClose />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 flex flex-col gap-4">
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase block mb-1.5">Name</label>
            <input 
              ref={inputRef}
              type="text" 
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={type === "file" ? "e.g., component.rs" : "e.g., src"}
              className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-[#18181b] border-t border-gray-800 flex justify-end gap-2">
          <button 
            type="button" 
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button 
            type="submit"
            disabled={!name.trim()}
            className="px-4 py-1.5 text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create
          </button>
        </div>
      </form>
    </div>
  );
}