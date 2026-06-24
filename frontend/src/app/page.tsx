"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Brain, ArrowRight, Sparkles } from "lucide-react";
import { motion } from "framer-motion";

export default function Home() {
  const [task, setTask] = useState("");
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (task.trim()) {
      router.push(`/chat?q=${encodeURIComponent(task)}`);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-slate-300 font-sans flex flex-col items-center justify-center p-6 relative overflow-hidden selection:bg-emerald-500/30">
      {/* Background Ambient Glows */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-900/20 blur-[150px] pointer-events-none"></div>
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-blue-900/20 blur-[150px] pointer-events-none"></div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="max-w-3xl w-full flex flex-col items-center relative z-10 text-center"
      >
        <div className="bg-gradient-to-br from-emerald-500/20 to-blue-500/20 p-4 rounded-3xl border border-emerald-500/30 shadow-[0_0_40px_rgba(16,185,129,0.2)] mb-8 relative group">
          <div className="absolute inset-0 bg-emerald-500/20 rounded-3xl blur-xl group-hover:bg-emerald-400/30 transition-all duration-700"></div>
          <Brain className="w-12 h-12 text-emerald-400 relative z-10" />
        </div>

        <h1 className="text-5xl md:text-7xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white via-emerald-100 to-emerald-400 tracking-tight mb-6">
          Zyro
        </h1>
        
        <p className="text-lg md:text-xl text-slate-400 font-light mb-12 max-w-2xl leading-relaxed">
          Unleash the power of autonomous agents. Decompose, retrieve, analyze, and synthesize complex tasks in seconds.
        </p>

        <form onSubmit={handleSubmit} className="w-full relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500/40 via-blue-500/40 to-purple-500/40 rounded-[2rem] blur-xl opacity-50 group-hover:opacity-100 transition duration-1000"></div>
          <div className="relative bg-[#0a0a0a] border border-slate-800/80 p-3 rounded-[2rem] flex shadow-2xl items-center focus-within:border-emerald-500/60 transition-all backdrop-blur-xl">
            <Sparkles className="w-6 h-6 ml-4 text-emerald-500" />
            <input
              type="text"
              className="w-full bg-transparent border-none text-xl p-5 text-white placeholder-slate-600 focus:ring-0 focus:outline-none font-light tracking-wide"
              placeholder="What do you want to research today?"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              autoFocus
            />
            <button
              type="submit"
              disabled={!task.trim()}
              className="bg-gradient-to-r from-emerald-500 to-emerald-400 hover:from-emerald-400 hover:to-emerald-300 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-500 text-slate-950 font-bold p-5 rounded-2xl transition-all flex items-center justify-center min-w-[80px] shadow-[0_0_20px_rgba(16,185,129,0.3)] disabled:shadow-none transform hover:scale-105 active:scale-95"
            >
              <ArrowRight className="w-7 h-7" />
            </button>
          </div>
        </form>

        <div className="mt-12 flex gap-4 text-sm font-mono text-slate-500 items-center">
          <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-500"></span> Groq Llama-3</span>
          <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-500"></span> Multi-Agent</span>
          <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-purple-500"></span> Async Streams</span>
        </div>

        <button 
          onClick={() => router.push("/history")}
          className="mt-8 text-sm text-slate-400 hover:text-emerald-400 transition-colors underline underline-offset-4 font-mono"
        >
          View Execution History
        </button>
      </motion.div>
    </div>
  );
}
