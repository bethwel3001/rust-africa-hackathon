"use client";
import { useState, useRef, useEffect } from "react";
import { VscSparkle, VscSend, VscChromeClose } from "react-icons/vsc";

export default function AiChatPopup() {
  const [isOpen, setIsOpen] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  return (
    <div className="fixed bottom-24 right-8 z-50 flex flex-col items-end gap-4 font-sans">
      
      {isOpen && (
        <div className="w-[380px] h-[450px] bg-[#101012] border border-gray-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 fade-in duration-300">
          
          <div className="h-10 bg-purple-900/10 border-b border-purple-500/20 flex items-center justify-between px-4 backdrop-blur-md">
            <div className="flex items-center gap-2 text-purple-400 font-bold text-[12px] tracking-wide">
              <VscSparkle className="animate-pulse" /> MOXI AI 
            </div>
            <button 
              onClick={() => setIsOpen(false)} 
              className="text-gray-400 hover:text-white p-1 rounded-md transition-colors"
            >
              <VscChromeClose size={14} />
            </button>
          </div>

          <div className="flex-1 p-4 overflow-y-auto space-y-4 custom-scrollbar bg-[#09090b]">
             <div className="flex gap-3 animate-in fade-in slide-in-from-left-2 duration-300">
                <div className="w-6 h-6 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-500 border border-purple-500/20 flex-shrink-0 mt-1">
                    <VscSparkle size={12} />
                </div>
                <div className="bg-[#18181b] p-3 rounded-2xl rounded-tl-none border border-gray-800 text-[13px] text-gray-300 leading-relaxed shadow-sm">
                    Iam ready to help debug your Rust code and Test your APIs. Ask me anything!
                </div>
            </div>
          </div>

          <div className="p-3 bg-[#101012] border-t border-gray-800">
            <div className="relative group">
                <input 
                    ref={inputRef}
                    type="text" 
                    placeholder="Ask AI..." 
                    className="w-full bg-black border border-gray-800 rounded-xl pl-4 pr-10 py-3 text-[13px] focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 text-white placeholder-gray-600 transition-all shadow-inner"
                />
                <button className="absolute right-2 top-2 p-1.5 bg-purple-600 rounded-lg text-white hover:bg-purple-500 transition-transform active:scale-95">
                    <VscSend size={14} />
                </button>
            </div>
          </div>
        </div>
      )}

      {!isOpen && (
        <button 
            onClick={() => setIsOpen(true)}
            className="h-12 w-12 rounded-full bg-purple-600 text-white shadow-[0_0_20px_rgba(147,51,234,0.4)] flex items-center justify-center hover:bg-purple-500 hover:scale-110 transition-all duration-300"
        >
            <VscSparkle size={24} />
        </button>
      )}
    </div>
  );
}