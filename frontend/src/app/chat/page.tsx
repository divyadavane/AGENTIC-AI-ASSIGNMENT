"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Brain, Search, Database, PenTool, CheckCircle, Loader2, Play, User, 
  ArrowLeft, Terminal, Paperclip, X, Image as ImageIcon, FileText, Copy, 
  Menu, Plus, MessageSquare, Trash2, Zap
} from "lucide-react";
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
  content: string;
};

type Session = {
  id: string;
  title: string;
  history: ChatMessage[];
  steps: Step[];
  results: Record<string, StepResult>;
  finalOutput: string;
  logs: string[];
  isExecuting: boolean;
  isClarifying: boolean;
  status: string;
  attachments: Attachment[];
};

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

function ChatInterface() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTask = searchParams.get("q") || "";

  // -- Sessions State --
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Initialize first session
  useEffect(() => {
    if (sessions.length === 0) {
      const newId = generateId();
      setSessions([{
        id: newId,
        title: "New Chat",
        history: [],
        steps: [],
        results: {},
        finalOutput: "",
        logs: [],
        isExecuting: false,
        isClarifying: false,
        status: "idle",
        attachments: []
      }]);
      setActiveSessionId(newId);
    }
  }, []);

  const activeSession = sessions.find(s => s.id === activeSessionId) || sessions[0];

  const updateSession = (id: string, updates: Partial<Session> | ((prev: Session) => Session)) => {
    setSessions(prev => prev.map(s => {
      if (s.id === id) {
        return typeof updates === "function" ? updates(s) : { ...s, ...updates };
      }
      return s;
    }));
  };

  const createNewSession = () => {
    const newId = generateId();
    setSessions(prev => [{
      id: newId,
      title: "New Chat",
      history: [],
      steps: [],
      results: {},
      finalOutput: "",
      logs: [],
      isExecuting: false,
      isClarifying: false,
      status: "idle",
      attachments: []
    }, ...prev]);
    setActiveSessionId(newId);
    setInput("");
  };

  const clearSession = (id: string) => {
    updateSession(id, {
      history: [],
      steps: [],
      results: {},
      finalOutput: "",
      logs: [],
      isExecuting: false,
      isClarifying: false,
      status: "idle",
      attachments: []
    });
  };

  const deleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSessions(prev => {
      const newSessions = prev.filter(s => s.id !== id);
      if (newSessions.length === 0) {
        // If we deleted the last one, create a new empty one
        const newId = generateId();
        setActiveSessionId(newId);
        return [{
          id: newId,
          title: "New Chat",
          history: [],
          steps: [],
          results: {},
          finalOutput: "",
          logs: [],
          isExecuting: false,
          isClarifying: false,
          status: "idle",
          attachments: []
        }];
      }
      if (activeSessionId === id) {
        setActiveSessionId(newSessions[0].id);
      }
      return newSessions;
    });
  };

  // -- Input State --
  const [input, setInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
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

  const endOfMessagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeSession?.history, activeSession?.finalOutput, activeSession?.attachments]);

  // Initial trigger for query param
  const hasProcessedInitialTask = useRef(false);
  useEffect(() => {
    if (initialTask && activeSession && activeSession.history.length === 0 && !hasProcessedInitialTask.current) {
      hasProcessedInitialTask.current = true;
      handleClarify(activeSession.id, [{ role: "user", content: initialTask }]);
      // Remove query param so refreshing doesn't re-trigger it
      window.history.replaceState({}, '', '/chat');
    }
  }, [initialTask, activeSessionId]); // Wait until active session is set

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  const addLog = (sessionId: string, msg: string) => {
    const timestamp = new Date().toISOString().split("T")[1].slice(0, 8);
    updateSession(sessionId, prev => ({
      ...prev,
      logs: [...prev.logs, `[${timestamp}] ${msg}`]
    }));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeSessionId) return;
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    for (const file of files) {
      const isImage = file.type.startsWith("image/");
      const reader = new FileReader();

      reader.onload = (event) => {
        const result = event.target?.result as string;
        updateSession(activeSessionId, prev => ({
          ...prev,
          attachments: [...prev.attachments, {
            type: isImage ? "image" : "text",
            name: file.name,
            content: result
          }]
        }));
      };

      if (isImage) {
        reader.readAsDataURL(file); // base64
      } else {
        reader.readAsText(file);
      }
    }
    
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (index: number) => {
    updateSession(activeSessionId, prev => ({
      ...prev,
      attachments: prev.attachments.filter((_, i) => i !== index)
    }));
  };

  const handleClarify = async (sessionId: string, chatHistory: ChatMessage[]) => {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;

    updateSession(sessionId, { isClarifying: true, history: chatHistory });
    
    // Update title if this is the first message
    if (chatHistory.length === 1 && session.title === "New Chat") {
      updateSession(sessionId, { title: chatHistory[0].content.slice(0, 30) + (chatHistory[0].content.length > 30 ? "..." : "") });
    }

    try {
      const res = await fetch("http://localhost:8000/api/clarify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_history: chatHistory, attachments: session.attachments })
      });
      
      const data = await res.json();
      
      if (data.action === "question") {
        updateSession(sessionId, prev => ({
          ...prev,
          history: [...prev.history, { role: "assistant", content: data.question }],
          isClarifying: false
        }));
      } else {
        updateSession(sessionId, { isClarifying: false, isExecuting: true });
        runPipeline(sessionId, data.task);
      }
    } catch (e) {
      console.error(e);
      updateSession(sessionId, prev => ({
        ...prev,
        isClarifying: false,
        history: [...prev.history, { role: "assistant", content: "Error connecting to orchestrator. Please try again." }]
      }));
    }
  };

  const handleSubmit = (e?: React.FormEvent, manualInput?: string) => {
    if (e) e.preventDefault();
    const submitText = manualInput ?? input;
    
    if (!activeSession) return;
    if ((!submitText.trim() && activeSession.attachments.length === 0) || activeSession.isClarifying || activeSession.isExecuting) return;
    
    const msgContent = submitText.trim() || "Analyze attached files.";
    const newHistory: ChatMessage[] = [...activeSession.history, { role: "user", content: msgContent }];
    
    if (!manualInput) setInput("");
    handleClarify(activeSessionId, newHistory);
  };

  const runPipeline = async (sessionId: string, finalTask: string) => {
    updateSession(sessionId, {
      status: "decomposing",
      steps: [],
      results: {},
      logs: [],
      finalOutput: ""
    });
    
    let currentFinalOutput = ""; // Keep track locally for closure
    
    addLog(sessionId, `System initialized. Final task: "${finalTask}"`);

    const session = sessions.find(s => s.id === sessionId);
    const attachments = session?.attachments || [];

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
                updateSession(sessionId, { status: data.status });
                addLog(sessionId, `Status change: ${data.message}`);
                
                if (data.status === "finished") {
                  updateSession(sessionId, prev => {
                    let outputToShow = currentFinalOutput;
                    if (!outputToShow.trim()) {
                      // Collect outputs from all successful steps as fallback
                      const stepOutputs = Object.values(prev.results)
                        .filter((r: StepResult) => r.status === "success" && r.output)
                        .map((r: StepResult) => r.output);
                      if (stepOutputs.length > 0) {
                        outputToShow = stepOutputs[stepOutputs.length - 1];
                      }
                    }
                    return {
                      ...prev,
                      isExecuting: false,
                      finalOutput: outputToShow,
                      history: [...prev.history, { role: "assistant", content: outputToShow || "The pipeline completed but no output was generated. Please try again." }],
                      attachments: []
                    };
                  });
                }
              } else if (event === "decomposition") {
                const initResults: Record<string, StepResult> = {};
                data.forEach((s: Step) => {
                  initResults[s.id] = { step_id: s.id, agent: s.agent, status: "pending", output: "", duration_ms: 0 };
                });
                updateSession(sessionId, { steps: data, results: initResults });
                addLog(sessionId, `Task decomposed into ${data.length} steps.`);
              } else if (event === "token") {
                currentFinalOutput += data.token;
                updateSession(sessionId, { finalOutput: currentFinalOutput });
              } else if (event === "step_result") {
                updateSession(sessionId, prev => {
                   const newResults = { ...prev.results, [data.step_id]: data };
                   let newOutput = prev.finalOutput;
                   if (data.agent === "writer" && data.output) {
                       newOutput = data.output;
                       currentFinalOutput = data.output;
                   }
                   return { ...prev, results: newResults, finalOutput: newOutput };
                });
                
                if (data.status === "success") {
                   addLog(sessionId, `[${data.agent}] Step ${data.step_id} completed in ${data.duration_ms}ms`);
                } else if (data.status === "failed") {
                   addLog(sessionId, `[${data.agent}] Step ${data.step_id} FAILED: ${data.error}`);
                }
              } else if (event === "error") {
                addLog(sessionId, `ERROR: ${data.error}`);
                updateSession(sessionId, { isExecuting: false, status: "error" });
              }
            } catch (err) {
              console.error("Failed to parse SSE event", err);
            }
          }
        }
      }

    } catch (err) {
      addLog(sessionId, `Failed to connect to orchestrator API.`);
      updateSession(sessionId, { isExecuting: false, status: "error" });
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

  if (!activeSession) return null;

  return (
    <div className="min-h-screen bg-[#050505] text-slate-300 font-sans selection:bg-emerald-500/30 flex overflow-hidden">
      
      {/* Background Ambient Glows */}
      <div className="absolute top-0 left-[-10%] w-[40%] h-[40%] rounded-full bg-emerald-900/10 blur-[120px] pointer-events-none z-0"></div>

      {/* SIDEBAR */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div 
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            className="flex-shrink-0 bg-[#0a0a0a] border-r border-slate-800/50 flex flex-col z-20 relative overflow-hidden h-full"
          >
            <div className="p-4 border-b border-slate-800/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="bg-gradient-to-br from-emerald-500/20 to-blue-500/20 p-2 rounded-xl border border-emerald-500/30">
                  <Brain className="w-5 h-5 text-emerald-400" />
                </div>
                <span className="font-bold text-white tracking-tight">Zyro Agent</span>
              </div>
            </div>

            <div className="p-4">
              <button 
                onClick={createNewSession}
                className="w-full bg-[#15181e] hover:bg-slate-800 border border-slate-700/50 text-white rounded-xl py-3 px-4 flex items-center justify-center gap-2 transition-colors font-medium text-sm shadow-lg shadow-black/20"
              >
                <Plus className="w-4 h-4" /> New Chat
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-1 scrollbar-thin scrollbar-thumb-slate-800">
              <div className="px-3 pb-2 text-xs font-mono text-slate-500 uppercase tracking-widest">Recent</div>
              {sessions.map(session => (
                <div key={session.id} className="relative group">
                  <button
                    onClick={() => setActiveSessionId(session.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-3 transition-colors text-sm ${
                      activeSessionId === session.id 
                        ? 'bg-emerald-900/20 text-emerald-400 border border-emerald-900/30' 
                        : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200 border border-transparent'
                    }`}
                  >
                    <MessageSquare className="w-4 h-4 shrink-0" />
                    <span className="truncate pr-6">{session.title}</span>
                  </button>
                  <button
                    onClick={(e) => deleteSession(session.id, e)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Delete Chat"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-slate-800/50 bg-[#070707]">
              <div className="flex items-center gap-2 mb-2 text-xs font-mono text-slate-500 uppercase tracking-widest">Capabilities</div>
              <ul className="text-xs text-slate-400 space-y-2 font-mono">
                <li className="flex items-center gap-2"><Zap className="w-3 h-3 text-emerald-500" /> Real-time Search</li>
                <li className="flex items-center gap-2"><Zap className="w-3 h-3 text-blue-500" /> Data Analysis</li>
                <li className="flex items-center gap-2"><Zap className="w-3 h-3 text-purple-500" /> Web Scraping</li>
              </ul>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col relative h-full w-full">
        
        {/* HEADER */}
        <header className="flex-shrink-0 flex items-center gap-4 p-4 border-b border-slate-800/50 bg-[#0a0a0a]/80 backdrop-blur-md z-10">
          <button 
            onClick={() => setSidebarOpen(!sidebarOpen)} 
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400"
          >
            <Menu className="w-5 h-5" />
          </button>
          
          <div className="flex-1 flex flex-col">
            <span className="font-semibold text-white">{activeSession.title}</span>
            <p className="text-[10px] text-emerald-500/70 font-mono flex items-center gap-1.5 uppercase tracking-wider">
              <span className={`w-1.5 h-1.5 rounded-full bg-emerald-500 ${activeSession.isExecuting || activeSession.isClarifying ? 'animate-pulse' : ''}`}></span>
              {activeSession.isExecuting ? `Pipeline ${activeSession.status}...` : activeSession.isClarifying ? "Clarifying intent..." : "Online"}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={() => router.push("/history")}
              className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white bg-slate-800/50 hover:bg-slate-700 rounded-lg transition-colors"
            >
              History
            </button>
            <button 
              onClick={() => clearSession(activeSessionId)}
              className="p-2 text-slate-400 hover:text-red-400 bg-slate-800/50 hover:bg-slate-800 rounded-lg transition-colors"
              title="Clear Chat"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* SPLIT LAYOUT CONTAINER */}
        <div className="flex-1 overflow-hidden flex flex-row relative z-10 w-full h-full">
          
          {/* LEFT COLUMN: CHAT */}
          <div 
            className="flex flex-col h-full transition-all bg-[#050505]"
            style={{ width: activeSession.isExecuting || Object.keys(activeSession.results).length > 0 ? `${splitWidth}%` : '100%', maxWidth: (activeSession.isExecuting || Object.keys(activeSession.results).length > 0) ? 'none' : '56rem', margin: (activeSession.isExecuting || Object.keys(activeSession.results).length > 0) ? '0' : '0 auto' }}
          >
            <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
              
              {/* WELCOME SCREEN */}
              {activeSession.history.length === 0 && !activeSession.isClarifying && !activeSession.isExecuting && (
                <div className="h-full flex flex-col items-center justify-center text-center max-w-2xl mx-auto px-4">
                  <div className="w-20 h-20 bg-gradient-to-br from-emerald-500/20 to-blue-500/20 rounded-3xl border border-emerald-500/30 flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(16,185,129,0.1)]">
                    <Brain className="w-10 h-10 text-emerald-400" />
                  </div>
                  <h2 className="text-2xl font-bold text-white mb-3 tracking-tight">How can I help you today?</h2>
                  <p className="text-slate-400 mb-10">I am an autonomous agent pipeline. Give me a complex task and I'll break it down, research, analyze, and write a comprehensive response.</p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full">
                    {[
                      "Compare Transformer models and SSMs",
                      "Analyze the latest trends in renewable energy",
                      "Write a guide on setting up a Next.js app",
                      "Explain quantum computing simply"
                    ].map((suggestion, i) => (
                      <button
                        key={i}
                        onClick={() => handleSubmit(undefined, suggestion)}
                        className="bg-slate-800/30 hover:bg-slate-800 border border-slate-700/50 hover:border-emerald-500/30 rounded-xl p-4 text-left transition-all text-sm text-slate-300 group"
                      >
                        <p className="line-clamp-2">{suggestion}</p>
                        <ArrowLeft className="w-4 h-4 text-emerald-500 mt-2 opacity-0 group-hover:opacity-100 transition-opacity rotate-135 transform scale-x-[-1]" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* MESSAGES */}
              {activeSession.history.map((msg, idx) => (
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
                  
                  <div className={`flex flex-col gap-1 max-w-[85%] ${msg.role === "user" ? "items-end" : "items-start"}`}>
                    <div className="text-[10px] text-slate-500 font-mono px-1">
                      {msg.role === "user" ? "You" : "Zyro"}
                    </div>
                    
                    <div className={`rounded-2xl p-4 shadow-lg relative group ${
                      msg.role === "user" 
                        ? "bg-slate-800 text-white border border-slate-700/50 rounded-tr-sm" 
                        : "bg-[#0f1115] text-slate-300 border border-emerald-900/30 rounded-tl-sm prose prose-invert prose-emerald max-w-none w-full"
                    }`}>
                      {msg.role === "assistant" ? (
                        <>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                          <div className="mt-3 pt-3 border-t border-slate-800/50 flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => navigator.clipboard.writeText(msg.content)}
                              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white bg-slate-800/50 px-2 py-1 rounded"
                            >
                              <Copy className="w-3 h-3" /> Copy
                            </button>
                          </div>
                        </>
                      ) : (
                        <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                      )}
                    </div>
                  </div>

                  {msg.role === "user" && (
                    <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 mt-1">
                      <User className="w-4 h-4 text-slate-400" />
                    </div>
                  )}
                </motion.div>
              ))}

              {/* TYPING INDICATORS / ACTIVE STATE */}
              {activeSession.isClarifying && (
                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500/20 to-blue-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0">
                    <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
                  </div>
                  <div className="bg-[#0f1115] text-slate-400 border border-emerald-900/30 rounded-2xl rounded-tl-sm p-4 font-mono text-sm">
                    Evaluating task constraints...
                  </div>
                </div>
              )}
              
              {activeSession.isExecuting && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-4 justify-start"
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500/20 to-blue-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0 mt-1">
                    <Brain className="w-4 h-4 text-emerald-400" />
                  </div>
                  
                  <div className="flex flex-col gap-1 max-w-[85%] items-start w-full">
                    <div className="text-[10px] text-slate-500 font-mono px-1">Zyro</div>
                    <div className="rounded-2xl p-4 shadow-lg bg-[#0f1115] text-slate-300 border border-emerald-900/30 rounded-tl-sm prose prose-invert prose-emerald max-w-none w-full relative group">
                      
                      {activeSession.finalOutput ? (
                        <>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{activeSession.finalOutput}</ReactMarkdown>
                          {!["finished", "error"].includes(activeSession.status) && (
                            <span className="inline-block w-2 h-4 bg-emerald-500 ml-1 animate-pulse align-middle"></span>
                          )}
                        </>
                      ) : ["finished", "error"].includes(activeSession.status) ? (
                        <div className="text-slate-500 font-mono text-sm">
                          No writer output was generated. Check the step results on the right for details.
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 h-6">
                           <span className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                           <span className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                           <span className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
              
              <div ref={endOfMessagesRef} />
            </div>

            {/* INPUT BAR */}
            <div className="p-4 bg-[#0a0a0a]/90 backdrop-blur-xl border-t border-slate-800/50 flex flex-col gap-2 relative">
              
              {/* Attachments Preview */}
              {activeSession.attachments.length > 0 && (
                <div className="flex gap-2 px-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-slate-700">
                  {activeSession.attachments.map((att, i) => (
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

              <form onSubmit={handleSubmit} className={`relative group w-full ${activeSession.isExecuting || Object.keys(activeSession.results).length > 0 ? '' : 'max-w-4xl mx-auto'}`}>
                <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500/20 via-blue-500/20 to-purple-500/20 rounded-2xl blur-lg opacity-40 transition duration-1000"></div>
                <div className="relative bg-[#15181e] border border-slate-700/50 p-2 rounded-2xl flex shadow-2xl items-end focus-within:border-emerald-500/50 transition-all">
                  
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={activeSession.isClarifying || activeSession.isExecuting}
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
                    ref={textareaRef}
                    className="w-full bg-transparent border-none text-sm p-3 text-white placeholder-slate-500 focus:ring-0 focus:outline-none resize-none min-h-[44px] max-h-[200px] scrollbar-thin scrollbar-thumb-slate-800"
                    placeholder={activeSession.isExecuting ? "Pipeline is running..." : "Message Zyro..."}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSubmit(e);
                      }
                    }}
                    disabled={activeSession.isClarifying || activeSession.isExecuting}
                    rows={1}
                  />
                  <button
                    type="submit"
                    disabled={(!input.trim() && activeSession.attachments.length === 0) || activeSession.isClarifying || activeSession.isExecuting}
                    className="bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 p-2 rounded-xl transition-all shadow-[0_0_15px_rgba(16,185,129,0.2)] disabled:shadow-none mb-1 mr-1 flex-shrink-0"
                  >
                    <Play className="w-5 h-5" />
                  </button>
                </div>
              </form>
              <div className={`text-center text-[10px] text-slate-500 font-mono mt-1 ${activeSession.isExecuting || Object.keys(activeSession.results).length > 0 ? '' : 'max-w-4xl mx-auto w-full'}`}>
                Enter to send, Shift+Enter for new line
              </div>
            </div>
          </div>

          {/* RESIZER HANDLE */}
          {(activeSession.isExecuting || Object.keys(activeSession.results).length > 0) && (
            <div 
              className="w-1 cursor-col-resize hover:bg-emerald-500/50 active:bg-emerald-500 z-50 transition-colors flex items-center justify-center bg-slate-900"
              onMouseDown={() => {
                isDragging.current = true;
                document.body.style.cursor = "col-resize";
              }}
            >
              <div className="h-10 w-[2px] bg-slate-700/50 rounded-full pointer-events-none"></div>
            </div>
          )}

          {/* RIGHT COLUMN: PIPELINE DASHBOARD */}
          {(activeSession.isExecuting || Object.keys(activeSession.results).length > 0) && (
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
                    {activeSession.steps.map((step) => {
                      const res = activeSession.results[step.id];
                      return (
                        <div key={step.id} className={`p-4 rounded-xl border flex flex-col gap-3 transition-colors ${
                            res?.status === 'success' ? 'border-emerald-500/30 bg-emerald-950/20' :
                            res?.status === 'running' ? 'border-emerald-500 bg-emerald-950/40 shadow-[0_0_20px_rgba(16,185,129,0.15)]' :
                            res?.status === 'failed' ? 'border-emerald-500/30 bg-emerald-950/20' :
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
                          {res?.output && (
                            <div className="mt-2 p-3 bg-black/40 rounded-lg text-xs text-slate-400 overflow-y-auto max-h-40 scrollbar-thin scrollbar-thumb-slate-700 border border-slate-800/50 prose prose-invert prose-emerald prose-sm max-w-none">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{res.output}</ReactMarkdown>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </section>

                {/* TERMINAL LOGS */}
                <section className="bg-[#050505] border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
                  <div className="bg-[#0a0a0a] px-4 py-2 border-b border-slate-800 flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-slate-500" />
                    <span className="text-xs font-mono text-slate-500">system.log</span>
                  </div>
                  <div className="p-4 h-[200px] overflow-y-auto font-mono text-xs leading-relaxed space-y-1 scrollbar-thin scrollbar-thumb-slate-800">
                    {activeSession.logs.map((log, i) => (
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
