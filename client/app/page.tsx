"use client";
import { useState, useEffect } from "react";
import ActivityBar from "./components/ActivityBar";
import Sidebar from "./components/Sidebar";
import CodeEditor from "./components/CodeEditor";
import ApiTester from "./components/ApiTester";
import AiChat from "./components/AiChat";
export interface FileItem {
  id: string;
  name: string;
  language: "rust" | "json" | "javascript";
  content: string;
}

export interface Collaborator {
  id: string;
  name: string;
  color: string;
  avatar?: string;
}

export default function Home() {
  const [activeView, setActiveView] = useState("files");
  const [isMounted, setIsMounted] = useState(false);

  // --- 1. STATE: File System ---
  const [files, setFiles] = useState<FileItem[]>([
    { id: "1", name: "main.rs", language: "rust", content: "fn main() {\n    println!(\"Hello, world!\");\n}" },
    { id: "2", name: "lib.rs", language: "rust", content: "pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}" },
    { id: "3", name: "Cargo.toml", language: "json", content: "[package]\nname = \"hackathon_project\"\nversion = \"0.1.0\"" },
  ]);
  const [activeFileId, setActiveFileId] = useState<string>("1");

  // --- 2. STATE: Collaboration ---
  const [collaborators] = useState<Collaborator[]>([
    { id: "u1", name: "You", color: "#3b82f6" }, 
    { id: "u2", name: "Sarah", color: "#a855f7" }, 
    { id: "u3", name: "Mike", color: "#22c55e" }, 
  ]);

  // --- 3. HANDLERS ---
  const handleCreateFile = () => {
    const newFile: FileItem = {
      id: Date.now().toString(),
      name: "untitled.rs",
      language: "rust",
      content: "// Start coding...",
    };
    setFiles([...files, newFile]);
    setActiveFileId(newFile.id);
  };

  const handleDeleteFile = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (files.length === 1) return; // Don't delete last file
    const newFiles = files.filter((f) => f.id !== id);
    setFiles(newFiles);
    if (activeFileId === id) setActiveFileId(newFiles[0].id);
  };

  const handleRenameFile = (id: string, newName: string) => {
    setFiles(files.map((f) => (f.id === id ? { ...f, name: newName } : f)));
  };

  // --- Persistence Logic ---
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

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-black text-white font-sans selection:bg-blue-500 selection:text-white">
      <ActivityBar activeView={activeView} setActiveView={handleViewChange} />

      <div className="flex-1 flex overflow-hidden">
        {activeView === "files" && (
          <div className="flex w-full h-full animate-in fade-in duration-300">
            {/* Pass Props to Sidebar */}
            <Sidebar 
              files={files} 
              activeFileId={activeFileId} 
              onFileClick={setActiveFileId}
              onCreate={handleCreateFile}
              onDelete={handleDeleteFile}
              onRename={handleRenameFile}
            />
            {/* Pass Props to Editor */}
            <CodeEditor 
              file={files.find(f => f.id === activeFileId) || files[0]} 
              collaborators={collaborators}
            />
          </div>
        )}

        {activeView === "testing" && (
          <div className="w-full h-full animate-in slide-in-from-bottom-2 duration-300">
            <ApiTester />
          </div>
        )}

        {activeView === "chat" && (
          <div className="w-full h-full animate-in slide-in-from-right-4 duration-300">
            <AiChat />
          </div>
        )}
      </div>
    </main>
  );
}