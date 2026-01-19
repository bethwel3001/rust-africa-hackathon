import { VscSend, VscCloudDownload, VscBracketDot } from "react-icons/vsc";

export default function ApiTester() {
  return (
    <div className="flex-1 h-full flex flex-col bg-black font-sans">
      {/* Header */}
      <div className="h-12 px-4 border-b border-gray-800 flex justify-between items-center bg-gray-900/20">
        <h2 className="text-[13px] font-semibold flex items-center gap-2 text-gray-300">
            <VscCloudDownload className="text-blue-500"/> API Testing Suite
        </h2>
        <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">Environment:</span>
            <div className="bg-blue-900/20 text-blue-400 px-2 py-0.5 rounded text-[11px] border border-blue-900/50 font-mono">
                Rust Backend (v1.0.4)
            </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* LEFT: Request Panel */}
        <div className="flex-1 border-r border-gray-800 p-6 flex flex-col gap-6 bg-black">
            
            <div className="flex gap-0 shadow-lg shadow-blue-900/5">
                <select className="bg-gray-900 border border-gray-700 rounded-l-md px-3 py-2 text-[13px] text-white focus:outline-none focus:border-blue-500 appearance-none cursor-pointer hover:bg-gray-800 transition-colors">
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="DELETE">DELETE</option>
                </select>
                
                <input 
                    type="text" 
                    defaultValue="http://localhost:8080/api/v1/users" 
                    className="flex-1 bg-gray-900 border-y border-r border-gray-700 px-3 py-2 text-[13px] font-mono focus:outline-none focus:border-blue-500 text-gray-300 placeholder-gray-600"
                />
                
                <button className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-r-md text-[13px] font-bold flex items-center gap-2 transition-all active:scale-95">
                    <VscSend /> SEND
                </button>
            </div>
            
            <div className="flex-1 flex flex-col gap-2">
                <label className="text-[11px] font-bold text-gray-500 uppercase flex items-center gap-2">
                    <VscBracketDot /> Request Body (JSON)
                </label>
                <textarea 
                    spellCheck={false}
                    className="flex-1 w-full bg-[#050505] border border-gray-800 rounded-lg p-4 font-mono text-[13px] text-gray-300 resize-none focus:outline-none focus:border-blue-500 leading-relaxed custom-scrollbar"
                    defaultValue={`{
  "username": "rust_dev",
  "role": "admin"
}`}
                />
            </div>
        </div>

        {/* RIGHT: Response Panel */}
        <div className="flex-1 bg-[#050505] p-6 font-mono text-[13px] border-l border-gray-800 overflow-y-auto">
            <div className="flex justify-between mb-4 items-end border-b border-gray-800 pb-2">
                <span className="text-gray-500 text-[11px] font-bold uppercase font-sans">Response</span>
                <div className="flex gap-4 text-[11px] font-sans">
                    <span className="text-green-500 font-bold">200 OK</span>
                    <span className="text-gray-500">12ms</span>
                </div>
            </div>
            <pre className="text-blue-300 leading-relaxed">
{`{
  "status": "success",
  "data": {
    "id": 101,
    "role": "admin"
  }
}`}
            </pre>
        </div>
      </div>
    </div>
  );
}