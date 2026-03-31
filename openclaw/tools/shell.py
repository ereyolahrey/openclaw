"""Shell-execution tool."""

from __future__ import annotations

import subprocess


# Hard cap on output returned to the agent.
_MAX_OUTPUT_CHARS = 4096
_TIMEOUT_SECONDS = 30


def shell_exec(command: str) -> str:
    """Run *command* in a subprocess shell and return combined stdout/stderr.

    Output is capped at ``_MAX_OUTPUT_CHARS`` characters.  The command is
    killed after ``_TIMEOUT_SECONDS`` seconds to prevent runaway processes.
    """
    try:
        result = subprocess.run(
            command,
            shell=True,  # noqa: S602
            capture_output=True,
            text=True,
            timeout=_TIMEOUT_SECONDS,
        )
        output = result.stdout + result.stderr
    except subprocess.TimeoutExpired:
        return f"Error: command timed out after {_TIMEOUT_SECONDS} seconds"
    except Exception as exc:  # noqa: BLE001
        return f"Error: {exc}"

    if len(output) > _MAX_OUTPUT_CHARS:
        output = output[:_MAX_OUTPUT_CHARS] + "\n…(output truncated)"
    return output or "(no output)"
