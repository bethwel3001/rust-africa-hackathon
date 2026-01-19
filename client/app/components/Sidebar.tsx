"use client";

import { useState, useCallback } from "react";
import {
  VscNewFile,
  VscNewFolder,
  VscRefresh,
  VscCollapseAll,
  VscFolderOpened as VscOpenFolder,
  VscChevronDown,
  VscChevronRight,
  VscFolder,
  VscFolderOpened,
  VscFile,
  VscTrash,
  VscEdit,
  VscSearch,
  VscClose,
} from "react-icons/vsc";
import { FaRust } from "react-icons/fa";
import {
  SiTypescript,
  SiJavascript,
  SiPython,
  SiHtml5,
  SiCss3,
  SiMarkdown,
  SiJson,
  SiToml,
  SiYaml,
} from "react-icons/si";
import { FileNode } from "../lib/tauri";
import { OpenFile } from "../store";

interface SidebarProps {
  projectRoot: FileNode | null;
  expandedFolders: Set<string>;
  onFileClick: (node: FileNode) => void;
  onOpenFolder: () => void;
  onCreateFile?: (dirPath: string, name: string) => Promise<void>;
  onCreateDirectory?: (parentPath: string, name: string) => Promise<void>;
  onDeletePath?: (path: string) => Promise<void>;
  onRenamePath?: (oldPath: string, newName: string) => Promise<void>;
  onRefresh?: () => void;
  openFiles: OpenFile[];
  activeFileId: string | null;
}

function getFileIcon(name: string, isDir: boolean, isExpanded: boolean) {
  if (isDir) {
    return isExpanded ? (
      <VscFolderOpened className="text-yellow-400" size={16} />
    ) : (
      <VscFolder className="text-yellow-400" size={16} />
    );
  }

  const ext = name.split(".").pop()?.toLowerCase() || "";

  switch (ext) {
    case "rs":
      return <FaRust className="text-orange-400" size={14} />;
    case "ts":
    case "tsx":
      return <SiTypescript className="text-blue-400" size={14} />;
    case "js":
    case "jsx":
    case "mjs":
      return <SiJavascript className="text-yellow-400" size={14} />;
    case "py":
      return <SiPython className="text-blue-300" size={14} />;
    case "html":
      return <SiHtml5 className="text-orange-500" size={14} />;
    case "css":
    case "scss":
      return <SiCss3 className="text-blue-500" size={14} />;
    case "md":
      return <SiMarkdown className="text-gray-400" size={14} />;
    case "json":
      return <SiJson className="text-yellow-300" size={14} />;
    case "toml":
      return <SiToml className="text-gray-300" size={14} />;
    case "yaml":
    case "yml":
      return <SiYaml className="text-red-400" size={14} />;
    default:
      return <VscFile className="text-gray-400" size={14} />;
  }
}

interface FileTreeItemProps {
  node: FileNode;
  depth: number;
  expandedFolders: Set<string>;
  onFileClick: (node: FileNode) => void;
  activeFileId: string | null;
  openFiles: OpenFile[];
  onCreateFile?: (dirPath: string, name: string) => Promise<void>;
  onCreateDirectory?: (parentPath: string, name: string) => Promise<void>;
  onDeletePath?: (path: string) => Promise<void>;
  onRenamePath?: (oldPath: string, newName: string) => Promise<void>;
}

function FileTreeItem({
  node,
  depth,
  expandedFolders,
  onFileClick,
  activeFileId,
  openFiles,
  onCreateFile,
  onCreateDirectory,
  onDeletePath,
  onRenamePath,
}: FileTreeItemProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);
  const [showNewFileInput, setShowNewFileInput] = useState(false);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newItemName, setNewItemName] = useState("");

  const isExpanded = expandedFolders.has(node.path);
  const isActive = openFiles.some(
    (f) => f.path === node.path && f.id === activeFileId,
  );
  const isOpen = openFiles.some((f) => f.path === node.path);

  const handleRename = useCallback(async () => {
    if (renameValue.trim() && renameValue !== node.name && onRenamePath) {
      try {
        await onRenamePath(node.path, renameValue.trim());
      } catch (error) {
        console.error("Failed to rename:", error);
      }
    }
    setIsRenaming(false);
  }, [renameValue, node.name, node.path, onRenamePath]);

  const handleDelete = useCallback(async () => {
    if (onDeletePath && confirm(`Delete "${node.name}"?`)) {
      try {
        await onDeletePath(node.path);
      } catch (error) {
        console.error("Failed to delete:", error);
      }
    }
  }, [node.path, node.name, onDeletePath]);

  const handleCreateFile = useCallback(async () => {
    if (newItemName.trim() && onCreateFile) {
      try {
        await onCreateFile(node.path, newItemName.trim());
        setNewItemName("");
        setShowNewFileInput(false);
      } catch (error) {
        console.error("Failed to create file:", error);
      }
    }
  }, [newItemName, node.path, onCreateFile]);

  const handleCreateFolder = useCallback(async () => {
    if (newItemName.trim() && onCreateDirectory) {
      try {
        await onCreateDirectory(node.path, newItemName.trim());
        setNewItemName("");
        setShowNewFolderInput(false);
      } catch (error) {
        console.error("Failed to create folder:", error);
      }
    }
  }, [newItemName, node.path, onCreateDirectory]);

  return (
    <div>
      <div
        className={`
          group flex items-center gap-1.5 py-1 px-2 cursor-pointer text-sm
          transition-colors duration-100
          ${isActive ? "bg-blue-600/20 text-blue-300" : ""}
          ${isOpen && !isActive ? "text-gray-300" : ""}
          ${!isActive && !isOpen ? "text-gray-400 hover:bg-gray-800/50 hover:text-gray-200" : ""}
        `}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => !isRenaming && onFileClick(node)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Expand/Collapse Icon */}
        {node.is_dir ? (
          <span className="w-4 flex-shrink-0 flex items-center justify-center">
            {isExpanded ? (
              <VscChevronDown size={14} />
            ) : (
              <VscChevronRight size={14} />
            )}
          </span>
        ) : (
          <span className="w-4 flex-shrink-0" />
        )}

        {/* File/Folder Icon */}
        <span className="flex-shrink-0">
          {getFileIcon(node.name, node.is_dir, isExpanded)}
        </span>

        {/* Name or Rename Input */}
        {isRenaming ? (
          <input
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
              if (e.key === "Escape") {
                setRenameValue(node.name);
                setIsRenaming(false);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 bg-gray-800 border border-blue-500 rounded px-1 text-sm text-white outline-none"
            autoFocus
          />
        ) : (
          <span className="truncate flex-1">{node.name}</span>
        )}

        {/* Hover Actions */}
        {isHovered && !isRenaming && (
          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {node.is_dir && (
              <>
                <button
                  className="p-1 hover:bg-gray-700 rounded"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowNewFileInput(true);
                    setShowNewFolderInput(false);
                    onFileClick(node); // Expand the folder
                  }}
                  title="New File"
                >
                  <VscNewFile size={12} />
                </button>
                <button
                  className="p-1 hover:bg-gray-700 rounded"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowNewFolderInput(true);
                    setShowNewFileInput(false);
                    onFileClick(node); // Expand the folder
                  }}
                  title="New Folder"
                >
                  <VscNewFolder size={12} />
                </button>
              </>
            )}
            <button
              className="p-1 hover:bg-gray-700 rounded"
              onClick={(e) => {
                e.stopPropagation();
                setIsRenaming(true);
              }}
              title="Rename"
            >
              <VscEdit size={12} />
            </button>
            <button
              className="p-1 hover:bg-gray-700 rounded hover:text-red-400"
              onClick={(e) => {
                e.stopPropagation();
                handleDelete();
              }}
              title="Delete"
            >
              <VscTrash size={12} />
            </button>
          </div>
        )}
      </div>

      {/* Children */}
      {node.is_dir && isExpanded && (
        <div>
          {/* New File Input */}
          {showNewFileInput && (
            <div
              className="flex items-center gap-1.5 py-1 px-2"
              style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
            >
              <span className="w-4" />
              <VscFile className="text-gray-400" size={14} />
              <input
                type="text"
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                onBlur={() => {
                  if (!newItemName.trim()) setShowNewFileInput(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateFile();
                  if (e.key === "Escape") {
                    setNewItemName("");
                    setShowNewFileInput(false);
                  }
                }}
                placeholder="filename.ext"
                className="flex-1 bg-gray-800 border border-blue-500 rounded px-1 text-sm text-white outline-none placeholder-gray-500"
                autoFocus
              />
              <button
                onClick={() => {
                  setNewItemName("");
                  setShowNewFileInput(false);
                }}
                className="p-0.5 hover:bg-gray-700 rounded"
              >
                <VscClose size={12} />
              </button>
            </div>
          )}

          {/* New Folder Input */}
          {showNewFolderInput && (
            <div
              className="flex items-center gap-1.5 py-1 px-2"
              style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
            >
              <span className="w-4" />
              <VscFolder className="text-yellow-400" size={14} />
              <input
                type="text"
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                onBlur={() => {
                  if (!newItemName.trim()) setShowNewFolderInput(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateFolder();
                  if (e.key === "Escape") {
                    setNewItemName("");
                    setShowNewFolderInput(false);
                  }
                }}
                placeholder="folder name"
                className="flex-1 bg-gray-800 border border-blue-500 rounded px-1 text-sm text-white outline-none placeholder-gray-500"
                autoFocus
              />
              <button
                onClick={() => {
                  setNewItemName("");
                  setShowNewFolderInput(false);
                }}
                className="p-0.5 hover:bg-gray-700 rounded"
              >
                <VscClose size={12} />
              </button>
            </div>
          )}

          {/* Child nodes */}
          {node.children?.map((child) => (
            <FileTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              expandedFolders={expandedFolders}
              onFileClick={onFileClick}
              activeFileId={activeFileId}
              openFiles={openFiles}
              onCreateFile={onCreateFile}
              onCreateDirectory={onCreateDirectory}
              onDeletePath={onDeletePath}
              onRenamePath={onRenamePath}
            />
          ))}

          {(!node.children || node.children.length === 0) &&
            !showNewFileInput &&
            !showNewFolderInput && (
              <div
                className="text-gray-600 text-xs italic py-1"
                style={{ paddingLeft: `${(depth + 1) * 12 + 24}px` }}
              >
                Empty folder
              </div>
            )}
        </div>
      )}
    </div>
  );
}

export default function Sidebar({
  projectRoot,
  expandedFolders,
  onFileClick,
  onOpenFolder,
  onCreateFile,
  onCreateDirectory,
  onDeletePath,
  onRenamePath,
  onRefresh,
  openFiles,
  activeFileId,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewFileInput, setShowNewFileInput] = useState(false);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newItemName, setNewItemName] = useState("");

  const handleCreateFileAtRoot = useCallback(async () => {
    if (newItemName.trim() && onCreateFile && projectRoot) {
      try {
        await onCreateFile(projectRoot.path, newItemName.trim());
        setNewItemName("");
        setShowNewFileInput(false);
      } catch (error) {
        console.error("Failed to create file:", error);
      }
    }
  }, [newItemName, projectRoot, onCreateFile]);

  const handleCreateFolderAtRoot = useCallback(async () => {
    if (newItemName.trim() && onCreateDirectory && projectRoot) {
      try {
        await onCreateDirectory(projectRoot.path, newItemName.trim());
        setNewItemName("");
        setShowNewFolderInput(false);
      } catch (error) {
        console.error("Failed to create folder:", error);
      }
    }
  }, [newItemName, projectRoot, onCreateDirectory]);

  return (
    <div className="w-64 h-full bg-[#0c0c0d] border-r border-gray-800/50 flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-gray-800/50">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
            Explorer
          </span>
          <div className="flex gap-1">
            <button
              className="p-1.5 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-50"
              title="New File"
              disabled={!projectRoot}
              onClick={() => {
                setShowNewFileInput(true);
                setShowNewFolderInput(false);
              }}
            >
              <VscNewFile size={14} />
            </button>
            <button
              className="p-1.5 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-50"
              title="New Folder"
              disabled={!projectRoot}
              onClick={() => {
                setShowNewFolderInput(true);
                setShowNewFileInput(false);
              }}
            >
              <VscNewFolder size={14} />
            </button>
            <button
              className="p-1.5 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors"
              title="Refresh"
              onClick={onRefresh}
              disabled={!projectRoot}
            >
              <VscRefresh size={14} />
            </button>
            <button
              className="p-1.5 rounded hover:bg-gray-800 text-blue-400 hover:text-blue-300 transition-colors"
              title="Open Folder"
              onClick={onOpenFolder}
            >
              <VscOpenFolder size={14} />
            </button>
            <button
              className="p-1.5 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors"
              title="Collapse All"
            >
              <VscCollapseAll size={14} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <VscSearch
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500"
            size={14}
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search files..."
            className="w-full bg-gray-800/50 border border-gray-700/50 rounded-md pl-8 pr-3 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all"
          />
        </div>
      </div>

      {/* File Tree */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar py-2">
        {projectRoot ? (
          <div>
            {/* Project Root Header */}
            <div
              className="flex items-center gap-2 px-3 py-1.5 text-gray-300 font-medium text-xs uppercase tracking-wide cursor-pointer hover:bg-gray-800/30"
              onClick={() => onFileClick(projectRoot)}
            >
              <span className="w-4 flex items-center justify-center">
                {expandedFolders.has(projectRoot.path) ? (
                  <VscChevronDown size={14} />
                ) : (
                  <VscChevronRight size={14} />
                )}
              </span>
              <VscFolder className="text-blue-400" size={14} />
              <span className="truncate">{projectRoot.name}</span>
            </div>

            {/* New File Input at Root */}
            {showNewFileInput && expandedFolders.has(projectRoot.path) && (
              <div className="flex items-center gap-1.5 py-1 px-2 ml-6">
                <VscFile className="text-gray-400" size={14} />
                <input
                  type="text"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  onBlur={() => {
                    if (!newItemName.trim()) setShowNewFileInput(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateFileAtRoot();
                    if (e.key === "Escape") {
                      setNewItemName("");
                      setShowNewFileInput(false);
                    }
                  }}
                  placeholder="filename.ext"
                  className="flex-1 bg-gray-800 border border-blue-500 rounded px-1 text-sm text-white outline-none placeholder-gray-500"
                  autoFocus
                />
                <button
                  onClick={() => {
                    setNewItemName("");
                    setShowNewFileInput(false);
                  }}
                  className="p-0.5 hover:bg-gray-700 rounded"
                >
                  <VscClose size={12} />
                </button>
              </div>
            )}

            {/* New Folder Input at Root */}
            {showNewFolderInput && expandedFolders.has(projectRoot.path) && (
              <div className="flex items-center gap-1.5 py-1 px-2 ml-6">
                <VscFolder className="text-yellow-400" size={14} />
                <input
                  type="text"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  onBlur={() => {
                    if (!newItemName.trim()) setShowNewFolderInput(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateFolderAtRoot();
                    if (e.key === "Escape") {
                      setNewItemName("");
                      setShowNewFolderInput(false);
                    }
                  }}
                  placeholder="folder name"
                  className="flex-1 bg-gray-800 border border-blue-500 rounded px-1 text-sm text-white outline-none placeholder-gray-500"
                  autoFocus
                />
                <button
                  onClick={() => {
                    setNewItemName("");
                    setShowNewFolderInput(false);
                  }}
                  className="p-0.5 hover:bg-gray-700 rounded"
                >
                  <VscClose size={12} />
                </button>
              </div>
            )}

            {/* Children */}
            {expandedFolders.has(projectRoot.path) &&
              projectRoot.children?.map((child) => (
                <FileTreeItem
                  key={child.id}
                  node={child}
                  depth={1}
                  expandedFolders={expandedFolders}
                  onFileClick={onFileClick}
                  activeFileId={activeFileId}
                  openFiles={openFiles}
                  onCreateFile={onCreateFile}
                  onCreateDirectory={onCreateDirectory}
                  onDeletePath={onDeletePath}
                  onRenamePath={onRenamePath}
                />
              ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full px-4 text-center">
            <div className="p-4 rounded-full bg-gray-800/30 mb-4">
              <VscFolder className="text-gray-600" size={32} />
            </div>
            <p className="text-gray-500 text-sm mb-2">No folder opened</p>
            <p className="text-gray-600 text-xs mb-4">
              Open a folder to start working on your project
            </p>
            <button
              onClick={onOpenFolder}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-md transition-colors"
            >
              Open Folder
            </button>
          </div>
        )}
      </div>

      {/* Open Editors Section */}
      {openFiles.length > 0 && (
        <div className="border-t border-gray-800/50">
          <div className="px-3 py-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
              Open Editors
            </span>
            <span className="text-[10px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">
              {openFiles.length}
            </span>
          </div>
          <div className="pb-2 max-h-32 overflow-y-auto">
            {openFiles.map((file) => (
              <div
                key={file.id}
                className={`
                  flex items-center gap-2 px-3 py-1 cursor-pointer text-sm
                  ${file.id === activeFileId ? "bg-blue-600/20 text-blue-300" : "text-gray-400 hover:bg-gray-800/30"}
                `}
              >
                {getFileIcon(file.name, false, false)}
                <span className="truncate flex-1">{file.name}</span>
                {file.isDirty && (
                  <span className="w-2 h-2 rounded-full bg-blue-400" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
