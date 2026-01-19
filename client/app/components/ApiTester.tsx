"use client";

import { useState, useCallback } from "react";
import {
  VscSend,
  VscAdd,
  VscTrash,
  VscChevronDown,
  VscChevronRight,
  VscHistory,
  VscSave,
  VscCopy,
  VscCheck,
  VscClose,
} from "react-icons/vsc";
import { useApiTesterStore } from "../store";
import { api, HttpHeader } from "../lib/tauri";
import { formatBytes, formatTime, cn } from "../lib/utils";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const METHOD_COLORS: Record<string, string> = {
  GET: "text-green-400 bg-green-400/10",
  POST: "text-blue-400 bg-blue-400/10",
  PUT: "text-yellow-400 bg-yellow-400/10",
  PATCH: "text-orange-400 bg-orange-400/10",
  DELETE: "text-red-400 bg-red-400/10",
};

function getStatusColor(status: number): string {
  if (status >= 200 && status < 300) return "text-green-400";
  if (status >= 300 && status < 400) return "text-yellow-400";
  if (status >= 400 && status < 500) return "text-orange-400";
  if (status >= 500) return "text-red-400";
  return "text-gray-400";
}

function formatJson(str: string): string {
  try {
    const parsed = JSON.parse(str);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return str;
  }
}

export default function ApiTester() {
  const {
    method,
    url,
    headers,
    body,
    response,
    isLoading,
    error,
    history,
    setMethod,
    setUrl,
    setHeaders,
    addHeader,
    updateHeader,
    removeHeader,
    setBody,
    setResponse,
    setLoading,
    setError,
    addToHistory,
    clearHistory,
  } = useApiTesterStore();

  const [activeTab, setActiveTab] = useState<"body" | "headers">("body");
  const [responseTab, setResponseTab] = useState<"body" | "headers">("body");
  const [showHistory, setShowHistory] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleSendRequest = useCallback(async () => {
    if (!url.trim()) {
      setError("Please enter a URL");
      return;
    }

    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      // Filter enabled headers with valid keys and map to proper format
      const filteredHeaders = headers
        .filter((h) => h.enabled && h.key.trim())
        .map((h) => ({ key: h.key.trim(), value: h.value, enabled: true }));

      // Only include body for methods that support it
      const requestBody =
        ["POST", "PUT", "PATCH"].includes(method) && body?.trim()
          ? body.trim()
          : undefined;

      const requestPayload = {
        method,
        url: url.trim(),
        headers: filteredHeaders,
        body: requestBody,
        timeout_ms: 30000,
      };

      console.log("[API Tester] Sending request:", {
        method,
        url: url.trim(),
        headers: filteredHeaders,
        bodyLength: requestBody?.length || 0,
      });

      const result = await api.sendHttpRequest(requestPayload);
      setResponse(result);

      // Add to history
      addToHistory({
        id: Date.now().toString(),
        request: {
          id: Date.now().toString(),
          name: url,
          method,
          url,
          headers,
          body,
        },
        response: result,
        timestamp: Date.now(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [
    method,
    url,
    headers,
    body,
    setLoading,
    setError,
    setResponse,
    addToHistory,
  ]);

  const handleCopyResponse = useCallback(() => {
    if (response?.body) {
      navigator.clipboard.writeText(response.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [response]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleSendRequest();
    }
  };

  return (
    <div className="flex-1 h-full flex flex-col bg-[#09090b] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800/50 bg-[#0a0a0b]">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-white">CodeCollab API</h1>
          <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded">
            Thunder Client Alternative
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-all",
              showHistory
                ? "bg-blue-600 text-white"
                : "bg-gray-800 text-gray-400 hover:text-white",
            )}
          >
            <VscHistory size={14} />
            History
            {history.length > 0 && (
              <span className="text-xs bg-gray-700 px-1.5 rounded">
                {history.length}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* URL Bar */}
          <div className="flex gap-2 p-4 bg-[#0c0c0d] border-b border-gray-800/50">
            {/* Method Selector */}
            <div className="relative">
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className={cn(
                  "appearance-none px-4 py-3 pr-8 rounded-lg font-mono text-sm font-bold border border-gray-700 bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer",
                  METHOD_COLORS[method],
                )}
              >
                {HTTP_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <VscChevronDown
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none"
                size={14}
              />
            </div>

            {/* URL Input */}
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter request URL..."
              className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-sm font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent"
            />

            {/* Send Button */}
            <button
              onClick={handleSendRequest}
              disabled={isLoading}
              className={cn(
                "flex items-center gap-2 px-6 py-3 rounded-lg font-semibold text-sm transition-all",
                isLoading
                  ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                  : "bg-blue-600 hover:bg-blue-500 text-white active:scale-95",
              )}
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-gray-500 border-t-white rounded-full animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <VscSend size={16} />
                  Send
                </>
              )}
            </button>
          </div>

          {/* Request/Response Split */}
          <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
            {/* Request Panel */}
            <div className="flex-1 flex flex-col border-r border-gray-800/50 overflow-hidden">
              {/* Tabs */}
              <div className="flex border-b border-gray-800/50 bg-[#0a0a0b]">
                <button
                  onClick={() => setActiveTab("body")}
                  className={cn(
                    "px-4 py-2.5 text-sm font-medium transition-all border-b-2",
                    activeTab === "body"
                      ? "text-blue-400 border-blue-500 bg-blue-500/5"
                      : "text-gray-500 border-transparent hover:text-gray-300",
                  )}
                >
                  Body
                </button>
                <button
                  onClick={() => setActiveTab("headers")}
                  className={cn(
                    "px-4 py-2.5 text-sm font-medium transition-all border-b-2 flex items-center gap-2",
                    activeTab === "headers"
                      ? "text-blue-400 border-blue-500 bg-blue-500/5"
                      : "text-gray-500 border-transparent hover:text-gray-300",
                  )}
                >
                  Headers
                  {headers.filter((h) => h.enabled).length > 0 && (
                    <span className="text-xs bg-gray-700 px-1.5 rounded">
                      {headers.filter((h) => h.enabled).length}
                    </span>
                  )}
                </button>
              </div>

              {/* Tab Content */}
              <div className="flex-1 overflow-hidden">
                {activeTab === "body" && (
                  <div className="h-full p-4">
                    <textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      placeholder='{\n  "key": "value"\n}'
                      spellCheck={false}
                      className="w-full h-full bg-[#050505] border border-gray-800 rounded-lg p-4 font-mono text-sm text-gray-300 placeholder-gray-700 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/50"
                    />
                  </div>
                )}

                {activeTab === "headers" && (
                  <div className="p-4 space-y-2 overflow-y-auto h-full">
                    {headers.map((header, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={header.enabled}
                          onChange={(e) =>
                            updateHeader(index, {
                              ...header,
                              enabled: e.target.checked,
                            })
                          }
                          className="w-4 h-4 rounded bg-gray-800 border-gray-700 text-blue-500 focus:ring-blue-500/30"
                        />
                        <input
                          type="text"
                          value={header.key}
                          onChange={(e) =>
                            updateHeader(index, {
                              ...header,
                              key: e.target.value,
                            })
                          }
                          placeholder="Header name"
                          className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                        />
                        <input
                          type="text"
                          value={header.value}
                          onChange={(e) =>
                            updateHeader(index, {
                              ...header,
                              value: e.target.value,
                            })
                          }
                          placeholder="Value"
                          className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                        />
                        <button
                          onClick={() => removeHeader(index)}
                          className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                        >
                          <VscTrash size={14} />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={addHeader}
                      className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-colors"
                    >
                      <VscAdd size={14} />
                      Add Header
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Response Panel */}
            <div className="flex-1 flex flex-col overflow-hidden bg-[#050505]">
              {/* Response Header */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800/50 bg-[#0a0a0b]">
                <div className="flex items-center gap-4">
                  <span className="text-xs font-semibold text-gray-500 uppercase">
                    Response
                  </span>
                  {response && (
                    <>
                      <span
                        className={cn(
                          "font-mono text-sm font-bold",
                          getStatusColor(response.status),
                        )}
                      >
                        {response.status} {response.status_text}
                      </span>
                      <span className="text-xs text-gray-500">
                        {formatTime(response.time_ms)}
                      </span>
                      <span className="text-xs text-gray-500">
                        {formatBytes(response.size_bytes)}
                      </span>
                    </>
                  )}
                </div>

                {response && (
                  <button
                    onClick={handleCopyResponse}
                    className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
                  >
                    {copied ? (
                      <>
                        <VscCheck size={12} className="text-green-400" />
                        Copied
                      </>
                    ) : (
                      <>
                        <VscCopy size={12} />
                        Copy
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Response Tabs */}
              {response && (
                <div className="flex border-b border-gray-800/50 bg-[#0a0a0b]">
                  <button
                    onClick={() => setResponseTab("body")}
                    className={cn(
                      "px-4 py-2 text-sm font-medium transition-all border-b-2",
                      responseTab === "body"
                        ? "text-blue-400 border-blue-500"
                        : "text-gray-500 border-transparent hover:text-gray-300",
                    )}
                  >
                    Body
                  </button>
                  <button
                    onClick={() => setResponseTab("headers")}
                    className={cn(
                      "px-4 py-2 text-sm font-medium transition-all border-b-2",
                      responseTab === "headers"
                        ? "text-blue-400 border-blue-500"
                        : "text-gray-500 border-transparent hover:text-gray-300",
                    )}
                  >
                    Headers ({Object.keys(response.headers).length})
                  </button>
                </div>
              )}

              {/* Response Content */}
              <div className="flex-1 overflow-auto p-4">
                {error && (
                  <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400">
                    <VscClose size={18} />
                    <span className="text-sm">{error}</span>
                  </div>
                )}

                {isLoading && (
                  <div className="flex flex-col items-center justify-center h-full gap-4">
                    <div className="w-10 h-10 border-3 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                    <span className="text-gray-500 text-sm">
                      Sending request...
                    </span>
                  </div>
                )}

                {!response && !isLoading && !error && (
                  <div className="flex flex-col items-center justify-center h-full text-gray-600">
                    <VscSend size={48} className="mb-4 opacity-20" />
                    <p className="text-sm">
                      Send a request to see the response
                    </p>
                    <p className="text-xs mt-1 text-gray-700">
                      Press Ctrl+Enter to send quickly
                    </p>
                  </div>
                )}

                {response && responseTab === "body" && (
                  <pre className="font-mono text-sm text-gray-300 whitespace-pre-wrap break-words leading-relaxed">
                    {formatJson(response.body)}
                  </pre>
                )}

                {response && responseTab === "headers" && (
                  <div className="space-y-2">
                    {Object.entries(response.headers).map(([key, value]) => (
                      <div
                        key={key}
                        className="flex items-start gap-2 py-1.5 border-b border-gray-800/30"
                      >
                        <span className="text-blue-400 font-mono text-sm font-medium min-w-[180px]">
                          {key}:
                        </span>
                        <span className="text-gray-300 font-mono text-sm break-all">
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* History Sidebar */}
        {showHistory && (
          <div className="w-80 border-l border-gray-800/50 bg-[#0a0a0b] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800/50">
              <span className="text-sm font-semibold text-gray-300">
                Request History
              </span>
              {history.length > 0 && (
                <button
                  onClick={clearHistory}
                  className="text-xs text-gray-500 hover:text-red-400 transition-colors"
                >
                  Clear All
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {history.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-600 p-4">
                  <VscHistory size={32} className="mb-2 opacity-30" />
                  <p className="text-sm">No requests yet</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-800/50">
                  {history.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        setMethod(item.request.method);
                        setUrl(item.request.url);
                        setHeaders(item.request.headers);
                        setBody(item.request.body);
                      }}
                      className="w-full px-4 py-3 text-left hover:bg-gray-800/30 transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={cn(
                            "text-xs font-bold px-1.5 py-0.5 rounded",
                            METHOD_COLORS[item.request.method],
                          )}
                        >
                          {item.request.method}
                        </span>
                        {item.response && (
                          <span
                            className={cn(
                              "text-xs",
                              getStatusColor(item.response.status),
                            )}
                          >
                            {item.response.status}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 truncate">
                        {item.request.url}
                      </p>
                      <p className="text-[10px] text-gray-600 mt-1">
                        {new Date(item.timestamp).toLocaleTimeString()}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
