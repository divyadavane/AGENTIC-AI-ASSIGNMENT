"""
Retriever Agent — fetches external information for the pipeline.

Data sources:
  1. DuckDuckGo web search (via duckduckgo-search library)
  2. Wikipedia API (structured knowledge fallback)

No LLM calls here — this agent does pure data retrieval.
If one source fails, it falls back to the other.
If both fail, it returns a graceful "no data" result.
"""

from __future__ import annotations

import asyncio
import time

from agents.base import BaseAgent
from models.schemas import AgentResult, Step, StepStatus
import config


class RetrieverAgent(BaseAgent):
    """
    Fetches external information via web search and Wikipedia.

    Stateless: receives instruction, returns retrieved data.
    No shared state, no caching — safe for parallel execution.
    """

    name = "retriever"

    async def run(self, step: Step, context: dict[str, AgentResult]) -> AgentResult:
        """
        Execute a retrieval step.

        Strategy:
          1. Try DuckDuckGo text search for the instruction query
          2. Try Wikipedia as a supplementary/fallback source
          3. Combine results; if both fail, return empty output with error info
        """
        start_time = time.time()
        query = step.instruction
        results: list[str] = []
        errors: list[str] = []

        # ─── Source 1: DuckDuckGo Web Search ──────────────────────────
        ddg_result = await self._search_duckduckgo(query)
        if ddg_result:
            results.append("=== Web Search Results ===\n" + ddg_result)
        else:
            errors.append("DuckDuckGo search returned no results or failed")

        # ─── Source 2: Wikipedia ──────────────────────────────────────
        wiki_result = await self._search_wikipedia(query)
        if wiki_result:
            results.append("=== Wikipedia Results ===\n" + wiki_result)
        else:
            errors.append("Wikipedia search returned no results or failed")

        # ─── Build result ─────────────────────────────────────────────
        if results:
            output = "\n\n".join(results)
            return self._make_result(step, StepStatus.SUCCESS, output=output, start_time=start_time)
        else:
            # Both sources failed — return graceful degradation
            error_msg = "; ".join(errors)
            return self._make_result(
                step,
                StepStatus.FAILED,
                output="No data could be retrieved. Downstream agents will work with limited context.",
                error=error_msg,
                start_time=start_time,
            )

    async def _search_duckduckgo(self, query: str) -> str | None:
        """
        Perform a DuckDuckGo text search and return top results as formatted text.

        Runs in a thread executor because duckduckgo-search is synchronous.
        """
        try:
            result = await asyncio.wait_for(
                asyncio.get_event_loop().run_in_executor(
                    None, self._ddg_sync_search, query
                ),
                timeout=config.RETRIEVER_TIMEOUT,
            )
            return result
        except asyncio.TimeoutError:
            return None
        except Exception:
            return None

    def _ddg_sync_search(self, query: str) -> str | None:
        """Synchronous DuckDuckGo search wrapper."""
        try:
            from duckduckgo_search import DDGS

            ddgs = DDGS()
            results = list(ddgs.text(query, max_results=config.SEARCH_MAX_RESULTS))

            if not results:
                return None

            formatted: list[str] = []
            for i, r in enumerate(results, 1):
                title = r.get("title", "No title")
                body = r.get("body", "No snippet")
                href = r.get("href", "")
                formatted.append(f"{i}. [{title}]({href})\n   {body}")

            return "\n\n".join(formatted)
        except ImportError:
            return None
        except Exception:
            return None

    async def _search_wikipedia(self, query: str) -> str | None:
        """
        Search Wikipedia and return a summary of the top matching article.

        Runs in a thread executor because the wikipedia library is synchronous.
        """
        try:
            result = await asyncio.wait_for(
                asyncio.get_event_loop().run_in_executor(
                    None, self._wiki_sync_search, query
                ),
                timeout=config.RETRIEVER_TIMEOUT,
            )
            return result
        except asyncio.TimeoutError:
            return None
        except Exception:
            return None

    def _wiki_sync_search(self, query: str) -> str | None:
        """Synchronous Wikipedia search wrapper."""
        try:
            import wikipedia

            wikipedia.set_user_agent("AgenticAIAssignmentBot/1.0 (mailto:test@example.com)")

            # Search for matching articles
            search_results = wikipedia.search(query, results=3)
            if not search_results:
                return None

            # Get the summary of the top result
            try:
                page = wikipedia.page(search_results[0], auto_suggest=False)
                # Return first 2000 chars of summary to keep context manageable
                summary = page.summary[:2000]
                return f"**{page.title}**\n\n{summary}"
            except (wikipedia.DisambiguationError, wikipedia.PageError):
                # Try the second result if first fails
                if len(search_results) > 1:
                    try:
                        page = wikipedia.page(search_results[1], auto_suggest=False)
                        summary = page.summary[:2000]
                        return f"**{page.title}**\n\n{summary}"
                    except Exception:
                        return None
                return None
        except ImportError:
            return None
        except Exception:
            return None
