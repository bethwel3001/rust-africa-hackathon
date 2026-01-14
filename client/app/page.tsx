"use client";
import { useState, useEffect } from "react";
import ActivityBar from "./components/ActivityBar";
import Sidebar from "./components/Sidebar";
import CodeEditor from "./components/CodeEditor";
import ApiTester from "./components/ApiTester";
import AiChatPopup from "./components/AiChatPopup";
import NewItemModal from "./components/NewItemModal"; // Import Modal

// Types remain the same...
export type ItemType = "file" | "folder";
export interface FileSystemItem {
  id: string;
  parentId: string | null;
  name: string;
  type: ItemType;
  content?: string;
  isOpen?: boolean;
}
export interface Collaborator {
  id: string;
  name: string;
  color: string;
  // BACKEND: In a real app, these coords come from WebSockets (Yjs/CRDT)
  cursorX?: number; 
  cursorY?: number;
}

export default function Home() {
  const [activeView, setActiveView] = useState("files");
  const [isMounted, setIsMounted] = useState(false);

  // --- MODAL STATE ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<ItemType>("file");
  const [modalParentId, setModalParentId] = useState<string | null>(null);

  // --- FILE SYSTEM STATE ---
  const [fileSystem, setFileSystem] = useState<FileSystemItem[]>([
    { id: "root", name: "src", type: "folder", parentId: null, isOpen: true },
    { id: "1", name: "main.rs", type: "file", parentId: "root", content: "fn main() {\n    // Welcome to the Rust Hackathon!\n    println!(\"Hello, world!\");\n}" },
  ]);
  const [openFiles, setOpenFiles] = useState<string[]>(["1"]);
  const [activeFileId, setActiveFileId] = useState<string | null>("1");

  // --- COLLABORATOR STATE (MOCK) ---
  const [collaborators] = useState<Collaborator[]>([
    { id: "u1", name: "You", color: "#3b82f6" }, 
    // Mocking cursor positions for "Sarah"
    { id: "u2", name: "Sarah", color: "#a855f7", cursorX: 180, cursorY: 48 }, 
  ]);

  // --- ACTIONS ---

  // 1. Open Modal (Called from Sidebar)
  const initiateCreate = (parentId: string | null, type: ItemType) => {
    setModalType(type);
    setModalParentId(parentId);
    setIsModalOpen(true);
  };

  // 2. Actually Create Item (Called from Modal)
  const handleConfirmCreate = (name: string) => {
    const newItem: FileSystemItem = {
      id: Date.now().toString(),
      parentId: modalParentId,
      name: name, // User provided name
      type: modalType,
      content: modalType === "file" ? "// " + name : undefined,
      isOpen: true,
    };
    
    setFileSystem([...fileSystem, newItem]);
    if (modalType === "file") handleOpenFile(newItem.id);
    setIsModalOpen(false);
  };

  const handleDeleteItem = (id: string) => {
    const getAllChildrenIds = (itemId: string): string[] => {
      const children = fileSystem.filter((f) => f.parentId === itemId);
      return [itemId, ...children.flatMap((c) => getAllChildrenIds(c.id))];
    };
    const idsToDelete = getAllChildrenIds(id);
    setFileSystem(fileSystem.filter((f) => !idsToDelete.includes(f.id)));
    const newOpenFiles = openFiles.filter(openId => !idsToDelete.includes(openId));
    setOpenFiles(newOpenFiles);
    if (activeFileId && idsToDelete.includes(activeFileId)) {
      setActiveFileId(newOpenFiles.length > 0 ? newOpenFiles[0] : null);
    }
  };

  const handleRenameItem = (id: string, newName: string) => {
    setFileSystem(fileSystem.map((f) => (f.id === id ? { ...f, name: newName } : f)));
  };

  const handleToggleFolder = (id: string) => {
    setFileSystem(fileSystem.map((f) => (f.id === id ? { ...f, isOpen: !f.isOpen } : f)));
  };

  const handleOpenFile = (id: string) => {
    if (!openFiles.includes(id)) setOpenFiles([...openFiles, id]);
    setActiveFileId(id);
  };

  const handleCloseFile = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const newOpenFiles = openFiles.filter((fileId) => fileId !== id);
    setOpenFiles(newOpenFiles);
    if (activeFileId === id) setActiveFileId(newOpenFiles.length > 0 ? newOpenFiles[newOpenFiles.length - 1] : null);
  };

  const handleUpdateContent = (id: string, newContent: string) => {
    // BACKEND: Emit 'code-change' event via WebSocket here
    setFileSystem(fileSystem.map(f => f.id === id ? { ...f, content: newContent } : f));
  };

  useEffect(() => {
    const savedView = localStorage.getItem("activeView");
    if (savedView) setActiveView(savedView);
    setIsMounted(true);
  }, []);

  const handleViewChange = (view: string) => {
    setActiveView(view);
    localStorage.setItem("activeView", view);
  };

  if (!isMounted) return null;
  const activeFile = fileSystem.find(f => f.id === activeFileId);
  const openFileObjects = openFiles.map(id => fileSystem.find(f => f.id === id)).filter(Boolean) as FileSystemItem[];

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-black text-white font-sans selection:bg-blue-500 selection:text-white relative">
      <ActivityBar activeView={activeView} setActiveView={handleViewChange} />

      <div className="flex-1 flex overflow-hidden">
        {activeView === "files" && (
          <div className="flex w-full h-full animate-in fade-in duration-300">
            <Sidebar 
              fileSystem={fileSystem}
              activeFileId={activeFileId}
              onOpenFile={handleOpenFile}
              onCreate={initiateCreate} // Pass logic to open modal
              onDelete={handleDeleteItem}
              onRename={handleRenameItem}
              onToggleFolder={handleToggleFolder}
            />
            <CodeEditor 
              activeFile={activeFile}
              openFiles={openFileObjects}
              collaborators={collaborators}
              onCloseFile={handleCloseFile}
              onSwitchFile={setActiveFileId}
              onUpdateContent={handleUpdateContent}
            />
          </div>
        )}

        {activeView === "testing" && (
            <div className="w-full h-full animate-in slide-in-from-bottom-2 duration-300">
                <ApiTester />
            </div>
        )}
      </div>

      <AiChatPopup />
      
      {/* THE MODAL */}
      <NewItemModal 
        isOpen={isModalOpen}
        type={modalType}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleConfirmCreate}
      />
    </main>
  );
}