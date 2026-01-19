"use client";

import { useState, useRef, useEffect } from "react";
import {
  VscSparkle,
  VscSend,
  VscCopy,
  VscCheck,
  VscTrash,
  VscChevronDown,
} from "react-icons/vsc";
import { cn } from "../lib/utils";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

const SUGGESTIONS = [
  "How do I fix this error?",
  "Explain this code",
  "Help me debug this issue",
  "What's wrong with my API request?",
  "How do I improve this function?",
];

export default function AiChat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content:
        "👋 Hi! I'm your AI coding assistant. I can help you debug errors, explain code, and answer questions about your project.\n\nPaste an error message or ask me anything!",
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 150)}px`;
    }
  }, [input]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    // Simulate AI response (in production, this would call an AI API)
    setTimeout(() => {
      const responses = [
        "I can see what you're working on! Let me analyze this...\n\nBased on your code, here are a few suggestions:\n\n1. **Check your imports** - Make sure all dependencies are properly imported\n2. **Verify types** - The error might be related to type mismatches\n3. **Review async/await** - Ensure promises are properly handled\n\nWould you like me to explain any of these in more detail?",
        "That's a great question! Here's what I found:\n\n```rust\n// Consider using this pattern\nfn handle_error<T, E>(result: Result<T, E>) -> Option<T>\nwhere\n    E: std::fmt::Debug,\n{\n    result.ok()\n}\n```\n\nThis approach provides better error handling while keeping the code clean.",
        "I analyzed the error you shared. The issue seems to be:\n\n⚠️ **Root Cause**: The variable is being used before it's initialized.\n\n✅ **Fix**: Move the declaration before the usage, or ensure the async operation completes before accessing the value.\n\nLet me know if you need more specific guidance!",
        "Looking at your code structure, I'd recommend:\n\n1. Split the large function into smaller, testable units\n2. Add proper error handling with `Result` types\n3. Consider using a state machine pattern for complex flows\n\nWant me to show you an example implementation?",
      ];

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: responses[Math.floor(Math.random() * responses.length)],
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setIsLoading(false);
    }, 1500);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCopy = (content: string, id: string) => {
    navigator.clipboard.writeText(content);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleClearChat = () => {
    setMessages([
      {
        id: Date.now().toString(),
        role: "assistant",
        content: "Chat cleared! How can I help you?",
        timestamp: Date.now(),
      },
    ]);
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInput(suggestion);
    inputRef.current?.focus();
  };

  return (
    <div className="flex-1 h-full flex flex-col bg-[#09090b] max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800/50 bg-[#0a0a0b]">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-purple-500/20 text-purple-400">
            <VscSparkle size={20} />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">
              AI Debug Assistant
            </h1>
            <p className="text-xs text-gray-500">
              Powered by AI • Always ready to help
            </p>
          </div>
        </div>

        <button
          onClick={handleClearChat}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          title="Clear chat"
        >
          <VscTrash size={14} />
          Clear
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "flex gap-4",
              message.role === "user" ? "flex-row-reverse" : "",
            )}
          >
            {/* Avatar */}
            <div
              className={cn(
                "w-9 h-9 rounded-full flex items-center justify-center shrink-0",
                message.role === "assistant"
                  ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                  : "bg-blue-500/20 text-blue-400 border border-blue-500/30",
              )}
            >
              {message.role === "assistant" ? (
                <VscSparkle size={16} />
              ) : (
                <span className="text-sm font-bold">Y</span>
              )}
            </div>

            {/* Message Content */}
            <div
              className={cn(
                "group relative max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                message.role === "assistant"
                  ? "bg-[#111113] text-gray-200 rounded-tl-none border border-gray-800/50"
                  : "bg-blue-600/20 text-blue-100 rounded-tr-none border border-blue-500/20",
              )}
            >
              {/* Render message with code blocks */}
              <div className="whitespace-pre-wrap break-words">
                {message.content.split("```").map((part, index) => {
                  if (index % 2 === 1) {
                    // Code block
                    const [lang, ...codeLines] = part.split("\n");
                    const code = codeLines.join("\n").trim();
                    return (
                      <div
                        key={index}
                        className="my-3 rounded-lg overflow-hidden bg-[#0a0a0b] border border-gray-800"
                      >
                        <div className="flex items-center justify-between px-3 py-1.5 bg-gray-900/50 border-b border-gray-800">
                          <span className="text-[10px] text-gray-500 uppercase">
                            {lang || "code"}
                          </span>
                          <button
                            onClick={() =>
                              handleCopy(code, `${message.id}-${index}`)
                            }
                            className="p-1 rounded text-gray-500 hover:text-white hover:bg-gray-700 transition-colors"
                          >
                            {copied === `${message.id}-${index}` ? (
                              <VscCheck size={12} className="text-green-400" />
                            ) : (
                              <VscCopy size={12} />
                            )}
                          </button>
                        </div>
                        <pre className="p-3 text-xs font-mono text-gray-300 overflow-x-auto">
                          {code}
                        </pre>
                      </div>
                    );
                  }
                  return <span key={index}>{part}</span>;
                })}
              </div>

              {/* Copy button for full message */}
              <button
                onClick={() => handleCopy(message.content, message.id)}
                className="absolute top-2 right-2 p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity bg-gray-800/80 text-gray-400 hover:text-white"
              >
                {copied === message.id ? (
                  <VscCheck size={12} className="text-green-400" />
                ) : (
                  <VscCopy size={12} />
                )}
              </button>

              {/* Timestamp */}
              <div
                className={cn(
                  "text-[10px] mt-2 opacity-50",
                  message.role === "user" ? "text-right" : "",
                )}
              >
                {new Date(message.timestamp).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex gap-4">
            <div className="w-9 h-9 rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/30 flex items-center justify-center shrink-0">
              <VscSparkle size={16} className="animate-pulse" />
            </div>
            <div className="bg-[#111113] rounded-2xl rounded-tl-none px-4 py-3 border border-gray-800/50">
              <div className="flex items-center gap-2">
                <div
                  className="w-2 h-2 bg-purple-400 rounded-full animate-bounce"
                  style={{ animationDelay: "0ms" }}
                />
                <div
                  className="w-2 h-2 bg-purple-400 rounded-full animate-bounce"
                  style={{ animationDelay: "150ms" }}
                />
                <div
                  className="w-2 h-2 bg-purple-400 rounded-full animate-bounce"
                  style={{ animationDelay: "300ms" }}
                />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggestions */}
      {messages.length <= 2 && (
        <div className="px-6 pb-2">
          <p className="text-xs text-gray-600 mb-2">Quick suggestions:</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => handleSuggestionClick(suggestion)}
                className="px-3 py-1.5 text-xs bg-gray-800/50 hover:bg-gray-800 text-gray-400 hover:text-white rounded-full transition-colors border border-gray-700/50"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="p-4 border-t border-gray-800/50 bg-[#0a0a0b]">
        <div className="relative flex items-end gap-2 bg-[#111113] rounded-xl border border-gray-800/50 focus-within:border-purple-500/50 focus-within:ring-1 focus-within:ring-purple-500/20 transition-all">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe your issue or paste an error..."
            rows={1}
            className="flex-1 bg-transparent px-4 py-3 text-sm text-gray-200 placeholder-gray-600 resize-none focus:outline-none max-h-[150px]"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className={cn(
              "p-2.5 m-1.5 rounded-lg transition-all",
              input.trim() && !isLoading
                ? "bg-purple-600 hover:bg-purple-500 text-white"
                : "bg-gray-800 text-gray-600 cursor-not-allowed",
            )}
          >
            <VscSend size={16} />
          </button>
        </div>
        <p className="text-[10px] text-gray-600 mt-2 text-center">
          Press Enter to send • Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
