"""
Configuration module for the Agentic AI System.

Loads environment variables and defines system-wide constants.
No black-box frameworks — all configuration is explicit and transparent.
"""

import os
from dotenv import load_dotenv

# Load .env file from project root
load_dotenv()

# ─── LLM Configuration ───────────────────────────────────────────────
OPENROUTER_API_KEY: str = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"
DEFAULT_MODEL: str = "meta-llama/llama-3.3-70b-instruct:free"

# ─── LLM Call Parameters ─────────────────────────────────────────────
LLM_TIMEOUT: int = 60            # seconds
LLM_MAX_TOKENS: int = 4096
LLM_TEMPERATURE: float = 0.7

# ─── Retry & Failure Handling ─────────────────────────────────────────
MAX_RETRIES: int = 1              # number of retries after initial failure
RETRY_DELAY: float = 2.0         # seconds before first retry
RETRY_BACKOFF_FACTOR: float = 2.0 # exponential backoff multiplier

# ─── Retriever Agent ─────────────────────────────────────────────────
RETRIEVER_TIMEOUT: int = 15       # seconds per data source
SEARCH_MAX_RESULTS: int = 5       # max results from web search

# ─── Logging ──────────────────────────────────────────────────────────
LOG_DIR: str = "logs"

# ─── Validation ───────────────────────────────────────────────────────
def validate_config() -> None:
    """Validate that required configuration is present."""
    if not OPENROUTER_API_KEY:
        raise ValueError(
            "OPENROUTER_API_KEY is not set. "
            "Copy .env.example to .env and add your OpenRouter API key.\n"
            "Get a free key at https://openrouter.ai"
        )
