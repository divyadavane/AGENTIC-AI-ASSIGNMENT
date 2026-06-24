# 🤖 Agentic AI System for Multi-Step Tasks

An orchestration system that decomposes complex tasks into discrete steps, routes them to specialized agents, and executes via an async pipeline with streaming output — **built from scratch without black-box agent frameworks**.

## ✨ Key Features

- **LLM-Powered Task Decomposition** — Breaks complex tasks into ordered steps via a single LLM call
- **Three Specialized Agents** — Retriever (web search + Wikipedia), Analyzer (LLM reasoning), Writer (streaming LLM output)
- **Async Pipeline Execution** — Python `asyncio` with parallel batching for independent steps
- **Real-Time Streaming** — Partial results streamed to terminal as each step completes
- **3-Layer Failure Handling** — Retry with backoff → graceful fallback → hard abort
- **Manual Dependency Batching** — Topological sort grouping steps into parallel waves
- **Structured Logging** — JSON-lines log files for observability
- **Rich Terminal UI** — Color-coded status, progress tracking, final summary table

## 🏗️ Architecture

```
User Input  →  Orchestrator  →  Wave Batching  →  Agents (parallel)  →  Streamed Output
                    │
         ┌──────────┼──────────┐
         ▼          ▼          ▼
    Retriever   Analyzer    Writer
   (web search) (LLM think) (LLM write)
```

The **Orchestrator** owns all state. Agents are **stateless** — they receive full context on every call.
See [docs/architecture.md](docs/architecture.md) for the full system design document.

## 📁 Project Structure

```
├── orchestrator/
│   ├── core.py           # Orchestrator: decompose, execute, stream, retry
│   └── batching.py       # Manual dependency-wave batching (topological sort)
├── agents/
│   ├── base.py           # Abstract base agent class
│   ├── retriever.py      # RetrieverAgent: DuckDuckGo + Wikipedia
│   ├── analyzer.py       # AnalyzerAgent: LLM-powered analysis
│   └── writer.py         # WriterAgent: LLM streaming output
├── models/
│   └── schemas.py        # Pydantic v2 models: Step, AgentResult, ErrorLog
├── llm/
│   └── client.py         # Direct httpx client to OpenRouter API (no SDK)
├── tests/
│   ├── test_decomposition.py  # Decomposition unit tests
│   ├── test_agents.py         # Agent unit tests
│   ├── test_pipeline.py       # Pipeline integration tests
│   └── test_failure.py        # Failure handling tests
├── docs/
│   ├── architecture.md        # System design document
│   ├── post_mortem.md         # Post-mortem reflection
│   └── sequence_diagram.md   # Mermaid sequence diagrams
├── logs/                      # Runtime JSON-lines logs (gitignored)
├── main.py                    # CLI entry point with Rich UI
├── config.py                  # Configuration (env vars, constants)
├── requirements.txt           # Dependencies
└── .env.example               # Example environment variables
```

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone <repo-url>
cd "AGENTIC AI ASSIGNMENT"
pip install -r requirements.txt
```

### 2. Set Up API Key

Get a free API key from [OpenRouter](https://openrouter.ai):

```bash
cp .env.example .env
# Edit .env and paste your OpenRouter API key
```

### 3. Run

```bash
# Interactive mode — enter your task at the prompt
python main.py

# Direct mode — pass task as argument
python main.py --task "Research electric vehicles and write a 3-paragraph summary"

# Failure demo — shows retry, fallback, and graceful degradation
python main.py --failure-demo
```

## 📋 Example Input/Output

**Input:**
```
Research electric vehicles and write a 3-paragraph summary
```

**Output (streamed):**
```
🤖 Agentic AI System for Multi-Step Tasks

🧠 Decomposing task: Research electric vehicles and write a 3-paragraph summary

📋 Task Decomposition
┌──────────┬────────────┬──────────────────────────────────┬────────────┐
│ Step     │ Agent      │ Instruction                      │ Depends On │
├──────────┼────────────┼──────────────────────────────────┼────────────┤
│ step_1   │ retriever  │ Search for EV market data...     │ —          │
│ step_2   │ retriever  │ Search for EV technology...      │ —          │
│ step_3   │ analyzer   │ Analyze key trends and...        │ step_1, 2  │
│ step_4   │ writer     │ Write a 3-paragraph summary...   │ step_3     │
└──────────┴────────────┴──────────────────────────────────┴────────────┘

⚡ Execution Wave Plan
  Wave 0: [step_1, step_2] (retriever, retriever) — parallel
  Wave 1: [step_3] (analyzer) — sequential
  Wave 2: [step_4] (writer) — sequential

🚀 Executing pipeline...
  ✅ SUCCESS │ Step: step_1 │ Agent: retriever │ Time: 2340ms
  ✅ SUCCESS │ Step: step_2 │ Agent: retriever │ Time: 1890ms
  ✅ SUCCESS │ Step: step_3 │ Agent: analyzer  │ Time: 3200ms
  ✅ SUCCESS │ Step: step_4 │ Agent: writer    │ Time: 4100ms

📊 Execution Summary
  Total: 4 steps │ ✅ 4 succeeded │ ❌ 0 failed │ ⏱ 11530ms total

📝 Final Output
  [Generated 3-paragraph summary about electric vehicles...]
```

## 🧪 Running Tests

```bash
# Run all tests
pytest tests/ -v

# Run specific test modules
pytest tests/test_decomposition.py -v
pytest tests/test_failure.py -v

# Run with asyncio mode
pytest tests/ -v --asyncio-mode=auto
```

## ⚠️ Failure Handling Demo

Run with `--failure-demo` to see all three layers of failure handling:

```bash
python main.py --failure-demo --task "Research AI trends"
```

This simulates a `TimeoutError` in the Retriever agent on its first call:
1. **Retry**: The system retries after 2s with exponential backoff
2. **Graceful Degradation**: If retry fails, the pipeline continues with empty data
3. **Error Streaming**: Real-time error messages are shown to the user

## 🔧 Technology Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Runtime | Python 3.11+ asyncio | Native concurrency for I/O-heavy pipeline |
| HTTP | httpx | Async HTTP with streaming, no SDK wrapper |
| Validation | Pydantic v2 | Typed contracts between agents |
| Terminal UI | Rich | Live streaming panels, color-coded output |
| LLM Backend | OpenRouter API | Multi-model gateway, free tier |
| Web Search | duckduckgo-search | Free, no API key |
| Knowledge | wikipedia | Free, structured summaries |
| Testing | pytest + pytest-asyncio | Async test support |

### What We Don't Use

**No LangChain, AutoGen, CrewAI, or any black-box agent framework.** All orchestration, decomposition, routing, batching, and failure handling logic is written from scratch to demonstrate understanding of what happens under the hood.

## 📄 Documentation

- [System Architecture](docs/architecture.md) — Full design document with diagrams
- [Sequence Diagrams](docs/sequence_diagram.md) — Mermaid diagrams for all flows
- [Post-Mortem](docs/post_mortem.md) — Scaling issues, design changes, trade-offs

## 📝 License

MIT
