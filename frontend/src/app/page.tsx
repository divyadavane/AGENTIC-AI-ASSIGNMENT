"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Terminal, Brain, Search, Database, PenTool, CheckCircle, AlertTriangle, Loader2, Play } from "lucide-react";

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

export default function AgentDashboard() {
  const [task, setTask] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [useMock, setUseMock] = useState(false);
  const [status, setStatus] = useState<string>("idle");
  const [steps, setSteps] = useState<Step[]>([]);
  const [results, setResults] = useState<Record<string, StepResult>>({});
  const [logs, setLogs] = useState<string[]>([]);
  const [finalOutput, setFinalOutput] = useState("");
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const addLog = (msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toISOString().split("T")[1].slice(0, 8)}] ${msg}`]);
  };

  const runPipeline = async () => {
    if (!task) return;
    setIsStreaming(true);
    setStatus("decomposing");
    setSteps([]);
    setResults({});
    setLogs([]);
    setFinalOutput("");
    
    addLog(`System initialized. Sending task: "${task}"`);

    try {
      const url = `http://localhost:8000/api/run?task=${encodeURIComponent(task)}&mock=${useMock}`;
      const eventSource = new EventSource(url);

      eventSource.addEventListener("status", (e) => {
        const data = JSON.parse(e.data);
        setStatus(data.status);
        addLog(`Status change: ${data.message}`);
        
        if (data.status === "finished") {
          setIsStreaming(false);
          eventSource.close();
        }
      });

      eventSource.addEventListener("decomposition", (e) => {
        const data = JSON.parse(e.data);
        setSteps(data);
        addLog(`Task decomposed into ${data.length} steps.`);
        
        // Initialize results state for all steps
        const initResults: Record<string, StepResult> = {};
        data.forEach((s: Step) => {
          initResults[s.id] = { step_id: s.id, agent: s.agent, status: "pending", output: "", duration_ms: 0 };
        });
        setResults(initResults);
      });

      eventSource.addEventListener("step_result", (e) => {
        const data = JSON.parse(e.data) as StepResult;
        
        setResults((prev) => {
          // If the agent is writer and output is streaming, append it instead of replacing
          if (data.agent === "writer") {
             if (data.output && data.output.length > 0) {
                 setFinalOutput(data.output);
             }
          }
          return { ...prev, [data.step_id]: data };
        });
        
        if (data.status === "success") {
           addLog(`[${data.agent}] Step ${data.step_id} completed successfully in ${data.duration_ms}ms`);
        } else if (data.status === "failed") {
           addLog(`[${data.agent}] Step ${data.step_id} FAILED: ${data.error}`);
        }
      });

      eventSource.addEventListener("error", (e) => {
        const data = JSON.parse(e.data);
        addLog(`ERROR: ${data.error}`);
        setIsStreaming(false);
        setStatus("error");
        eventSource.close();
      });

    } catch (err) {
      addLog(`Failed to connect to orchestrator API.`);
      setIsStreaming(false);
      setStatus("error");
    }
  };

  const getAgentIcon = (agentName: string, active: boolean) => {
    const props = { className: `w-6 h-6 ${active ? 'animate-pulse text-white' : 'text-slate-500'}` };
    switch (agentName) {
      case "retriever": return <Search {...props} />;
      case "analyzer": return <Database {...props} />;
      case "writer": return <PenTool {...props} />;
      default: return <Brain {...props} />;
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-slate-300 font-sans p-6 md:p-12 selection:bg-emerald-500/30 relative overflow-hidden">
      
      {/* Background Ambient Glows */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-emerald-900/20 blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-blue-900/20 blur-[120px] pointer-events-none"></div>

      {/* HEADER */}
      <header className="mb-12 flex items-center justify-between border-b border-slate-800/50 pb-6 relative z-10">
        <div className="flex items-center gap-4">
          <div className="bg-gradient-to-br from-emerald-500/20 to-blue-500/20 p-3 rounded-2xl border border-emerald-500/30 shadow-[0_0_30px_rgba(16,185,129,0.15)] relative group">
            <div className="absolute inset-0 bg-emerald-500/20 rounded-2xl blur-md group-hover:bg-emerald-400/30 transition-all duration-500"></div>
            <Brain className="w-8 h-8 text-emerald-400 relative z-10" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white via-emerald-100 to-emerald-400 tracking-tight">Agentic AI Orchestrator</h1>
            <p className="text-sm text-emerald-500/70 font-mono mt-1 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              v2.0 // Neural Pipeline Active
            </p>
          </div>
        </div>
        
        {/* Settings & Status */}
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer bg-slate-900/50 px-4 py-2 rounded-full border border-slate-800 backdrop-blur-md hover:bg-slate-800/50 transition-colors">
            <div className="relative">
              <input type="checkbox" className="sr-only" checked={useMock} onChange={(e) => setUseMock(e.target.checked)} disabled={isStreaming} />
              <div className={`block w-10 h-6 rounded-full transition-colors ${useMock ? 'bg-emerald-500' : 'bg-slate-700'}`}></div>
              <div className={`absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${useMock ? 'translate-x-4' : 'translate-x-0'}`}></div>
            </div>
            <span className="text-xs font-mono text-slate-400">MOCK MODE</span>
          </label>

          <div className="flex items-center gap-2 px-4 py-2 bg-slate-900/80 rounded-full border border-slate-800 text-sm font-mono backdrop-blur-md shadow-lg">
            <div className={`w-2.5 h-2.5 rounded-full ${
              status === 'idle' ? 'bg-slate-500' :
              status === 'error' ? 'bg-red-500 animate-pulse' :
              status === 'finished' ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]' : 'bg-amber-500 animate-pulse shadow-[0_0_10px_rgba(245,158,11,0.8)]'
            }`} />
            <span className="uppercase tracking-wider text-slate-300 font-bold">{status}</span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto space-y-8 relative z-10">
        
        {/* INPUT SECTION */}
        <section className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500/30 via-blue-500/30 to-purple-500/30 rounded-3xl blur-lg opacity-40 group-hover:opacity-70 transition duration-1000"></div>
          <div className="relative bg-[#0a0a0a] border border-slate-800/80 p-3 rounded-3xl flex shadow-2xl items-center focus-within:border-emerald-500/50 transition-all backdrop-blur-xl hover:shadow-[0_0_30px_rgba(16,185,129,0.1)]">
            <input
              type="text"
              className="w-full bg-transparent border-none text-xl p-5 text-white placeholder-slate-600 focus:ring-0 focus:outline-none font-light tracking-wide"
              placeholder="Describe a complex task for the AI to orchestrate..."
              value={task}
              onChange={(e) => setTask(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runPipeline()}
              disabled={isStreaming}
            />
            <button
              onClick={runPipeline}
              disabled={isStreaming || !task}
              className="bg-gradient-to-r from-emerald-500 to-emerald-400 hover:from-emerald-400 hover:to-emerald-300 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-500 text-slate-950 font-bold p-5 rounded-2xl transition-all flex items-center justify-center min-w-[70px] shadow-[0_0_20px_rgba(16,185,129,0.3)] disabled:shadow-none transform hover:scale-105 active:scale-95"
            >
              {isStreaming ? <Loader2 className="w-7 h-7 animate-spin" /> : <Play className="w-7 h-7 ml-1" />}
            </button>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* DECOMPOSITION & PIPELINE */}
          <div className="col-span-1 space-y-8">
            
            {/* Agent Nodes */}
            <section className="bg-[#0f1115]/80 border border-slate-800/80 rounded-3xl p-7 backdrop-blur-md shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl"></div>
              <h2 className="text-xs font-mono text-slate-400 mb-6 uppercase tracking-[0.2em] flex items-center gap-2">
                <Brain className="w-4 h-4 text-emerald-500" /> Active Pipeline
              </h2>
              <div className="space-y-4 relative z-10">
                {/* Connecting Line behind nodes */}
                <div className="absolute left-7 top-10 bottom-10 w-0.5 bg-gradient-to-b from-slate-800 via-slate-700 to-slate-800 -z-10"></div>
                
                {["retriever", "analyzer", "writer"].map((agentName, idx) => {
                  const isActive = Object.values(results).some(r => r.agent === agentName && r.status === "running");
                  const isDone = Object.values(results).some(r => r.agent === agentName && r.status === "success");
                  
                  return (
                    <motion.div
                      key={agentName}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.1 }}
                      className={`relative flex items-center p-4 rounded-2xl border ${
                        isActive ? 'bg-emerald-950/40 border-emerald-500/50 shadow-[0_0_30px_rgba(16,185,129,0.15)] scale-[1.02]' : 
                        isDone ? 'bg-slate-800/40 border-slate-700/50 opacity-80' : 'bg-[#15181e] border-slate-800/80'
                      } transition-all duration-500`}
                    >
                      <div className={`p-3 rounded-xl ${isActive ? 'bg-gradient-to-br from-emerald-500/30 to-emerald-400/10 shadow-inner' : 'bg-slate-800/80'}`}>
                        {getAgentIcon(agentName, isActive)}
                      </div>
                      <div className="ml-5 flex-1">
                        <h3 className={`font-mono text-sm uppercase tracking-wider ${isActive ? 'text-emerald-400 font-bold' : isDone ? 'text-slate-300' : 'text-slate-500'}`}>{agentName}</h3>
                        <p className="text-xs text-slate-500 mt-1">
                          {isActive ? <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping"></span> Processing data stream...</span> : isDone ? "Task Completed" : "Awaiting dependencies"}
                        </p>
                      </div>
                      {isDone && <CheckCircle className="w-6 h-6 text-emerald-500/80 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]" />}
                    </motion.div>
                  )
                })}
              </div>
            </section>

            {/* Decomposition Plan */}
            <section className="bg-[#0f1115]/80 border border-slate-800/80 rounded-3xl p-7 backdrop-blur-md shadow-2xl flex-1 relative overflow-hidden">
              <div className="absolute bottom-0 left-0 w-32 h-32 bg-purple-500/5 rounded-full blur-3xl"></div>
              <h2 className="text-xs font-mono text-slate-400 mb-6 uppercase tracking-[0.2em]">Execution Graph</h2>
              {steps.length === 0 ? (
                <div className="text-center py-10 text-slate-600 text-sm font-mono border border-dashed border-slate-800/80 rounded-2xl bg-slate-900/30">
                  <div className="animate-pulse flex flex-col items-center">
                    <Database className="w-8 h-8 mb-3 opacity-20" />
                    <span>Awaiting task decomposition...</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-3 relative z-10">
                  <AnimatePresence>
                    {steps.map((step, idx) => {
                      const res = results[step.id];
                      return (
                        <motion.div
                          key={step.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.1 }}
                          className={`p-4 rounded-xl border text-sm flex items-start gap-3 ${
                            res?.status === 'success' ? 'border-slate-700/50 bg-slate-800/30 text-slate-300' :
                            res?.status === 'running' ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-100 shadow-[0_0_15px_rgba(16,185,129,0.1)]' :
                            res?.status === 'failed' ? 'border-red-500/30 bg-red-950/20 text-red-300' :
                            'border-slate-800/50 bg-[#15181e] text-slate-400'
                          }`}
                        >
                          <span className={`shrink-0 font-mono font-bold ${res?.status === 'running' ? 'text-emerald-400' : 'text-slate-600'}`}>[{step.id}]</span>
                          <span className="flex-1 leading-relaxed font-light">{step.instruction}</span>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}
            </section>
          </div>

          {/* RIGHT COLUMN: Terminal & Final Output */}
          <div className="col-span-1 lg:col-span-2 flex flex-col gap-8 h-full">
            
            {/* Web Results / Retriever Output */}
            <section className="bg-[#0f1115]/90 border border-slate-800/80 rounded-3xl p-6 shadow-2xl relative overflow-hidden h-[250px] flex flex-col group transition-all duration-700 hover:border-slate-700">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 opacity-50"></div>
              
              <h2 className="text-xs font-mono text-slate-400 mb-4 uppercase tracking-[0.2em] flex justify-between items-center relative z-10">
                <span className="flex items-center gap-2"><Search className="w-4 h-4 text-indigo-400" /> Retrieved Web Data</span>
              </h2>
              
              <div className="flex-1 overflow-y-auto font-mono text-sm text-slate-300 leading-relaxed scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent pr-4 relative z-10 whitespace-pre-wrap">
                {Object.values(results).find(r => r.agent === 'retriever')?.output ? (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    {Object.values(results).find(r => r.agent === 'retriever')?.output}
                  </motion.div>
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-600 text-center border border-dashed border-slate-800/50 rounded-2xl bg-slate-900/20">
                    <div className="max-w-xs">
                      Web search results and gathered context will appear here.
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* Writer Final Output */}
            <section className="bg-[#0f1115]/90 border border-slate-800/80 rounded-3xl p-8 shadow-2xl relative overflow-hidden flex-1 min-h-[350px] flex flex-col group transition-all duration-700 hover:border-slate-700">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 via-blue-500 to-purple-500 opacity-70"></div>
              
              <div className="absolute -right-20 -top-20 w-64 h-64 bg-emerald-500/5 rounded-full blur-[80px] pointer-events-none"></div>

              <h2 className="text-xs font-mono text-slate-400 mb-8 uppercase tracking-[0.2em] flex justify-between items-center relative z-10">
                <span className="flex items-center gap-2"><PenTool className="w-4 h-4 text-blue-400" /> Synthesized Response</span>
                {status === "finished" && <span className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-3 py-1 rounded-full text-xs animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.2)]">READY</span>}
              </h2>
              
              <div className="flex-1 overflow-y-auto pr-4 prose prose-invert prose-emerald prose-p:leading-relaxed prose-p:text-[1.05rem] max-w-none relative z-10 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
                {finalOutput ? (
                  <motion.div 
                    initial={{ opacity: 0, filter: "blur(4px)" }} 
                    animate={{ opacity: 1, filter: "blur(0px)" }} 
                    className="text-slate-200 font-sans tracking-wide"
                  >
                    {finalOutput}
                    {status === "executing" && <span className="inline-block w-2 h-5 bg-emerald-500 ml-1 animate-pulse align-middle"></span>}
                  </motion.div>
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-600 font-mono text-sm text-center border border-dashed border-slate-800/50 rounded-2xl bg-slate-900/20">
                    <div className="max-w-xs">
                      The WriterAgent's abstractive response will stream here in real-time once analysis completes.
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* RAW LOGS / TERMINAL */}
            <section className="bg-[#050505] border border-slate-800/80 rounded-3xl flex flex-col overflow-hidden h-[400px] shadow-2xl relative">
              <div className="absolute top-0 w-full h-[1px] bg-gradient-to-r from-transparent via-slate-700 to-transparent"></div>
              <div className="bg-[#0a0a0a] px-5 py-3 flex items-center gap-3 border-b border-slate-800/80">
                <Terminal className="w-4 h-4 text-emerald-500" />
                <span className="text-xs font-mono text-slate-400 tracking-wider">system.log</span>
              </div>
              <div className="flex-1 p-5 overflow-y-auto font-mono text-[13px] leading-relaxed space-y-1.5 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
                {logs.length === 0 ? (
                  <div className="text-slate-700 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-slate-700 animate-ping"></span> Listening for orchestrator events...
                  </div>
                ) : (
                  logs.map((log, i) => (
                    <motion.div 
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      key={i} 
                      className={`${
                        log.includes("ERROR") ? "text-red-400 bg-red-950/20 px-2 py-0.5 rounded" :
                        log.includes("SUCCESS") ? "text-emerald-400" :
                        log.includes("FAILED") ? "text-red-400 font-bold bg-red-950/30 px-2 py-0.5 rounded" :
                        log.includes("Status change:") ? "text-blue-400" :
                        "text-slate-400"
                      }`}
                    >
                      <span className="text-slate-600 mr-2 opacity-50">❯</span> {log}
                    </motion.div>
                  ))
                )}
                <div ref={logsEndRef} />
              </div>
            </section>
          </div>
          
        </div>
      </main>
    </div>
  );
}
