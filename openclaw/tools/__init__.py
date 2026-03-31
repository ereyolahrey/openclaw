"""Built-in tools available to the agent."""

from __future__ import annotations

from .calculator import calculator
from .file_read import file_read
from .file_write import file_write
from .shell import shell_exec
from .web_search import web_search

TOOLS: dict[str, dict] = {
    "calculator": {
        "description": "Evaluate a mathematical expression. Input: expression string.",
        "fn": calculator,
    },
    "file_read": {
        "description": "Read the contents of a file. Input: file path.",
        "fn": file_read,
    },
    "file_write": {
        "description": (
            "Write text to a file. Input: JSON object with keys 'path' and 'content'."
        ),
        "fn": file_write,
    },
    "shell": {
        "description": "Run a shell command and return its output. Input: command string.",
        "fn": shell_exec,
    },
    "web_search": {
        "description": "Search the web for a query. Input: search query string.",
        "fn": web_search,
    },
}

__all__ = ["TOOLS"]
