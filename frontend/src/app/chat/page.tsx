"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, Search, Database, PenTool, CheckCircle, Loader2, Play, User, ArrowLeft, Terminal } from "lucide-react";
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

function ChatInterface() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTask = searchParams.get("q") || "";

  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isClarifying, setIsClarifying] = useState(false);
  
  // Pipeline state
  const [isExecuting, setIsExecuting] = useState(false);
  const [status, setStatus] = useState<string>("idle");
  const [steps, setSteps] = useState<Step[]>([]);
  const [results, setResults] = useState<Record<string, StepResult>>({});
  const [finalOutput, setFinalOutput] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  
  const endOfMessagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, finalOutput]);

  // Initial trigger
  useEffect(() => {
    if (initialTask && history.length === 0) {
      handleClarify([{ role: "user", content: initialTask }]);
    }
  }, [initialTask]);

  const addLog = (msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toISOString().split("T")[1].slice(0, 8)}] ${msg}`]);
  };

  const handleClarify = async (chatHistory: ChatMessage[]) => {
    setIsClarifying(true);
    setHistory(chatHistory);

    try {
      const res = await fetch("http://localhost:8000/api/clarify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_history: chatHistory })
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
    if (!input.trim() || isClarifying || isExecuting) return;
    
    const newHistory: ChatMessage[] = [...history, { role: "user", content: input }];
    setInput("");
    handleClarify(newHistory);
  };

  const runPipeline = async (finalTask: string) => {
    setStatus("decomposing");
    setSteps([]);
    setResults({});
    setLogs([]);
    setFinalOutput("");
    
    addLog(`System initialized. Final task: "${finalTask}"`);

    try {
      const url = `http://localhost:8000/api/run?task=${encodeURIComponent(finalTask)}&mock=false`;
      const eventSource = new EventSource(url);

      eventSource.addEventListener("status", (e) => {
        const data = JSON.parse(e.data);
        setStatus(data.status);
        addLog(`Status change: ${data.message}`);
        
        if (data.status === "finished") {
          setIsExecuting(false);
          eventSource.close();
          // Add final output to chat history
          setHistory((prev) => [...prev, { role: "assistant", content: finalOutput }]);
        }
      });

      eventSource.addEventListener("decomposition", (e) => {
        const data = JSON.parse(e.data);
        setSteps(data);
        addLog(`Task decomposed into ${data.length} steps.`);
        
        const initResults: Record<string, StepResult> = {};
        data.forEach((s: Step) => {
          initResults[s.id] = { step_id: s.id, agent: s.agent, status: "pending", output: "", duration_ms: 0 };
        });
        setResults(initResults);
      });

      eventSource.addEventListener("step_result", (e) => {
        const data = JSON.parse(e.data) as StepResult;
        
        setResults((prev) => {
          if (data.agent === "writer") {
             if (data.output && data.output.length > 0) {
                 setFinalOutput(data.output);
             }
          }
          return { ...prev, [data.step_id]: data };
        });
        
        if (data.status === "success") {
           addLog(`[${data.agent}] Step ${data.step_id} completed in ${data.duration_ms}ms`);
        } else if (data.status === "failed") {
           addLog(`[${data.agent}] Step ${data.step_id} FAILED: ${data.error}`);
        }
      });

      eventSource.addEventListener("error", (e) => {
        const data = JSON.parse(e.data);
        addLog(`ERROR: ${data.error}`);
        setIsExecuting(false);
        setStatus("error");
        eventSource.close();
      });

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
    <div className="min-h-screen bg-[#050505] text-slate-300 font-sans selection:bg-emerald-500/30 relative flex flex-col">
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
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Agentic AI Orchestrator</h1>
          <p className="text-xs text-emerald-500/70 font-mono mt-0.5 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            {isExecuting ? `Pipeline ${status}...` : isClarifying ? "Clarifying intent..." : "Ready"}
          </p>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <div className="flex-1 overflow-hidden flex flex-col lg:flex-row relative z-10">
        
        {/* LEFT COLUMN: CHAT */}
        <div className={`flex flex-col h-full transition-all duration-700 ${isExecuting ? 'lg:w-1/3 border-r border-slate-800/50' : 'w-full max-w-4xl mx-auto'}`}>
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
            
            <div ref={endOfMessagesRef} />
          </div>

          {/* INPUT BAR */}
          <div className="p-6 bg-[#0a0a0a]/90 backdrop-blur-xl border-t border-slate-800/50">
            <form onSubmit={handleSubmit} className="relative group max-w-4xl mx-auto">
              <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500/20 via-blue-500/20 to-purple-500/20 rounded-2xl blur-lg opacity-40 transition duration-1000"></div>
              <div className="relative bg-[#15181e] border border-slate-700/50 p-2 rounded-2xl flex shadow-2xl items-end focus-within:border-emerald-500/50 transition-all">
                <textarea
                  className="w-full bg-transparent border-none text-base p-3 text-white placeholder-slate-500 focus:ring-0 focus:outline-none resize-none min-h-[50px] max-h-[200px] scrollbar-thin scrollbar-thumb-slate-800"
                  placeholder={isExecuting ? "Pipeline is running..." : "Reply to orchestrator..."}
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
                  disabled={!input.trim() || isClarifying || isExecuting}
                  className="bg-gradient-to-r from-emerald-500 to-emerald-400 hover:from-emerald-400 hover:to-emerald-300 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-500 text-slate-950 p-3 rounded-xl transition-all shadow-[0_0_15px_rgba(16,185,129,0.2)] disabled:shadow-none mb-1 mr-1"
                >
                  <Play className="w-5 h-5" />
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* RIGHT COLUMN: PIPELINE DASHBOARD (Only visible when executing) */}
        {isExecuting && (
          <motion.div 
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            className="hidden lg:flex flex-col w-2/3 bg-[#0a0a0a] border-l border-slate-800/50 h-full overflow-hidden"
          >
            <div className="flex-1 overflow-y-auto p-8 space-y-8 scrollbar-thin scrollbar-thumb-slate-800">
              
              {/* DECOMPOSITION GRAPH */}
              <section>
                <h2 className="text-xs font-mono text-slate-500 mb-4 uppercase tracking-[0.2em]">Execution Graph</h2>
                <div className="grid grid-cols-2 gap-4">
                  {steps.map((step) => {
                    const res = results[step.id];
                    return (
                      <div key={step.id} className={`p-4 rounded-xl border flex items-start gap-3 transition-colors ${
                          res?.status === 'success' ? 'border-emerald-500/30 bg-emerald-950/20' :
                          res?.status === 'running' ? 'border-emerald-500 bg-emerald-950/40 shadow-[0_0_20px_rgba(16,185,129,0.15)]' :
                          res?.status === 'failed' ? 'border-red-500/30 bg-red-950/20' :
                          'border-slate-800 bg-[#15181e]'
                        }`}
                      >
                        <div className="pt-1">{getAgentIcon(step.agent, res?.status === 'running')}</div>
                        <div>
                          <span className="font-mono text-xs font-bold text-slate-400">[{step.id}] {step.agent}</span>
                          <p className="text-sm text-slate-300 mt-1 leading-snug">{step.instruction}</p>
                        </div>
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
