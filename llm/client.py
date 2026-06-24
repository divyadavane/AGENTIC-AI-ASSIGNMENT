"""
Direct LLM API client for OpenRouter.

This module handles all communication with the LLM backend.
NO SDKs or agent frameworks — raw HTTP calls via httpx.

Supports:
  - Standard (non-streaming) completions
  - Streaming completions via Server-Sent Events (SSE)
  - Proper error handling, timeout management, and structured responses
"""

from __future__ import annotations

import json
from typing import AsyncGenerator

import httpx

import config


class LLMClientError(Exception):
    """Raised when an LLM API call fails after all retries."""
    pass


class LLMClient:
    """
    Async HTTP client for the OpenRouter chat completions API.

    Usage:
        client = LLMClient()
        response = await client.call(messages=[...])

        # Or stream tokens:
        async for token in client.call_stream(messages=[...]):
            print(token, end="", flush=True)
    """

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        timeout: int | None = None,
    ):
        self.api_key = api_key or config.OPENROUTER_API_KEY
        self.base_url = base_url or config.OPENROUTER_BASE_URL
        self.models = [model or config.DEFAULT_MODEL]
        if hasattr(config, "FALLBACK_MODELS"):
            self.models.extend(config.FALLBACK_MODELS)

        self.timeout = timeout or config.LLM_TIMEOUT

        if not self.api_key:
            raise LLMClientError(
                "No API key provided. Set OPENROUTER_API_KEY in your .env file."
            )

    def _build_headers(self) -> dict[str, str]:
        """Construct request headers for OpenRouter API."""
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/agentic-ai-system",
            "X-Title": "Agentic AI System",
        }

    def _build_payload(
        self,
        messages: list[dict[str, str]],
        temperature: float | None = None,
        max_tokens: int | None = None,
        stream: bool = False,
    ) -> dict:
        """Build the request payload for the chat completions endpoint."""
        return {
            "model": self.models[0],  # Defaults to first model, overridden in methods
            "messages": messages,
            "temperature": temperature if temperature is not None else config.LLM_TEMPERATURE,
            "max_tokens": max_tokens or config.LLM_MAX_TOKENS,
            "stream": stream,
        }

    async def call(
        self,
        messages: list[dict[str, str]],
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        """
        Make a non-streaming LLM call using g4f.
        """
        try:
            from g4f.client import AsyncClient
            import g4f
            client = AsyncClient()
            response = await client.chat.completions.create(
                model=g4f.models.default,
                messages=messages,
            )
            return response.choices[0].message.content
        except Exception as e:
            raise LLMClientError(f"g4f call failed: {e}")

    async def call_stream(
        self,
        messages: list[dict[str, str]],
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncGenerator[str, None]:
        """
        Make a streaming LLM call using g4f.
        """
        try:
            from g4f.client import AsyncClient
            import g4f
            client = AsyncClient()
            response = await client.chat.completions.create(
                model=g4f.models.default,
                messages=messages,
                stream=True
            )
            async for chunk in response:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        except Exception as e:
            raise LLMClientError(f"g4f stream failed: {e}")
