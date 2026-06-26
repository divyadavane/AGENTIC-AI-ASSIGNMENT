"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Brain, Search, Database, PenTool, CheckCircle, Loader2, Play, User, 
  ArrowLeft, Terminal, Paperclip, X, Image as ImageIcon, FileText, Copy, 
  Menu, Plus, MessageSquare, Trash2, Zap, ChevronDown, Download, 
  Keyboard, Clock, ThumbsUp, ThumbsDown, Sparkles, ArrowDown,
  Settings, Hash, Shield, Globe, Code, BookOpen
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
  reactions?: { thumbsUp: boolean; thumbsDown: boolean };
};

type Step = {
  id: string;
  agent: "retriever" | "analyzer" | "writer" | "coder";
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

type Toast = {
  id: string;
  message: string;
  type: "success" | "error" | "info";
};

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

function formatTime(ts?: number) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ─── Toast Notification Component ───
function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className={`pointer-events-auto px-4 py-3 rounded-xl border shadow-2xl backdrop-blur-xl flex items-center gap-3 text-sm font-medium cursor-pointer ${
              t.type === "success" ? "bg-emerald-950/80 border-emerald-500/30 text-emerald-300" :
              t.type === "error" ? "bg-red-950/80 border-red-500/30 text-red-300" :
              "bg-slate-900/80 border-slate-700/50 text-slate-300"
            }`}
            onClick={() => onDismiss(t.id)}
          >
            {t.type === "success" && <CheckCircle className="w-4 h-4 text-emerald-400" />}
            {t.type === "error" && <X className="w-4 h-4 text-red-400" />}
            {t.type === "info" && <Sparkles className="w-4 h-4 text-blue-400" />}
            {t.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ─── Keyboard Shortcuts Modal ───
function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  const shortcuts = [
    { keys: "Enter", desc: "Send message" },
    { keys: "Shift + Enter", desc: "New line" },
    { keys: "Ctrl + K", desc: "Toggle shortcuts" },
    { keys: "Ctrl + N", desc: "New chat" },
    { keys: "Ctrl + B", desc: "Toggle sidebar" },
    { keys: "Ctrl + E", desc: "Export chat" },
  ];
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="bg-[#0f1115] border border-slate-700/50 rounded-2xl p-6 w-[420px] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-white font-semibold text-lg flex items-center gap-2">
            <Keyboard className="w-5 h-5 text-emerald-400" /> Keyboard Shortcuts
          </h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-3">
          {shortcuts.map(s => (
            <div key={s.keys} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-800/50 transition-colors">
              <span className="text-sm text-slate-300">{s.desc}</span>
              <div className="flex gap-1">
                {s.keys.split(" + ").map(k => (
                  <kbd key={k} className="px-2 py-1 bg-slate-800 border border-slate-700 rounded-md text-xs font-mono text-slate-300 shadow-sm">{k}</kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

function ChatInterface() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTask = searchParams.get("q") || "";

  // -- Sessions State --
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Toast helpers
  const addToast = useCallback((message: string, type: Toast["type"] = "info") => {
    const id = generateId();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);
  const dismissToast = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

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
    addToast("New conversation started", "success");
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
    addToast("Chat cleared", "info");
  };

  const deleteMessage = (sessionId: string, msgIndex: number) => {
    updateSession(sessionId, prev => ({
      ...prev,
      history: prev.history.filter((_, i) => i !== msgIndex)
    }));
    addToast("Message deleted", "info");
  };

  const deleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSessions(prev => {
      const newSessions = prev.filter(s => s.id !== id);
      if (newSessions.length === 0) {
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
    addToast("Chat deleted", "info");
  };

  const toggleReaction = (sessionId: string, msgIndex: number, reaction: "thumbsUp" | "thumbsDown") => {
    updateSession(sessionId, prev => ({
      ...prev,
      history: prev.history.map((m, i) => {
        if (i !== msgIndex) return m;
        const current = m.reactions || { thumbsUp: false, thumbsDown: false };
        return {
          ...m,
          reactions: {
            ...current,
            [reaction]: !current[reaction],
            ...(reaction === "thumbsUp" && !current.thumbsUp ? { thumbsDown: false } : {}),
            ...(reaction === "thumbsDown" && !current.thumbsDown ? { thumbsUp: false } : {}),
          }
        };
      })
    }));
  };

  const exportChat = () => {
    if (!activeSession) return;
    const lines = activeSession.history.map(m =>
      `[${m.role === "user" ? "You" : "Zyro"}] ${formatTime(m.timestamp)}\n${m.content}\n`
    );
    const blob = new Blob([lines.join("\n---\n\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeSession.title.replace(/[^a-z0-9]/gi, "_")}_chat.txt`;
    a.click();
    URL.revokeObjectURL(url);
    addToast("Chat exported!", "success");
  };

  // -- Input State --
  const [input, setInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // Resizable split pane state
  const [splitWidth, setSplitWidth] = useState(33);
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

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "k") { e.preventDefault(); setShowShortcuts(v => !v); }
      if (e.ctrlKey && e.key === "n") { e.preventDefault(); createNewSession(); }
      if (e.ctrlKey && e.key === "b") { e.preventDefault(); setSidebarOpen(v => !v); }
      if (e.ctrlKey && e.key === "e") { e.preventDefault(); exportChat(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeSession]);

  const endOfMessagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeSession?.history, activeSession?.finalOutput, activeSession?.attachments]);

  // Scroll-to-bottom detection
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120;
      setShowScrollBtn(!atBottom);
    };
    container.addEventListener("scroll", onScroll);
    return () => container.removeEventListener("scroll", onScroll);
  }, [activeSession]);

  // Initial trigger for query param
  const hasProcessedInitialTask = useRef(false);
  useEffect(() => {
    if (initialTask && activeSession && activeSession.history.length === 0 && !hasProcessedInitialTask.current) {
      hasProcessedInitialTask.current = true;
      handleClarify(activeSession.id, [{ role: "user", content: initialTask, timestamp: Date.now() }]);
      window.history.replaceState({}, '', '/chat');
    }
  }, [initialTask, activeSessionId]);

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
        reader.readAsDataURL(file);
      } else {
        reader.readAsText(file);
      }
    }
    addToast(`${files.length} file(s) attached`, "success");
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
          history: [...prev.history, { role: "assistant", content: data.question, timestamp: Date.now() }],
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
        history: [...prev.history, { role: "assistant", content: "Error connecting to orchestrator. Please try again.", timestamp: Date.now() }]
      }));
      addToast("Connection error", "error");
    }
  };

  const handleSubmit = (e?: React.FormEvent, manualInput?: string) => {
    if (e) e.preventDefault();
    const submitText = manualInput ?? input;
    
    if (!activeSession) return;
    if ((!submitText.trim() && activeSession.attachments.length === 0) || activeSession.isClarifying || activeSession.isExecuting) return;
    
    const msgContent = submitText.trim() || "Analyze attached files.";
    const newHistory: ChatMessage[] = [...activeSession.history, { role: "user", content: msgContent, timestamp: Date.now() }];
    
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
    
    let currentFinalOutput = "";
    
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
          buffer = blocks.pop() || "";

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
                      history: [...prev.history, { role: "assistant", content: outputToShow || "The pipeline completed but no output was generated. Please try again.", timestamp: Date.now() }],
                      attachments: []
                    };
                  });
                  addToast("Pipeline completed!", "success");
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
                   return { ...prev, results: newResults };
                });
                
                if (data.status === "success") {
                   addLog(sessionId, `[${data.agent}] Step ${data.step_id} completed in ${data.duration_ms}ms`);
                } else if (data.status === "failed") {
                   addLog(sessionId, `[${data.agent}] Step ${data.step_id} completed with errors: ${data.error}`);
                }
              } else if (event === "error") {
                addLog(sessionId, `ERROR: ${data.error}`);
                updateSession(sessionId, { isExecuting: false, status: "error" });
                addToast("Pipeline error occurred", "error");
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
      addToast("Failed to connect to backend", "error");
    }
  };

  const getAgentIcon = (agentName: string, active: boolean) => {
    const props = { className: `w-5 h-5 ${active ? 'animate-pulse text-white' : 'text-slate-500'}` };
    switch (agentName) {
      case "retriever": return <Search {...props} />;
      case "analyzer": return <Database {...props} />;
      case "writer": return <PenTool {...props} />;
      case "coder": return <Code {...props} />;
      default: return <img src="/logo.png" alt="Zyro Logo" className={props.className} style={{ width: '1em', height: '1em', objectFit: 'contain' }} />;
    }
  };

  const filteredSessions = sessions.filter(s =>
    s.title.toLowerCase().includes(sidebarSearch.toLowerCase())
  );

  const wordCount = input.trim().split(/\s+/).filter(Boolean).length;

  if (!activeSession) return null;

  return (
    <div className="min-h-screen h-screen bg-[#050505] text-slate-300 font-sans selection:bg-emerald-500/30 flex overflow-hidden">
      
      {/* Background Ambient Glows */}
      <div className="absolute top-0 left-[-10%] w-[40%] h-[40%] rounded-full bg-emerald-900/10 blur-[120px] pointer-events-none z-0"></div>
      <div className="absolute bottom-0 right-[-5%] w-[30%] h-[30%] rounded-full bg-blue-900/8 blur-[100px] pointer-events-none z-0"></div>
      <div className="absolute top-[50%] left-[50%] w-[20%] h-[20%] rounded-full bg-purple-900/5 blur-[80px] pointer-events-none z-0 -translate-x-1/2 -translate-y-1/2"></div>

      {/* Toasts */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Shortcuts Modal */}
      <ShortcutsModal open={showShortcuts} onClose={() => setShowShortcuts(false)} />

      {/* SIDEBAR */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div 
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 300, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="flex-shrink-0 bg-[#0a0a0a] border-r border-slate-800/50 flex flex-col z-20 relative overflow-hidden h-full"
          >
            {/* Sidebar Header */}
            <div className="p-4 border-b border-slate-800/50">
              <div className="flex items-center gap-3 mb-4">
                <img src="/logo.png" alt="Zyro Logo" className="w-10 h-10 object-contain drop-shadow-[0_0_15px_rgba(16,185,129,0.3)]" />
                <div>
                  <span className="font-bold text-white tracking-tight block">Zyro Agent</span>
                  <span className="text-[10px] text-emerald-500/70 font-mono uppercase tracking-wider">v2.0 • AI Pipeline</span>
                </div>
              </div>

              {/* Search in sidebar */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search conversations..."
                  value={sidebarSearch}
                  onChange={e => setSidebarSearch(e.target.value)}
                  className="w-full bg-[#15181e] border border-slate-700/50 rounded-lg py-2 pl-9 pr-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 transition-colors"
                />
              </div>
            </div>

            {/* New Chat Button */}
            <div className="p-3">
              <button 
                onClick={createNewSession}
                className="w-full bg-gradient-to-r from-emerald-600/20 to-blue-600/20 hover:from-emerald-600/30 hover:to-blue-600/30 border border-emerald-500/30 text-white rounded-xl py-3 px-4 flex items-center justify-center gap-2 transition-all font-medium text-sm shadow-lg shadow-emerald-900/10 hover:shadow-emerald-900/20 active:scale-[0.98]"
              >
                <Plus className="w-4 h-4" /> New Chat
              </button>
            </div>

            {/* Sessions List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1 scrollbar-thin scrollbar-thumb-slate-800">
              <div className="px-3 pb-2 text-[10px] font-mono text-slate-500 uppercase tracking-widest flex items-center justify-between">
                <span>Recent ({filteredSessions.length})</span>
                <Clock className="w-3 h-3" />
              </div>
              {filteredSessions.length === 0 && (
                <div className="text-center text-xs text-slate-500 py-8 font-mono">No conversations found</div>
              )}
              {filteredSessions.map(session => (
                <div key={session.id} className="relative group">
                  <button
                    onClick={() => setActiveSessionId(session.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-3 transition-all text-sm ${
                      activeSessionId === session.id 
                        ? 'bg-emerald-900/20 text-emerald-400 border border-emerald-900/30 shadow-[0_0_10px_rgba(16,185,129,0.05)]' 
                        : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200 border border-transparent'
                    }`}
                  >
                    <MessageSquare className="w-4 h-4 shrink-0" />
                    <span className="truncate pr-10 flex-1">{session.title}</span>
                    {/* Message count badge */}
                    {session.history.length > 0 && (
                      <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-full shrink-0 ${
                        activeSessionId === session.id ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'
                      }`}>
                        {session.history.length}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={(e) => deleteSession(session.id, e)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-md opacity-0 group-hover:opacity-100 transition-all"
                    title="Delete Chat"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Sidebar Footer: Capabilities + Quick Actions */}
            <div className="border-t border-slate-800/50 bg-[#070707]">
              <div className="p-4">
                <div className="flex items-center gap-2 mb-3 text-[10px] font-mono text-slate-500 uppercase tracking-widest">
                  <Sparkles className="w-3 h-3 text-emerald-500" />
                  Capabilities
                </div>
                <ul className="text-[11px] text-slate-400 space-y-2">
                  <li className="flex items-center gap-2.5"><Globe className="w-3 h-3 text-emerald-500" /> Real-time Search</li>
                  <li className="flex items-center gap-2.5"><Database className="w-3 h-3 text-blue-500" /> Data Analysis</li>
                  <li className="flex items-center gap-2.5"><Code className="w-3 h-3 text-purple-500" /> Code Generation</li>
                  <li className="flex items-center gap-2.5"><BookOpen className="w-3 h-3 text-amber-500" /> Document Parsing</li>
                </ul>
              </div>
              <div className="px-4 pb-3 flex gap-2">
                <button 
                  onClick={() => setShowShortcuts(true)} 
                  className="flex-1 p-2 text-slate-500 hover:text-slate-300 bg-slate-800/30 hover:bg-slate-800/60 rounded-lg transition-colors flex items-center justify-center gap-1.5 text-[10px] font-mono"
                >
                  <Keyboard className="w-3 h-3" /> Shortcuts
                </button>
                <button 
                  onClick={exportChat} 
                  className="flex-1 p-2 text-slate-500 hover:text-slate-300 bg-slate-800/30 hover:bg-slate-800/60 rounded-lg transition-colors flex items-center justify-center gap-1.5 text-[10px] font-mono"
                >
                  <Download className="w-3 h-3" /> Export
                </button>
              </div>
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
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-white"
          >
            <Menu className="w-5 h-5" />
          </button>
          
          <div className="flex-1 flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-white">{activeSession.title}</span>
              {activeSession.history.length > 0 && (
                <span className="text-[9px] font-mono bg-slate-800/80 text-slate-400 px-2 py-0.5 rounded-full">
                  {activeSession.history.length} msgs
                </span>
              )}
            </div>
            <p className="text-[10px] text-emerald-500/70 font-mono flex items-center gap-1.5 uppercase tracking-wider">
              <span className={`w-1.5 h-1.5 rounded-full bg-emerald-500 ${activeSession.isExecuting || activeSession.isClarifying ? 'animate-pulse' : ''}`}></span>
              {activeSession.isExecuting ? `Pipeline ${activeSession.status}...` : activeSession.isClarifying ? "Clarifying intent..." : "Online"}
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <button 
              onClick={exportChat}
              className="p-2 text-slate-400 hover:text-emerald-400 bg-slate-800/50 hover:bg-slate-800 rounded-lg transition-colors"
              title="Export Chat (Ctrl+E)"
            >
              <Download className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setShowShortcuts(true)}
              className="p-2 text-slate-400 hover:text-blue-400 bg-slate-800/50 hover:bg-slate-800 rounded-lg transition-colors"
              title="Shortcuts (Ctrl+K)"
            >
              <Keyboard className="w-4 h-4" />
            </button>
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
            <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent relative">
              
              {/* WELCOME SCREEN */}
              {activeSession.history.length === 0 && !activeSession.isClarifying && !activeSession.isExecuting && (
                <div className="h-full flex flex-col items-center justify-center text-center max-w-2xl mx-auto px-4">
                  
                  {/* Animated gradient orb */}
                  <div className="relative mb-8">
                    <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/30 to-blue-500/30 rounded-3xl blur-2xl animate-pulse"></div>
                    <img src="/logo.png" alt="Zyro Logo" className="w-24 h-24 object-contain drop-shadow-[0_0_30px_rgba(16,185,129,0.4)] relative z-10" />
                  </div>

                  <h2 className="text-3xl font-bold text-white mb-2 tracking-tight">
                    Hello! I&apos;m <span className="bg-gradient-to-r from-emerald-400 to-blue-400 bg-clip-text text-transparent">Zyro</span>
                  </h2>
                  <p className="text-slate-400 mb-3 text-sm">Your autonomous AI agent pipeline</p>
                  <p className="text-slate-500 mb-10 text-xs max-w-md">
                    Give me a complex task and I&apos;ll break it down into steps, research, analyze, and compose a comprehensive response using multiple specialized agents.
                  </p>

                  {/* Feature pills */}
                  <div className="flex flex-wrap justify-center gap-2 mb-8">
                    {[
                      { icon: <Globe className="w-3 h-3" />, label: "Web Search", color: "emerald" },
                      { icon: <Database className="w-3 h-3" />, label: "Analysis", color: "blue" },
                      { icon: <Code className="w-3 h-3" />, label: "Code Gen", color: "purple" },
                      { icon: <ImageIcon className="w-3 h-3" />, label: "Image Input", color: "amber" },
                    ].map((f, i) => (
                      <span key={i} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border ${
                        f.color === "emerald" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" :
                        f.color === "blue" ? "bg-blue-500/10 border-blue-500/20 text-blue-400" :
                        f.color === "purple" ? "bg-purple-500/10 border-purple-500/20 text-purple-400" :
                        "bg-amber-500/10 border-amber-500/20 text-amber-400"
                      }`}>
                        {f.icon} {f.label}
                      </span>
                    ))}
                  </div>
                  
                  {/* Suggestion Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full">
                    {[
                      { text: "Compare Transformer models and SSMs", icon: <img src="/logo.png" alt="Zyro Logo" className="w-4 h-4 object-contain" /> },
                      { text: "Analyze the latest trends in renewable energy", icon: <Sparkles className="w-4 h-4" /> },
                      { text: "Write a guide on setting up a Next.js app", icon: <Code className="w-4 h-4" /> },
                      { text: "Explain quantum computing simply", icon: <BookOpen className="w-4 h-4" /> },
                    ].map((suggestion, i) => (
                      <button
                        key={i}
                        onClick={() => handleSubmit(undefined, suggestion.text)}
                        className="bg-slate-800/30 hover:bg-slate-800/60 border border-slate-700/50 hover:border-emerald-500/30 rounded-xl p-4 text-left transition-all text-sm text-slate-300 group hover:shadow-[0_0_15px_rgba(16,185,129,0.05)] active:scale-[0.98]"
                      >
                        <div className="flex items-start gap-3">
                          <div className="p-2 bg-slate-700/30 rounded-lg text-slate-400 group-hover:text-emerald-400 transition-colors shrink-0">
                            {suggestion.icon}
                          </div>
                          <p className="line-clamp-2 pt-1">{suggestion.text}</p>
                        </div>
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
                  transition={{ duration: 0.2 }}
                  key={idx} 
                  className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {msg.role === "assistant" && (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500/20 to-blue-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0 mt-1 shadow-[0_0_10px_rgba(16,185,129,0.1)]">
                      <img src="/logo.png" alt="Zyro Logo" className="w-5 h-5 object-contain" />
                    </div>
                  )}
                  
                  <div className={`flex flex-col gap-1 max-w-[80%] ${msg.role === "user" ? "items-end" : "items-start"} relative group`}>
                    <div className="flex items-center gap-2 px-1">
                      <span className="text-[10px] text-slate-500 font-mono">
                        {msg.role === "user" ? "You" : "Zyro"}
                      </span>
                      {msg.timestamp && (
                        <span className="text-[9px] text-slate-600 font-mono">
                          {formatTime(msg.timestamp)}
                        </span>
                      )}
                    </div>
                    
                    <div className={`rounded-2xl p-4 shadow-lg relative ${
                      msg.role === "user" 
                        ? "bg-gradient-to-br from-slate-800 to-slate-800/80 text-white border border-slate-700/50 rounded-tr-sm" 
                        : "bg-[#0f1115] text-slate-300 border border-emerald-900/20 rounded-tl-sm prose prose-invert prose-emerald max-w-none w-full"
                    }`}>
                      {msg.role === "assistant" ? (
                        <>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                          {/* Action bar for assistant messages */}
                          <div className="mt-3 pt-3 border-t border-slate-800/50 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => toggleReaction(activeSession.id, idx, "thumbsUp")}
                                className={`p-1.5 rounded-md transition-colors ${msg.reactions?.thumbsUp ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'}`}
                                title="Good response"
                              >
                                <ThumbsUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => toggleReaction(activeSession.id, idx, "thumbsDown")}
                                className={`p-1.5 rounded-md transition-colors ${msg.reactions?.thumbsDown ? 'bg-red-500/20 text-red-400' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'}`}
                                title="Poor response"
                              >
                                <ThumbsDown className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => { navigator.clipboard.writeText(msg.content); addToast("Copied to clipboard", "success"); }}
                                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-white bg-slate-800/50 hover:bg-slate-800 px-2.5 py-1 rounded-md transition-colors"
                              >
                                <Copy className="w-3 h-3" /> Copy
                              </button>
                              <button
                                onClick={() => deleteMessage(activeSession.id, idx)}
                                className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
                                title="Delete message"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        </>
                      ) : (
                        <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                      )}
                    </div>

                    {/* Delete for user messages */}
                    {msg.role === "user" && (
                      <button
                        onClick={() => deleteMessage(activeSession.id, idx)}
                        className="self-end mt-0.5 p-1 text-slate-600 hover:text-red-400 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Delete message"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {msg.role === "user" && (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600/50 flex items-center justify-center shrink-0 mt-1 shadow-sm">
                      <User className="w-4 h-4 text-slate-300" />
                    </div>
                  )}
                </motion.div>
              ))}

              {/* TYPING INDICATORS / ACTIVE STATE */}
              {activeSession.isClarifying && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500/20 to-blue-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0">
                    <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
                  </div>
                  <div className="bg-[#0f1115] text-slate-400 border border-emerald-900/30 rounded-2xl rounded-tl-sm p-4 font-mono text-sm">
                    <div className="flex items-center gap-2">
                      <span>Evaluating task constraints</span>
                      <span className="flex gap-0.5">
                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                      </span>
                    </div>
                  </div>
                </motion.div>
              )}
              
              {activeSession.isExecuting && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-3 justify-start"
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500/20 to-blue-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0 mt-1">
                    <img src="/logo.png" alt="Zyro Logo" className="w-5 h-5 object-contain" />
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

              {/* Scroll to bottom FAB */}
              <AnimatePresence>
                {showScrollBtn && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    onClick={() => endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth" })}
                    className="sticky bottom-4 left-1/2 -translate-x-1/2 w-9 h-9 bg-slate-800/90 hover:bg-slate-700 border border-slate-700/50 rounded-full flex items-center justify-center text-slate-400 hover:text-white shadow-xl backdrop-blur-sm transition-colors z-20"
                  >
                    <ArrowDown className="w-4 h-4" />
                  </motion.button>
                )}
              </AnimatePresence>
            </div>

            {/* INPUT BAR */}
            <div className="p-4 bg-[#0a0a0a]/90 backdrop-blur-xl border-t border-slate-800/50 flex flex-col gap-2 relative">
              
              {/* Attachments Preview */}
              {activeSession.attachments.length > 0 && (
                <div className="flex gap-2 px-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-slate-700">
                  {activeSession.attachments.map((att, i) => (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.9 }} 
                      animate={{ opacity: 1, scale: 1 }} 
                      key={i} 
                      className="relative flex items-center gap-2 bg-slate-800/80 px-3 py-2 rounded-lg border border-slate-700/50 group hover:border-emerald-500/30 transition-colors"
                    >
                      {att.type === "image" ? <ImageIcon className="w-4 h-4 text-emerald-400" /> : <FileText className="w-4 h-4 text-blue-400" />}
                      <span className="text-xs text-slate-300 max-w-[100px] truncate">{att.name}</span>
                      <button 
                        type="button"
                        onClick={() => removeAttachment(i)}
                        className="absolute -top-1.5 -right-1.5 bg-red-500 hover:bg-red-400 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-all shadow-md"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </motion.div>
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
                    title="Attach file"
                  >
                    <Paperclip className="w-5 h-5" />
                  </button>
                  <input 
                    type="file" 
                    multiple 
                    ref={fileInputRef} 
                    className="hidden" 
                    onChange={handleFileUpload}
                    accept="image/*,.txt,.md,.csv,.json,.py,.js,.ts,.html,.css"
                  />

                  <textarea
                    ref={textareaRef}
                    className="w-full bg-transparent border-none text-sm p-3 text-white placeholder-slate-500 focus:ring-0 focus:outline-none resize-none min-h-[44px] max-h-[200px] scrollbar-thin scrollbar-thumb-slate-800"
                    placeholder={activeSession.isExecuting ? "Pipeline is running..." : "Message Zyro... (Ctrl+K for shortcuts)"}
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
                    className="bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 p-2.5 rounded-xl transition-all shadow-[0_0_15px_rgba(16,185,129,0.2)] disabled:shadow-none mb-1 mr-1 flex-shrink-0 active:scale-95"
                  >
                    <Play className="w-5 h-5" />
                  </button>
                </div>
              </form>
              <div className={`flex items-center justify-between text-[10px] text-slate-500 font-mono mt-1 ${activeSession.isExecuting || Object.keys(activeSession.results).length > 0 ? '' : 'max-w-4xl mx-auto w-full'}`}>
                <span>Enter to send, Shift+Enter for new line</span>
                <span className={`transition-colors ${input.length > 500 ? 'text-amber-500' : ''}`}>
                  {input.length > 0 && `${input.length} chars · ${wordCount} words`}
                </span>
              </div>
            </div>
          </div>

          {/* RESIZER HANDLE */}
          {(activeSession.isExecuting || Object.keys(activeSession.results).length > 0) && (
            <div 
              className="w-1.5 cursor-col-resize hover:bg-emerald-500/50 active:bg-emerald-500 z-50 transition-colors flex items-center justify-center bg-slate-900 group"
              onMouseDown={() => {
                isDragging.current = true;
                document.body.style.cursor = "col-resize";
              }}
            >
              <div className="h-12 w-[3px] bg-slate-700/50 rounded-full pointer-events-none group-hover:bg-emerald-500/50 transition-colors"></div>
            </div>
          )}

          {/* RIGHT COLUMN: PIPELINE DASHBOARD */}
          {(activeSession.isExecuting || Object.keys(activeSession.results).length > 0) && (
            <motion.div 
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex flex-col bg-[#0a0a0a] border-l border-slate-800/50 h-full overflow-hidden"
              style={{ width: `calc(${100 - splitWidth}% - 6px)` }}
            >
              <div className="flex-1 overflow-y-auto p-8 space-y-8 scrollbar-thin scrollbar-thumb-slate-800">
                
                {/* Pipeline Stats Bar */}
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2 bg-slate-800/30 rounded-lg px-3 py-2 border border-slate-700/30">
                    <Hash className="w-3.5 h-3.5 text-slate-500" />
                    <span className="text-xs font-mono text-slate-400">{activeSession.steps.length} steps</span>
                  </div>
                  <div className="flex items-center gap-2 bg-emerald-950/30 rounded-lg px-3 py-2 border border-emerald-500/20">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="text-xs font-mono text-emerald-400">
                      {Object.values(activeSession.results).filter(r => r.status === "success" || r.status === "failed").length} completed
                    </span>
                  </div>
                  {Object.values(activeSession.results).some(r => r.status === "running") && (
                    <div className="flex items-center gap-2 bg-blue-950/30 rounded-lg px-3 py-2 border border-blue-500/20">
                      <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
                      <span className="text-xs font-mono text-blue-400">running</span>
                    </div>
                  )}
                  {activeSession.status === "finished" && (
                    <div className="flex items-center gap-2 bg-emerald-950/30 rounded-lg px-3 py-2 border border-emerald-500/20">
                      <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-xs font-mono text-emerald-400">complete</span>
                    </div>
                  )}
                </div>

                {/* DECOMPOSITION GRAPH */}
                <section>
                  <h2 className="text-xs font-mono text-slate-500 mb-4 uppercase tracking-[0.2em] flex items-center gap-2">
                    <Shield className="w-3.5 h-3.5" /> Execution Graph
                  </h2>
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    {activeSession.steps.map((step) => {
                      const res = activeSession.results[step.id];
                      return (
                        <motion.div 
                          key={step.id} 
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={`p-4 rounded-xl border flex flex-col gap-3 transition-all ${
                            res?.status === 'success' ? 'border-emerald-500/30 bg-emerald-950/20' :
                            res?.status === 'running' ? 'border-emerald-500 bg-emerald-950/40 shadow-[0_0_20px_rgba(16,185,129,0.15)]' :
                            res?.status === 'failed' ? 'border-emerald-500/30 bg-emerald-950/20' :
                            'border-slate-800 bg-[#15181e]'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className="pt-1">{getAgentIcon(step.agent, res?.status === 'running')}</div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-bold text-slate-400">[{step.id}] {step.agent}</span>
                                {res?.status === 'success' && <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />}
                                {res?.status === 'running' && <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin" />}
                                {res?.duration_ms > 0 && (
                                  <span className="text-[9px] font-mono text-slate-600 ml-auto">{res.duration_ms}ms</span>
                                )}
                              </div>
                              <p className="text-sm text-slate-300 mt-1 leading-snug">{step.instruction}</p>
                            </div>
                          </div>
                          {res?.output && (
                            <div className="mt-2 p-3 bg-black/40 rounded-lg text-xs text-slate-400 overflow-y-auto max-h-40 scrollbar-thin scrollbar-thumb-slate-700 border border-slate-800/50 prose prose-invert prose-emerald prose-sm max-w-none">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{res.output}</ReactMarkdown>
                            </div>
                          )}
                        </motion.div>
                      )
                    })}
                  </div>
                </section>

                {/* TERMINAL LOGS */}
                <section className="bg-[#050505] border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
                  <div className="bg-[#0a0a0a] px-4 py-2.5 border-b border-slate-800 flex items-center gap-2">
                    <div className="flex gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-red-500/70"></div>
                      <div className="w-3 h-3 rounded-full bg-amber-500/70"></div>
                      <div className="w-3 h-3 rounded-full bg-emerald-500/70"></div>
                    </div>
                    <Terminal className="w-4 h-4 text-slate-500 ml-2" />
                    <span className="text-xs font-mono text-slate-500">system.log</span>
                    <span className="text-[9px] font-mono text-slate-600 ml-auto">{activeSession.logs.length} entries</span>
                  </div>
                  <div className="p-4 h-[220px] overflow-y-auto font-mono text-xs leading-relaxed space-y-1 scrollbar-thin scrollbar-thumb-slate-800">
                    {activeSession.logs.length === 0 && (
                      <div className="text-slate-600 text-center py-8">Waiting for pipeline events...</div>
                    )}
                    {activeSession.logs.map((log, i) => (
                      <motion.div 
                        initial={{ opacity: 0, x: -5 }}
                        animate={{ opacity: 1, x: 0 }}
                        key={i} 
                        className={
                          log.includes("ERROR") || log.includes("FAILED") ? "text-red-400" :
                          log.includes("completed") ? "text-emerald-400" :
                          log.includes("Status") ? "text-blue-400" :
                          "text-slate-400"
                        }
                      >
                        <span className="opacity-40 select-none">❯</span> {log}
                      </motion.div>
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
    <Suspense fallback={
      <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center gap-4">
        <div className="relative">
          <div className="absolute inset-0 bg-emerald-500/20 rounded-full blur-xl animate-pulse"></div>
          <Loader2 className="relative w-10 h-10 text-emerald-500 animate-spin" />
        </div>
        <span className="text-sm font-mono text-slate-500 animate-pulse">Loading Zyro...</span>
      </div>
    }>
      <ChatInterface />
    </Suspense>
  );
}
