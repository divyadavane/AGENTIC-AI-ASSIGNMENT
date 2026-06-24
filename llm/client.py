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
        self.model = model or config.DEFAULT_MODEL
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
            "model": self.model,
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
        Make a non-streaming LLM call.

        Args:
            messages: Chat messages in OpenAI format [{role, content}, ...]
            temperature: Sampling temperature (0.0 - 1.0)
            max_tokens: Maximum tokens in the response

        Returns:
            The assistant's response text.

        Raises:
            LLMClientError: On HTTP errors, timeouts, or malformed responses.
        """
        url = f"{self.base_url}/chat/completions"
        payload = self._build_payload(messages, temperature, max_tokens, stream=False)

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                response = await client.post(
                    url,
                    headers=self._build_headers(),
                    json=payload,
                )
                response.raise_for_status()
            except httpx.TimeoutException as e:
                raise LLMClientError(f"LLM request timed out after {self.timeout}s: {e}")
            except httpx.HTTPStatusError as e:
                raise LLMClientError(
                    f"LLM API returned {e.response.status_code}: {e.response.text}"
                )
            except httpx.RequestError as e:
                raise LLMClientError(f"LLM request failed: {e}")

            data = response.json()

            # Extract the assistant's message content
            try:
                return data["choices"][0]["message"]["content"]
            except (KeyError, IndexError) as e:
                raise LLMClientError(
                    f"Unexpected LLM response format: {e}\nResponse: {json.dumps(data, indent=2)}"
                )

    async def call_stream(
        self,
        messages: list[dict[str, str]],
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncGenerator[str, None]:
        """
        Make a streaming LLM call, yielding tokens as they arrive via SSE.

        This is the real streaming implementation — tokens are yielded
        incrementally as the LLM generates them, not buffered and dumped.

        Args:
            messages: Chat messages in OpenAI format
            temperature: Sampling temperature
            max_tokens: Maximum tokens in the response

        Yields:
            Individual text tokens/chunks as they arrive.

        Raises:
            LLMClientError: On HTTP errors or connection failures.
        """
        url = f"{self.base_url}/chat/completions"
        payload = self._build_payload(messages, temperature, max_tokens, stream=True)

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                async with client.stream(
                    "POST",
                    url,
                    headers=self._build_headers(),
                    json=payload,
                ) as response:
                    response.raise_for_status()

                    # Parse SSE (Server-Sent Events) stream
                    async for line in response.aiter_lines():
                        # SSE format: each event is "data: {json}\n\n"
                        if not line.startswith("data: "):
                            continue

                        data_str = line[6:]  # Strip "data: " prefix

                        # Stream termination signal
                        if data_str.strip() == "[DONE]":
                            break

                        try:
                            data = json.loads(data_str)
                            # Extract the delta content token
                            delta = data.get("choices", [{}])[0].get("delta", {})
                            token = delta.get("content")
                            if token:
                                yield token
                        except (json.JSONDecodeError, IndexError, KeyError):
                            # Skip malformed SSE chunks — don't crash the stream
                            continue

            except httpx.TimeoutException as e:
                raise LLMClientError(f"LLM stream timed out: {e}")
            except httpx.HTTPStatusError as e:
                raise LLMClientError(
                    f"LLM API returned {e.response.status_code} during stream"
                )
            except httpx.RequestError as e:
                raise LLMClientError(f"LLM stream connection failed: {e}")
