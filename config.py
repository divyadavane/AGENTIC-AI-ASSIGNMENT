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
GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
DEFAULT_MODEL: str = "gemini-1.5-pro"

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
    if not GEMINI_API_KEY:
        raise ValueError(
            "GEMINI_API_KEY is not set. "
            "Copy .env.example to .env and add your Gemini API key.\n"
            "Get a key at https://aistudio.google.com/"
        )
