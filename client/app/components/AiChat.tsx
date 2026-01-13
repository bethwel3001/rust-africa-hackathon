import { VscSparkle, VscSend } from "react-icons/vsc";

export default function AiChat() {
  return (
    <div className="flex-1 h-full flex flex-col bg-background max-w-3xl mx-auto border-x border-border">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center gap-2">
            <VscSparkle className="text-purple-500" />
            <span className="font-semibold">AI Assistant</span>
        </div>

        {/* Chat Area */}
        <div className="flex-1 p-4 space-y-6 overflow-y-auto no-scrollbar">
            {/* AI Message */}
            <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-500 border border-purple-500/30">
                    <VscSparkle size={14} />
                </div>
                <div className="bg-surface p-4 rounded-2xl rounded-tl-none border border-border text-sm text-gray-300 leading-relaxed max-w-[80%]">
                    I noticed your API test for <code className="bg-black px-1 rounded text-primary">/api/users</code> returned a 500 error. 
                    <br/><br/>
                    It looks like a lifetime issue in your Rust handler. Should I investigate the borrow checker error?
                </div>
            </div>

            {/* User Message */}
             <div className="flex gap-4 flex-row-reverse">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary border border-primary/30">
                    You
                </div>
                <div className="bg-primary/10 p-4 rounded-2xl rounded-tr-none border border-primary/20 text-sm text-white leading-relaxed max-w-[80%]">
                    Yes, please fix the lifetime annotations.
                </div>
            </div>
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-border">
            <div className="relative">
                <input 
                    type="text" 
                    placeholder="Ask about your code..." 
                    className="w-full bg-surface border border-border rounded-xl pl-4 pr-12 py-3 text-sm focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all"
                />
                <button className="absolute right-2 top-2 p-1.5 bg-purple-500 rounded-lg text-white hover:bg-purple-600">
                    <VscSend size={16} />
                </button>
            </div>
        </div>
    </div>
  );
}