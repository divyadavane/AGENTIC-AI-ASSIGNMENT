# 🤖 Zyro: Agentic AI System for Multi-Step Tasks

An orchestration system that decomposes complex tasks into discrete steps, routes them to specialized agents, and executes via an async pipeline with streaming output — **built entirely from scratch without relying on black-box agent frameworks** (like LangChain or CrewAI). 

Zyro features a full-stack architecture with a modern **Next.js** web interface, a real-time Execution Graph visualization, and a **FastAPI** backend supporting conversational task clarification and multimodal attachments.

---

## 🎯 Assignment Objectives Met

This project was built to strictly satisfy the assignment requirements:

- **Complex Task Input**: Accepts multi-part tasks via a modern Chat UI, including support for multimodal (text + image) attachments.
- **Task Decomposition**: Uses a single LLM call to break down complex tasks into a structured JSON array of ordered steps with defined dependencies.
- **Specialized Agents**: Features distinct agents:
  - `RetrieverAgent`: Performs web searches and Wikipedia lookups.
  - `AnalyzerAgent`: Uses LLM reasoning to synthesize retrieved data.
  - `WriterAgent`: Formats and streams the final output.
  - `ClarifierAgent` (Bonus): Intelligent intent routing (Question vs. Execution).
- **Async Pipeline Architecture**: Uses Python `asyncio` for concurrent execution of I/O-bound agent tasks.
- **Streaming Output**: Streams partial step completions and token-by-token LLM output to the frontend via Server-Sent Events (SSE).
- **Graceful Failure Handling**: Implements a robust 3-layer failure strategy (Retry with exponential backoff → Graceful degradation/fallback → Hard abort).
- **Manual Batching Logic**: Uses a custom topological sort algorithm to group dependencies into sequential "waves" of parallel execution, entirely written from scratch.
- **Constraint (No Black-Box Frameworks)**: All orchestration, routing, batching, streaming, and state management logic is custom-built to demonstrate deep understanding of agentic systems under the hood.

---

## 🏗️ Full-Stack Architecture

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
See [docs/architecture.md](docs/architecture.md) for the full system design document.

---

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
├── docs/                 # Documentation (Architecture, Post-mortem)
├── api.py                # FastAPI backend endpoints and SSE streaming
├── main.py               # Legacy CLI entry point
├── config.py             # Configuration (env vars, constants)
└── requirements.txt      # Python dependencies
```

---

## 🚀 Quick Start

### 1. Clone & Set Up Backend

```bash
git clone <repo-url>
cd "AGENTIC AI ASSIGNMENT"

# Install backend dependencies
pip install -r requirements.txt

# Set up API Key (Requires OpenRouter)
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

---

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

---

## 📄 Deliverables & Documentation

- [System Architecture](docs/architecture.md) — System design document covering architecture and data flow.
- [Post-Mortem](docs/post_mortem.md) — Reflection on scaling issues, design changes, and explicit trade-offs.
- [Sequence Diagrams](docs/sequence_diagram.md) — Mermaid diagrams for all flows.

**Video Demonstration:**
*(Please insert link to the 3-5 minute explanation video demonstrating the system running and showing a failure case here)*

## 📝 License

MIT
