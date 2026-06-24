"""
Direct LLM API client for Groq.

This module handles all communication with the LLM backend.
NO SDKs or agent frameworks — raw HTTP calls via httpx.

Supports:
  - Standard (non-streaming) completions
  - Streaming completions via Server-Sent Events (SSE)
  - Proper error handling, timeout management, and structured responses
  - Multimodal Vision Support (auto-switching to vision model)
"""

from __future__ import annotations

import json
from typing import AsyncGenerator, Any

import httpx

import config


class LLMClientError(Exception):
    """Raised when an LLM API call fails after all retries."""
    pass


class LLMClient:
    """
    Async HTTP client for the Groq chat completions API.

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
        model: str | None = None,
        timeout: int | None = None,
    ):
        self.api_key = api_key or config.GROQ_API_KEY
        self.model = model or config.DEFAULT_MODEL
        self.timeout = timeout or config.LLM_TIMEOUT

        if not self.api_key:
            raise LLMClientError(
                "No API key provided. Set GROQ_API_KEY in your .env file."
            )

    def _build_headers(self) -> dict[str, str]:
        """Construct request headers for Groq API."""
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _build_payload(
        self,
        messages: list[dict[str, Any]],
        temperature: float | None = None,
        max_tokens: int | None = None,
        stream: bool = False,
        json_mode: bool = False,
    ) -> dict:
        """Build the request payload for the chat completions endpoint."""
        
        # Check if any message contains an image. If so, switch to the vision model.
        has_vision = False
        for msg in messages:
            if isinstance(msg.get("content"), list):
                for item in msg["content"]:
                    if isinstance(item, dict) and item.get("type") == "image_url":
                        has_vision = True
                        break
        
        target_model = "llama-3.2-11b-vision-preview" if has_vision else self.model

        payload = {
            "model": target_model,
            "messages": messages,
            "temperature": temperature if temperature is not None else config.LLM_TEMPERATURE,
            "max_tokens": max_tokens or config.LLM_MAX_TOKENS,
            "stream": stream,
        }
        
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
            
        return payload

    async def call(
        self,
        messages: list[dict[str, Any]],
        temperature: float | None = None,
        max_tokens: int | None = None,
        json_mode: bool = False,
    ) -> str:
        """
        Make a non-streaming LLM call using httpx.
        """
        payload = self._build_payload(messages, temperature, max_tokens, stream=False, json_mode=json_mode)
        url = "https://api.groq.com/openai/v1/chat/completions"

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                response = await client.post(
                    url, headers=self._build_headers(), json=payload
                )
                response.raise_for_status()
                data = response.json()
                return data["choices"][0]["message"]["content"]
            except httpx.HTTPStatusError as e:
                err_text = e.response.text
                raise LLMClientError(f"Groq API error ({e.response.status_code}): {err_text}")
            except Exception as e:
                raise LLMClientError(f"Groq call failed: {e}")

    async def call_stream(
        self,
        messages: list[dict[str, Any]],
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncGenerator[str, None]:
        """
        Make a streaming LLM call using httpx and Server-Sent Events.
        """
        payload = self._build_payload(messages, temperature, max_tokens, stream=True)
        url = "https://api.groq.com/openai/v1/chat/completions"

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                async with client.stream(
                    "POST", url, headers=self._build_headers(), json=payload
                ) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if line.startswith("data: "):
                            data_str = line[6:].strip()
                            if data_str == "[DONE]":
                                break
                            if not data_str:
                                continue

                            try:
                                chunk = json.loads(data_str)
                                choices = chunk.get("choices", [])
                                if choices:
                                    delta = choices[0].get("delta", {})
                                    content = delta.get("content", "")
                                    if content:
                                        yield content
                            except json.JSONDecodeError:
                                continue
            except httpx.HTTPStatusError as e:
                await e.response.aread()
                err_text = e.response.text
                raise LLMClientError(f"Groq API error ({e.response.status_code}): {err_text}")
            except Exception as e:
                raise LLMClientError(f"Groq stream failed: {e}")
