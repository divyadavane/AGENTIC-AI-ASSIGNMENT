# Post-Mortem

## Scaling Issue

### Problem: Linear Latency Growth with Sequential Waves

When the task decomposes into 20+ steps, running them in sequential dependency waves causes latency to grow linearly. Each wave must wait for the previous wave to fully complete before starting, even if some downstream steps could begin as soon as their specific dependencies finish (not all steps in the prior wave).

**Current behavior**: If Wave 2 has 5 steps and step `s6` in Wave 3 only depends on `s3` (from Wave 2), it still waits for all 5 steps in Wave 2 to finish — including steps it doesn't depend on.

**Impact**: For a 20-step decomposition with 5 waves averaging 4 steps each, the pipeline takes ~5× the average single-step latency, even though the critical path might only be 3 steps long.

**Mitigation at scale**: A full dependency-graph scheduler using topological sort with a bounded worker pool would allow step `s6` to begin immediately after `s3` completes, regardless of other Wave 2 steps. This would reduce end-to-end latency to the length of the critical path, not the sum of all waves. However, this adds significant complexity (work-stealing, dynamic scheduling, resource contention) that exceeds the current project scope.

---

## Design Change in Hindsight

### Would Have Defined AgentResult Schema Before Writing Any Agents

I would define the `AgentResult` Pydantic model — and finalize its exact fields — before writing a single agent implementation. During development, I initially passed plain strings between agents and only formalized the schema partway through. This caused subtle issues:

- The Analyzer expected a `source_urls` field that the Retriever didn't produce
- Duration tracking was added retroactively, requiring edits to all agents
- Error vs. empty-output disambiguation was unclear without a typed `status` field

**Lesson**: In a multi-agent system, the **contract between agents is the architecture**. Define it first, enforce it with Pydantic validation, and let agents be implementations of that contract. This is essentially interface-driven development applied to LLM pipelines.

---

## Two Explicit Trade-offs

| Trade-off | Chosen Approach | What We Sacrifice |
|-----------|----------------|-------------------|
| **Sequential Waves vs. Graph Scheduler** | Wave-based batching — group steps by dependency level, run each wave with `asyncio.gather()` | Latency: a graph scheduler would start downstream steps as soon as their specific dependencies finish, not when the entire wave completes. For large decompositions (20+ steps), this could cut latency by 30-50%. |
| **Direct httpx Calls vs. Official SDK** | Direct HTTP via `httpx` — full visibility into request/response, SSE parsing, error codes | Developer convenience: the official OpenAI/Anthropic SDKs provide built-in retry, streaming helpers, and typed response objects. Our httpx approach requires manual SSE parsing (~30 lines) and explicit error handling. The trade-off is worth it for an assignment that values understanding over convenience. |
