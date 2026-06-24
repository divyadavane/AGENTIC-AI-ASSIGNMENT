# System Design Document

## Architecture Overview

The Agentic AI System uses a **Linear Async Pipeline** architecture with a central Orchestrator that owns decomposition logic, dispatches to agents, streams results, and handles failures.

### High-Level Data Flow

```
User Input  →  Orchestrator  →  Task Queue (Waves)  →  Agents (parallel/sequential)  →  Streamed Output
```

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER INPUT                              │
│              "Research X and write a summary"                   │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                      ORCHESTRATOR                               │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ decompose()  │→ │ compute_     │→ │ execute_pipeline()    │  │
│  │ LLM call to  │  │ waves()      │  │ async generator that  │  │
│  │ break task   │  │ topological  │  │ dispatches + streams  │  │
│  │ into steps   │  │ sort into    │  │ results per-step      │  │
│  │              │  │ dep waves    │  │                       │  │
│  └──────────────┘  └──────────────┘  └────────┬──────────────┘  │
│                                                │                 │
│  State: context dict (step_id → AgentResult)   │                 │
│  Logging: JSON-lines to logs/ directory        │                 │
└────────────────────────────────────────────────┼─────────────────┘
                                                 │
                    ┌────────────────────────────┼────────────────┐
                    │                            │                │
                    ▼                            ▼                ▼
          ┌──────────────┐            ┌──────────────┐  ┌──────────────┐
          │   RETRIEVER  │            │   ANALYZER   │  │    WRITER    │
          │    Agent     │            │    Agent     │  │    Agent     │
          │              │            │              │  │              │
          │ • DuckDuckGo │            │ • LLM call   │  │ • LLM call   │
          │ • Wikipedia  │            │ • Low temp   │  │ • Streaming  │
          │ • No LLM     │            │ • Structured │  │ • High temp  │
          │ • 15s timeout│            │   analysis   │  │ • Formatted  │
          └──────────────┘            └──────────────┘  └──────────────┘
                    │                            │                │
                    └────────────────────────────┴────────────────┘
                                                 │
                                                 ▼
          ┌───────────────────────────────────────────────────────┐
          │              STREAMED OUTPUT TO USER                  │
          │  • Rich terminal UI with color-coded status          │
          │  • Real-time step progress: ✅ ⚠️ ❌                  │
          │  • Final summary table                               │
          │  • Structured JSON-lines log file                    │
          └───────────────────────────────────────────────────────┘
```

## Component Details

### Orchestrator (`orchestrator/core.py`)

The brain of the system. Responsibilities:

1. **Task Decomposition**: Calls LLM with a system prompt that returns a JSON array of steps. Each step has: `id`, `agent`, `instruction`, `depends_on`. Validated with Pydantic.

2. **Wave Batching**: Groups steps into dependency waves using topological sort. Steps in the same wave run in parallel via `asyncio.gather()`.

3. **Pipeline Execution**: Async generator that dispatches steps to agents, yields results as they complete, and maintains the context dict.

4. **Failure Handling**: Three layers of resilience (see below).

### Agents

All agents are **stateless**. They receive their full input context on every call — no shared mutable state.

| Agent | Purpose | Data Sources | LLM Usage |
|-------|---------|-------------|-----------|
| **Retriever** | Fetches external information | DuckDuckGo, Wikipedia | None |
| **Analyzer** | Processes data with reasoning | Upstream agent outputs | Non-streaming, low temp |
| **Writer** | Produces final formatted output | Upstream agent outputs | Streaming, higher temp |

### LLM Client (`llm/client.py`)

Direct HTTP client to OpenRouter API via `httpx`. No SDK wrapper.

- **`call()`**: Non-streaming completion for decomposition and analysis
- **`call_stream()`**: SSE-based streaming for writer output — tokens yielded as async generator
- Handles: auth, timeout, HTTP errors, malformed responses

## Design Decisions

### Why Async?
- Pipeline steps involve I/O-heavy operations (HTTP calls to LLMs, web searches)
- `asyncio` enables concurrent execution of independent steps within a wave
- Streaming requires async generators to yield tokens as they arrive

### Why Stateless Agents?
- Stateless agents can be safely run in parallel via `asyncio.gather()`
- Testing is trivial — mock the context dict, no hidden state to worry about
- Debugging is easier — full context visible in the orchestrator's pipeline object

### How Batching Works
The dependency graph is traversed via iterative topological sort:
1. Find all steps with no unresolved dependencies → Wave 0
2. Mark those as resolved
3. Repeat to find Wave 1, Wave 2, etc.
4. Steps within a wave run in parallel; waves execute sequentially

This is hand-written — no `networkx` or graph libraries.

## Failure Handling

### Three-Layer Resilience Model

```
Layer 1: RETRY
  └── On LLM/network error: retry once after 2s with exponential backoff
      └── If retry succeeds: continue normally

Layer 2: GRACEFUL DEGRADATION
  └── If step fails after retry: mark as FAILED
      └── Downstream steps that don't depend on it: continue
      └── Downstream steps that depend on it: receive empty context, work with what they have

Layer 3: HARD ABORT
  └── If decomposition itself fails: abort entire pipeline
      └── Clean error message, no partial execution
```

### Error Streaming
Failures are streamed to the user in real-time:
```
⚠ Step step_2 (analyzer) failed — retrying...
❌ Step step_2 (analyzer) failed — pipeline continuing with available data...
```

### Structured Logging
Every step execution is logged to `logs/run_TIMESTAMP.jsonl`:
```json
{"timestamp": "2024-01-15T10:30:00Z", "step_id": "step_1", "agent": "retriever", "status": "success", "duration_ms": 1250.5}
```

## Technology Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| Runtime | Python 3.11+ asyncio | Native concurrency, async generators for streaming |
| HTTP Client | httpx | Async HTTP with streaming support, no SDK black-box |
| Validation | Pydantic v2 | Type-safe schemas between components |
| Terminal UI | Rich | Live-updating panels, color-coded output |
| LLM Backend | OpenRouter API | Multi-model gateway, free tier available |
| Testing | pytest + pytest-asyncio | Async test support |
| Web Search | duckduckgo-search | Free, no API key needed |
| Knowledge | wikipedia | Free, structured summaries |

### What We Don't Use (and Why)
- **LangChain / AutoGen / CrewAI**: These are black-box frameworks that hide agent orchestration logic. This project explicitly demonstrates that we understand what happens under the hood.
- **networkx**: Graph library for topological sort. We wrote the batching logic manually in ~60 lines.
- **Any LLM SDK**: We call the OpenRouter REST API directly via httpx to maintain full visibility.
