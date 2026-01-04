import { VscSend, VscCloudDownload, VscBracketDot } from "react-icons/vsc";

export default function ApiTester() {
  return (
    <div className="flex-1 h-full flex flex-col bg-black">
      {/* Header */}
      <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-900/50">
        <h2 className="text-sm font-semibold flex items-center gap-2 text-gray-300">
            <VscCloudDownload className="text-blue-500"/> API Testing Suite
        </h2>
        <div className="flex items-center gap-2">
        </div>
      </div>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* LEFT: Request Panel */}
        <div className="flex-1 border-r border-gray-800 p-6 flex flex-col gap-6 bg-black">
            
            {/* URL Bar */}
            <div className="flex gap-0 shadow-lg shadow-blue-900/5">
                <select className="bg-gray-900 border border-gray-700 rounded-l-md px-4 py-3 text-sm font-mono text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 appearance-none cursor-pointer hover:bg-gray-800 transition-colors">
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="PATCH">PATCH</option>
                    <option value="DELETE">DELETE</option>
                </select>
                
                <input 
                    type="text" 
                    defaultValue="http://localhost:8080/api/v1/users" 
                    className="flex-1 bg-gray-900 border-y border-r border-gray-700 px-4 py-3 text-sm font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-gray-300 placeholder-gray-600"
                    placeholder="Enter request URL..."
                />
                
                <button className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-2 rounded-r-md text-sm font-bold flex items-center gap-2 transition-all active:scale-95">
                    <VscSend /> SEND
                </button>
            </div>
            
            {/* Editable Request Body */}
            <div className="flex-1 flex flex-col gap-2">
                <label className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2">
                    <VscBracketDot /> Request Body (JSON)
                </label>
                <textarea 
                    spellCheck={false}
                    className="flex-1 w-full bg-[#050505] border border-gray-800 rounded-lg p-4 font-mono text-sm text-gray-300 resize-none focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 leading-relaxed custom-scrollbar"
                    defaultValue={`{
  "username": "rust_dev",
  "role": "admin",
  "preferences": {
    "theme": "dark",
    "notifications": true
  }
}`}
                />
            </div>
        </div>

        {/* RIGHT: Response Panel */}
        <div className="flex-1 bg-[#050505] p-6 font-mono text-sm border-t md:border-t-0 md:border-l border-gray-800 overflow-y-auto">
            <div className="flex justify-between mb-6 items-end border-b border-gray-800 pb-2">
                <span className="text-gray-500 text-xs font-bold uppercase">Response Body</span>
                <div className="flex gap-4 text-xs">
                    <span className="text-green-500 font-bold">Status: 200 OK</span>
                    <span className="text-gray-500">Time: <span className="text-white">12ms</span></span>
                    <span className="text-gray-500">Size: <span className="text-white">1.4KB</span></span>
                </div>
            </div>
            <pre className="text-blue-300 leading-relaxed">
{`{
  "status": "success",
  "data": {
    "id": 101,
    "role": "admin",
    "collaborators": [
      "Sarah",
      "Mike"
    ],
    "last_login": "2024-03-15T10:30:00Z"
  }
}`}
            </pre>
        </div>
      </div>
    </div>
  );
}