"""File-write tool."""

from __future__ import annotations

import json
from pathlib import Path


def file_write(input_json: str) -> str:
    """Write content to a file.

    *input_json* must be a JSON object with keys ``"path"`` and ``"content"``.
    Parent directories are created automatically.
    """
    try:
        data = json.loads(input_json)
        path = data["path"]
        content = data["content"]
    except (json.JSONDecodeError, KeyError) as exc:
        return f"Error: invalid input – {exc}. Expected JSON with 'path' and 'content'."

    try:
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return f"Written {len(content)} characters to {path}"
    except PermissionError:
        return f"Error: permission denied: {path}"
    except Exception as exc:  # noqa: BLE001
        return f"Error: {exc}"
