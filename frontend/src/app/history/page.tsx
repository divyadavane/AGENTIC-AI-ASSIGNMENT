"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Brain, ArrowLeft, Clock, CheckCircle, XCircle, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type HistoryEntry = {
  id: string;
  timestamp: string;
  task: string;
  status: string;
  duration_ms: number;
  output: string;
};

export default function HistoryPage() {
  const router = useRouter();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetch("http://localhost:8000/api/history")
      .then(res => res.json())
      .then(data => {
        setHistory(data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      const res = await fetch(`http://localhost:8000/api/history/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setHistory(prev => prev.filter(item => item.id !== id));
      }
    } catch (err) {
      console.error("Failed to delete history item:", err);
    }
  };

  const formatDuration = (ms: number) => {
    return (ms / 1000).toFixed(1) + "s";
  };

  return (
    <div className="min-h-screen bg-[#050505] text-slate-300 font-sans selection:bg-emerald-500/30 flex flex-col">
      {/* Background Ambient Glows */}
      <div className="absolute top-0 right-[-10%] w-[40%] h-[40%] rounded-full bg-blue-900/10 blur-[120px] pointer-events-none"></div>
      
      {/* HEADER */}
      <header className="flex-shrink-0 flex items-center gap-4 p-6 border-b border-slate-800/50 bg-[#0a0a0a]/80 backdrop-blur-md z-10 sticky top-0">
        <button onClick={() => router.push("/")} className="p-2 hover:bg-slate-800 rounded-full transition-colors">
          <ArrowLeft className="w-5 h-5 text-slate-400" />
        </button>
        <div className="bg-gradient-to-br from-emerald-500/20 to-blue-500/20 p-2 rounded-xl border border-emerald-500/30">
          <Clock className="w-6 h-6 text-emerald-400" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white tracking-tight">Execution History</h1>
          <p className="text-xs text-slate-500 font-mono mt-0.5">
            Past pipeline runs and synthesized outputs
          </p>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <div className="flex-1 overflow-y-auto p-6 md:p-12 relative z-10">
        <div className="max-w-4xl mx-auto space-y-6">
          {loading ? (
            <div className="text-center text-slate-500 font-mono animate-pulse mt-20">Loading history...</div>
          ) : history.length === 0 ? (
            <div className="text-center text-slate-500 mt-20 p-12 border border-slate-800 rounded-2xl bg-[#0a0a0a]/50">
              <img src="/logo.png" alt="Zyro Logo" className="w-16 h-16 mx-auto mb-4 object-contain opacity-80" />
              <p className="text-lg">No pipeline executions yet.</p>
              <button 
                onClick={() => router.push("/")}
                className="mt-6 text-emerald-400 hover:text-emerald-300 underline underline-offset-4"
              >
                Start a new task
              </button>
            </div>
          ) : (
            history.map((entry) => (
              <div 
                key={entry.id} 
                className="bg-[#0f1115] border border-slate-800 rounded-2xl overflow-hidden shadow-xl transition-all hover:border-slate-700"
              >
                <div 
                  className="p-6 cursor-pointer flex items-start gap-4"
                  onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                >
                  <div className="mt-1">
                    <CheckCircle className="w-6 h-6 text-emerald-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-4 mb-2">
                      <span className="font-mono text-xs text-slate-500">{entry.timestamp}</span>
                      <span className="font-mono text-xs text-slate-500">{formatDuration(entry.duration_ms)}</span>
                    </div>
                    <h3 className="text-lg text-white font-medium truncate">{entry.task}</h3>
                  </div>
                  <div className="mt-1 text-slate-500 flex items-center gap-2">
                    <button 
                      onClick={(e) => handleDelete(e, entry.id)}
                      className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded-md transition-colors"
                      title="Delete History"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    {expandedId === entry.id ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  </div>
                </div>

                {expandedId === entry.id && (
                  <div className="px-6 pb-6 pt-2 border-t border-slate-800/50 bg-[#0a0a0a]">
                    <div className="prose prose-invert prose-emerald max-w-none prose-sm mt-4">
                      {entry.output ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.output}</ReactMarkdown>
                      ) : (
                        <p className="text-slate-500 italic">No output generated.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
