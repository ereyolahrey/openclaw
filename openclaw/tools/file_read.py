"""File-read tool."""

from __future__ import annotations

from pathlib import Path


def file_read(path: str) -> str:
    """Return the text contents of the file at *path*."""
    try:
        return Path(path).read_text(encoding="utf-8")
    except FileNotFoundError:
        return f"Error: file not found: {path}"
    except PermissionError:
        return f"Error: permission denied: {path}"
    except Exception as exc:  # noqa: BLE001
        return f"Error: {exc}"
