"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, Search, Database, PenTool, CheckCircle, Loader2, Play, User, ArrowLeft, Terminal, Paperclip, X, Image as ImageIcon, FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type Step = {
  id: string;
  agent: "retriever" | "analyzer" | "writer";
  instruction: string;
  depends_on: string[];
};

type StepResult = {
  step_id: string;
  agent: string;
  status: "pending" | "running" | "success" | "failed" | "skipped";
  output: string;
  error?: string;
  duration_ms: number;
};

type Attachment = {
  type: "image" | "text";
  name: string;
  content: string; // base64 for images, raw text for text files
};

function ChatInterface() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTask = searchParams.get("q") || "";

  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isClarifying, setIsClarifying] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Resizable split pane state
  const [splitWidth, setSplitWidth] = useState(33); // Left panel width in %
  const isDragging = useRef(false);
  
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const newWidth = (e.clientX / window.innerWidth) * 100;
      setSplitWidth(Math.max(25, Math.min(75, newWidth)));
    };
    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = "default";
      }
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  // Pipeline state
  const [isExecuting, setIsExecuting] = useState(false);
  const [status, setStatus] = useState<string>("idle");
  const [steps, setSteps] = useState<Step[]>([]);
  const [results, setResults] = useState<Record<string, StepResult>>({});
  const [finalOutput, setFinalOutput] = useState("");
  const finalOutputRef = useRef("");
  const [logs, setLogs] = useState<string[]>([]);
  
  const endOfMessagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, finalOutput, attachments]);

  // Initial trigger
  useEffect(() => {
    if (initialTask && history.length === 0) {
      handleClarify([{ role: "user", content: initialTask }]);
    }
  }, [initialTask]);

  const addLog = (msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toISOString().split("T")[1].slice(0, 8)}] ${msg}`]);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    for (const file of files) {
      const isImage = file.type.startsWith("image/");
      const reader = new FileReader();

      reader.onload = (event) => {
        const result = event.target?.result as string;
        setAttachments((prev) => [...prev, {
          type: isImage ? "image" : "text",
          name: file.name,
          content: result
        }]);
      };

      if (isImage) {
        reader.readAsDataURL(file); // base64
      } else {
        reader.readAsText(file);
      }
    }
    
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleClarify = async (chatHistory: ChatMessage[]) => {
    setIsClarifying(true);
    setHistory(chatHistory);

    try {
      const res = await fetch("http://localhost:8000/api/clarify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_history: chatHistory, attachments: attachments })
      });
      
      const data = await res.json();
      
      if (data.action === "question") {
        setHistory((prev) => [...prev, { role: "assistant", content: data.question }]);
        setIsClarifying(false);
      } else {
        // Execute pipeline
        setIsClarifying(false);
        setIsExecuting(true);
        runPipeline(data.task);
      }
    } catch (e) {
      console.error(e);
      setIsClarifying(false);
      setHistory((prev) => [...prev, { role: "assistant", content: "Error connecting to orchestrator. Please try again." }]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && attachments.length === 0) || isClarifying || isExecuting) return;
    
    // If there are attachments but no text, use a default text
    const msgContent = input.trim() || "Analyze attached files.";
    
    // Attachments will be passed in the API call, so we don't necessarily put raw base64 in the chat view.
    const newHistory: ChatMessage[] = [...history, { role: "user", content: msgContent }];
    setInput("");
    handleClarify(newHistory);
  };

  const runPipeline = async (finalTask: string) => {
    setStatus("decomposing");
    setSteps([]);
    setResults({});
    setLogs([]);
    setFinalOutput("");
    finalOutputRef.current = "";
    
    addLog(`System initialized. Final task: "${finalTask}"`);

    try {
      const res = await fetch("http://localhost:8000/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: finalTask, attachments: attachments, mock: false })
      });

      if (!res.ok) throw new Error("API responded with an error");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split(/\r?\n\r?\n/);
          buffer = blocks.pop() || ""; // Keep the incomplete block in the buffer

          for (const block of blocks) {
            const lines = block.split(/\r?\n/);
            let event = "message";
            let dataStr = "";
            for (const line of lines) {
              if (line.startsWith("event: ")) event = line.slice(7);
              if (line.startsWith("data: ")) dataStr = line.slice(6);
            }

            if (!dataStr) continue;
            
            try {
              const data = JSON.parse(dataStr);

              if (event === "status") {
                setStatus(data.status);
                addLog(`Status change: ${data.message}`);
                if (data.status === "finished") {
                  setIsExecuting(false);
                  setHistory((prev) => [...prev, { role: "assistant", content: finalOutputRef.current }]);
                  setAttachments([]); // clear attachments on finish
                }
              } else if (event === "decomposition") {
                setSteps(data);
                addLog(`Task decomposed into ${data.length} steps.`);
                const initResults: Record<string, StepResult> = {};
                data.forEach((s: Step) => {
                  initResults[s.id] = { step_id: s.id, agent: s.agent, status: "pending", output: "", duration_ms: 0 };
                });
                setResults(initResults);
              } else if (event === "token") {
                setFinalOutput((prev) => {
                    const updated = prev + data.token;
                    finalOutputRef.current = updated;
                    return updated;
                });
              } else if (event === "step_result") {
                setResults((prev) => {
                  return { ...prev, [data.step_id]: data };
                });
                if (data.agent === "writer" && data.output) {
                    setFinalOutput(data.output);
                    finalOutputRef.current = data.output;
                }
                if (data.status === "success") {
                   addLog(`[${data.agent}] Step ${data.step_id} completed in ${data.duration_ms}ms`);
                } else if (data.status === "failed") {
                   addLog(`[${data.agent}] Step ${data.step_id} FAILED: ${data.error}`);
                }
              } else if (event === "error") {
                addLog(`ERROR: ${data.error}`);
                setIsExecuting(false);
                setStatus("error");
              }
            } catch (err) {
              console.error("Failed to parse SSE event", err);
            }
          }
        }
      }

    } catch (err) {
      addLog(`Failed to connect to orchestrator API.`);
      setIsExecuting(false);
      setStatus("error");
    }
  };

  const getAgentIcon = (agentName: string, active: boolean) => {
    const props = { className: `w-5 h-5 ${active ? 'animate-pulse text-white' : 'text-slate-500'}` };
    switch (agentName) {
      case "retriever": return <Search {...props} />;
      case "analyzer": return <Database {...props} />;
      case "writer": return <PenTool {...props} />;
      default: return <Brain {...props} />;
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-slate-300 font-sans selection:bg-emerald-500/30 relative flex flex-col overflow-hidden">
      {/* Background Ambient Glows */}
      <div className="absolute top-0 left-[-10%] w-[40%] h-[40%] rounded-full bg-emerald-900/10 blur-[120px] pointer-events-none"></div>
      
      {/* HEADER */}
      <header className="flex-shrink-0 flex items-center gap-4 p-6 border-b border-slate-800/50 bg-[#0a0a0a]/80 backdrop-blur-md z-10">
        <button onClick={() => router.push("/")} className="p-2 hover:bg-slate-800 rounded-full transition-colors">
          <ArrowLeft className="w-5 h-5 text-slate-400" />
        </button>
        <div className="bg-gradient-to-br from-emerald-500/20 to-blue-500/20 p-2 rounded-xl border border-emerald-500/30">
          <Brain className="w-6 h-6 text-emerald-400" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white tracking-tight">Zyro</h1>
          <p className="text-xs text-emerald-500/70 font-mono mt-0.5 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            {isExecuting ? `Pipeline ${status}...` : isClarifying ? "Clarifying intent..." : "Ready"}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={() => router.push("/history")}
            className="text-sm font-medium text-slate-400 hover:text-white transition-colors"
          >
            History
          </button>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <div className="flex-1 overflow-hidden flex flex-row relative z-10">
        
        {/* LEFT COLUMN: CHAT */}
        <div 
          className="flex flex-col h-full transition-all"
          style={{ width: isExecuting ? `${splitWidth}%` : '100%', maxWidth: isExecuting ? 'none' : '56rem', margin: isExecuting ? '0' : '0 auto' }}
        >
          <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
            {history.map((msg, idx) => (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                key={idx} 
                className={`flex gap-4 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {msg.role === "assistant" && (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500/20 to-blue-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0 mt-1">
                    <Brain className="w-4 h-4 text-emerald-400" />
                  </div>
                )}
                
                <div className={`max-w-[85%] rounded-2xl p-4 shadow-lg ${
                  msg.role === "user" 
                    ? "bg-slate-800/80 text-white border border-slate-700/50 rounded-tr-sm" 
                    : "bg-[#0f1115] text-slate-300 border border-emerald-900/30 rounded-tl-sm prose prose-invert prose-emerald max-w-none"
                }`}>
                  {msg.role === "assistant" ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  ) : (
                    <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                  )}
                </div>

                {msg.role === "user" && (
                  <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 mt-1">
                    <User className="w-4 h-4 text-slate-400" />
                  </div>
                )}
              </motion.div>
            ))}

            {isClarifying && (
              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500/20 to-blue-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0">
                  <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
                </div>
                <div className="bg-[#0f1115] text-slate-400 border border-emerald-900/30 rounded-2xl rounded-tl-sm p-4 font-mono text-sm">
                  Evaluating task constraints...
                </div>
              </div>
            )}
            
            {isExecuting && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex gap-4 justify-start"
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500/20 to-blue-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0 mt-1">
                  <Brain className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="max-w-[85%] rounded-2xl p-4 shadow-lg bg-[#0f1115] text-slate-300 border border-emerald-900/30 rounded-tl-sm prose prose-invert prose-emerald max-w-none">
                  {finalOutput ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{finalOutput}</ReactMarkdown>
                  ) : (
                    <div className="flex items-center gap-3 text-slate-500 font-mono text-sm animate-pulse">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {status === "decomposing" ? "Decomposing task into steps..." : "Agents are working..."}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
            
            <div ref={endOfMessagesRef} />
          </div>

          {/* INPUT BAR */}
          <div className="p-4 bg-[#0a0a0a]/90 backdrop-blur-xl border-t border-slate-800/50 flex flex-col gap-2">
            
            {/* Attachments Preview */}
            {attachments.length > 0 && (
              <div className="flex gap-2 px-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-slate-700">
                {attachments.map((att, i) => (
                  <div key={i} className="relative flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700/50 group">
                    {att.type === "image" ? <ImageIcon className="w-4 h-4 text-emerald-400" /> : <FileText className="w-4 h-4 text-blue-400" />}
                    <span className="text-xs text-slate-300 max-w-[100px] truncate">{att.name}</span>
                    <button 
                      type="button"
                      onClick={() => removeAttachment(i)}
                      className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={handleSubmit} className={`relative group w-full ${isExecuting ? '' : 'max-w-4xl mx-auto'}`}>
              <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500/20 via-blue-500/20 to-purple-500/20 rounded-2xl blur-lg opacity-40 transition duration-1000"></div>
              <div className="relative bg-[#15181e] border border-slate-700/50 p-2 rounded-2xl flex shadow-2xl items-end focus-within:border-emerald-500/50 transition-all">
                
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isClarifying || isExecuting}
                  className="p-3 text-slate-400 hover:text-emerald-400 transition-colors disabled:opacity-50"
                >
                  <Paperclip className="w-5 h-5" />
                </button>
                <input 
                  type="file" 
                  multiple 
                  ref={fileInputRef} 
                  className="hidden" 
                  onChange={handleFileUpload}
                  accept="image/*,.txt,.md,.csv,.json"
                />

                <textarea
                  className="w-full bg-transparent border-none text-base p-3 text-white placeholder-slate-500 focus:ring-0 focus:outline-none resize-none min-h-[50px] max-h-[200px] scrollbar-thin scrollbar-thumb-slate-800"
                  placeholder={isExecuting ? "Pipeline is running..." : "Reply to orchestrator or drop files..."}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                  }}
                  disabled={isClarifying || isExecuting}
                  rows={1}
                />
                <button
                  type="submit"
                  disabled={(!input.trim() && attachments.length === 0) || isClarifying || isExecuting}
                  className="bg-gradient-to-r from-emerald-500 to-emerald-400 hover:from-emerald-400 hover:to-emerald-300 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-500 text-slate-950 p-3 rounded-xl transition-all shadow-[0_0_15px_rgba(16,185,129,0.2)] disabled:shadow-none mb-1 mr-1"
                >
                  <Play className="w-5 h-5" />
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* RESIZER HANDLE */}
        {isExecuting && (
          <div 
            className="w-1 cursor-col-resize hover:bg-emerald-500/50 active:bg-emerald-500 z-50 transition-colors flex items-center justify-center"
            onMouseDown={() => {
              isDragging.current = true;
              document.body.style.cursor = "col-resize";
            }}
          >
            <div className="h-10 w-[2px] bg-slate-700/50 rounded-full"></div>
          </div>
        )}

        {/* RIGHT COLUMN: PIPELINE DASHBOARD */}
        {isExecuting && (
          <motion.div 
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex flex-col bg-[#0a0a0a] border-l border-slate-800/50 h-full overflow-hidden"
            style={{ width: `calc(${100 - splitWidth}% - 4px)` }}
          >
            <div className="flex-1 overflow-y-auto p-8 space-y-8 scrollbar-thin scrollbar-thumb-slate-800">
              
              {/* DECOMPOSITION GRAPH */}
              <section>
                <h2 className="text-xs font-mono text-slate-500 mb-4 uppercase tracking-[0.2em]">Execution Graph</h2>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {steps.map((step) => {
                    const res = results[step.id];
                    return (
                      <div key={step.id} className={`p-4 rounded-xl border flex flex-col gap-3 transition-colors ${
                          res?.status === 'success' ? 'border-emerald-500/30 bg-emerald-950/20' :
                          res?.status === 'running' ? 'border-emerald-500 bg-emerald-950/40 shadow-[0_0_20px_rgba(16,185,129,0.15)]' :
                          res?.status === 'failed' ? 'border-red-500/30 bg-red-950/20' :
                          'border-slate-800 bg-[#15181e]'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="pt-1">{getAgentIcon(step.agent, res?.status === 'running')}</div>
                          <div className="flex-1">
                            <span className="font-mono text-xs font-bold text-slate-400">[{step.id}] {step.agent}</span>
                            <p className="text-sm text-slate-300 mt-1 leading-snug">{step.instruction}</p>
                          </div>
                        </div>
                        {res?.output && step.agent !== 'writer' && (
                          <div className="mt-2 p-3 bg-black/40 rounded-lg text-xs text-slate-400 overflow-y-auto max-h-40 scrollbar-thin scrollbar-thumb-slate-700 border border-slate-800/50 prose prose-invert prose-emerald prose-sm max-w-none">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{res.output}</ReactMarkdown>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>

              {/* STREAMING OUTPUT */}
              <section className="bg-[#0f1115] border border-slate-800 rounded-3xl p-8 shadow-2xl relative min-h-[400px]">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 via-blue-500 to-purple-500 opacity-50"></div>
                <h2 className="text-xs font-mono text-slate-500 mb-6 uppercase tracking-[0.2em] flex items-center gap-2">
                  <PenTool className="w-4 h-4" /> Synthesized Output
                </h2>
                
                <div className="prose prose-invert prose-emerald prose-p:leading-relaxed max-w-none">
                  {finalOutput ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{finalOutput}</ReactMarkdown>
                  ) : (
                    <div className="text-slate-600 font-mono text-sm animate-pulse">
                      Awaiting writer agent synthesis...
                    </div>
                  )}
                </div>
              </section>

              {/* TERMINAL LOGS */}
              <section className="bg-[#050505] border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
                <div className="bg-[#0a0a0a] px-4 py-2 border-b border-slate-800 flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-slate-500" />
                  <span className="text-xs font-mono text-slate-500">system.log</span>
                </div>
                <div className="p-4 h-[200px] overflow-y-auto font-mono text-xs leading-relaxed space-y-1 scrollbar-thin scrollbar-thumb-slate-800">
                  {logs.map((log, i) => (
                    <div key={i} className={
                      log.includes("ERROR") ? "text-red-400" :
                      log.includes("SUCCESS") ? "text-emerald-400" :
                      "text-slate-400"
                    }>
                      <span className="opacity-50">❯</span> {log}
                    </div>
                  ))}
                </div>
              </section>

            </div>
          </motion.div>
        )}

      </div>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#050505] flex items-center justify-center"><Loader2 className="w-8 h-8 text-emerald-500 animate-spin" /></div>}>
      <ChatInterface />
    </Suspense>
  );
}
