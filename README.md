# 🤖 Zyro: Agentic AI System for Multi-Step Tasks

An orchestration system that decomposes complex tasks into discrete steps, routes them to specialized agents, and executes via an async pipeline with streaming output — **built from scratch without black-box agent frameworks**. 

Zyro now features a full-stack architecture with a modern **Next.js** web interface, a real-time Execution Graph visualization, and a **FastAPI** backend supporting conversational task clarification and multimodal attachments.

## ✨ Key Features

- **Next.js Web Interface** — A beautiful, modern chat UI with real-time execution streaming, history management, and a dynamic directed acyclic graph (DAG) visualizer for steps.
- **FastAPI SSE Backend** — Exposes the orchestration pipeline via Server-Sent Events (SSE) for seamless real-time streaming to the client.
- **Task Clarification Engine** — An intelligent `Clarifier` agent analyzes chat history to determine if the user is asking a conversational question or commanding an execution, routing seamlessly.
- **Multimodal Attachments** — Supports image and text file attachments right in the chat interface.
- **LLM-Powered Task Decomposition** — Breaks complex tasks into ordered steps via a single LLM call.
- **Three Specialized Agents** — Retriever (web search + Wikipedia), Analyzer (LLM reasoning), Writer (streaming LLM output).
- **Async Pipeline Execution** — Python `asyncio` with parallel batching for independent steps.
- **3-Layer Failure Handling** — Retry with backoff → graceful fallback → hard abort.
- **Manual Dependency Batching** — Topological sort grouping steps into parallel waves.

## 🏗️ Architecture

```
 Next.js Client (Chat UI, Graph, History)
        │
     (SSE / REST)
        ▼
   FastAPI Backend (api.py)
        │
   [Clarifier] ──(if execution)──► Orchestrator  →  Wave Batching  →  Agents (parallel)
                                        │
                             ┌──────────┼──────────┐
                             ▼          ▼          ▼
                        Retriever   Analyzer    Writer
                       (search)     (think)     (write)
```

The **Orchestrator** owns all state. Agents are **stateless** — they receive full context on every call.
See [docs/architecture.md](docs/architecture.md) for the full backend system design document.

## 📁 Project Structure

```
├── frontend/             # Next.js 14 App Router UI
│   ├── src/app/          # Chat, History, and Landing pages
│   ├── public/           # Static assets and logo
│   └── package.json      # Frontend dependencies
├── orchestrator/
│   ├── core.py           # Orchestrator: decompose, execute, stream, retry
│   ├── batching.py       # Dependency-wave batching (topological sort)
│   └── clarifier.py      # Intent router (Question vs. Execution)
├── agents/
│   ├── base.py           # Abstract base agent class
│   ├── retriever.py      # RetrieverAgent: DuckDuckGo + Wikipedia
│   ├── analyzer.py       # AnalyzerAgent: LLM-powered analysis
│   └── writer.py         # WriterAgent: LLM streaming output
├── models/
│   └── schemas.py        # Pydantic models (API requests, Steps, Agents)
├── api.py                # FastAPI backend endpoints and SSE streaming
├── main.py               # Legacy CLI entry point
├── config.py             # Configuration (env vars, constants)
└── requirements.txt      # Python dependencies
```

## 🚀 Quick Start

### 1. Clone & Set Up Backend

```bash
git clone <repo-url>
cd "AGENTIC AI ASSIGNMENT"

# Install backend dependencies
pip install -r requirements.txt

# Set up API Key
cp .env.example .env
# Edit .env and paste your OpenRouter API key
```

### 2. Set Up Frontend

```bash
cd frontend

# Install frontend dependencies
npm install
```

### 3. Run the Full Stack

You will need two terminal windows.

**Terminal 1 (Backend):**
```bash
# Starts the FastAPI server on http://localhost:8000
python api.py
```

**Terminal 2 (Frontend):**
```bash
cd frontend
# Starts the Next.js dev server on http://localhost:3000
npm run dev
```

Open your browser to `http://localhost:3000` to access the Zyro interface!

## 🧪 Running Tests (Backend)

```bash
# Run all tests
pytest tests/ -v

# Run with asyncio mode
pytest tests/ -v --asyncio-mode=auto
```

## 🔧 Technology Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| **Frontend UI** | Next.js 14, React, Tailwind CSS | Modern, responsive component architecture |
| **Animations** | Framer Motion | Fluid micro-interactions and transitions |
| **Backend API** | FastAPI, SSE Starlette | Async endpoint serving and real-time streams |
| **Runtime** | Python 3.11+ asyncio | Native concurrency for I/O-heavy pipeline |
| **HTTP** | httpx | Async HTTP with streaming, no SDK wrapper |
| **Validation** | Pydantic v2 | Typed contracts between agents |
| **LLM Backend** | OpenRouter API | Multi-model gateway, free tier |
| **Web Search** | duckduckgo-search | Free, no API key |

### What We Don't Use

**No LangChain, AutoGen, CrewAI, or any black-box agent framework.** All orchestration, decomposition, routing, batching, and failure handling logic is written from scratch to demonstrate understanding of what happens under the hood.

## 📄 Documentation

- [System Architecture](docs/architecture.md) — Full design document with diagrams
- [Sequence Diagrams](docs/sequence_diagram.md) — Mermaid diagrams for all flows
- [Post-Mortem](docs/post_mortem.md) — Scaling issues, design changes, trade-offs

## 📝 License

MIT
