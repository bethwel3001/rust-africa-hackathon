export default function CodeEditor() {
  return (
    <div className="flex-1 h-full bg-background flex flex-col">
      {/* Tab Header */}
      <div className="flex bg-surface border-b border-border">
        <div className="px-4 py-2 bg-background border-t-2 border-primary text-sm flex items-center border-r border-border">
          <span className="text-white">main.rs</span>
          <span className="ml-2 w-2 h-2 rounded-full bg-white opacity-0 hover:opacity-100 cursor-pointer"></span>
        </div>
      </div>

      {/* Editor Area */}
      <div className="flex-1 p-8 font-mono text-sm relative overflow-hidden">
        {/* Line Numbers */}
        <div className="absolute left-0 top-8 w-12 text-right text-gray-600 select-none">
          1<br />2<br />3<br />4<br />5<br />6
        </div>

        {/* Code Content */}
        <div className="pl-16 text-gray-300 leading-6">
          <span className="text-pink-500">fn</span>{" "}
          <span className="text-blue-400">main</span>() {"{"} <br />
          &nbsp;&nbsp;
          <span className="text-gray-500">
            // Initialize the collaborative engine
          </span>
          <br />
          &nbsp;&nbsp;<span className="text-pink-500">let</span>{" "}
          <span className="text-orange-400">app</span> ={" "}
          <span className="text-blue-400">Router::new</span>();
          <br />
          &nbsp;&nbsp;<span className="text-blue-400">println!</span>(
          <span className="text-green-400">"Server running on port 8080"</span>
          );
          <br />
          {"}"}
        </div>

        {/* Mock Collaborative Cursor (Team Member) */}
        <div className="absolute top-[80px] left-[260px] flex flex-col items-start z-10 animate-pulse">
          <div className="h-5 w-[2px] bg-purple-500"></div>
          <div className="px-2 py-0.5 bg-purple-500 text-[10px] text-white rounded-br-md rounded-bl-md">
            Sarah
          </div>
        </div>

        {/* Mock User Cursor */}
        <div className="absolute top-[104px] left-[150px] flex flex-col items-start z-10">
          <div className="h-5 w-[2px] bg-primary"></div>
          <div className="px-2 py-0.5 bg-primary text-[10px] text-white rounded-br-md rounded-bl-md">
            You
          </div>
        </div>
      </div>
    </div>
  );
}
