"""Core agent loop (ReAct – Reason + Act)."""

from __future__ import annotations

import re
from typing import Any

from .tools import TOOLS


# Maximum reasoning/action cycles before giving up.
MAX_STEPS = 10

# Prompt template injected at the start of every conversation.
SYSTEM_PROMPT = """\
You are OpenClaw, a general-purpose agent.

You can use the following tools to help answer the user's request:

{tool_descriptions}

To use a tool write:
  Thought: <your reasoning>
  Action: <tool_name>
  Input: <tool input>

The environment will respond with:
  Observation: <tool output>

Repeat Thought/Action/Input/Observation as many times as needed.
When you have the final answer write:
  Thought: I now have the final answer.
  Final Answer: <your answer>
"""


def _build_tool_descriptions() -> str:
    lines = []
    for name, tool in TOOLS.items():
        lines.append(f"  {name}: {tool['description']}")
    return "\n".join(lines)


def _parse_action(text: str) -> tuple[str, str] | None:
    """Return (tool_name, tool_input) if an Action/Input block is found."""
    action_match = re.search(r"Action:\s*(.+)", text)
    input_match = re.search(r"Input:\s*(.*)", text, re.DOTALL)
    if action_match and input_match:
        tool_name = action_match.group(1).strip()
        tool_input = input_match.group(1).strip()
        # Strip trailing "Observation:" that the model may hallucinate.
        tool_input = re.split(r"\nObservation:", tool_input, maxsplit=1)[0].strip()
        return tool_name, tool_input
    return None


def _parse_final_answer(text: str) -> str | None:
    match = re.search(r"Final Answer:\s*(.*)", text, re.DOTALL)
    if match:
        return match.group(1).strip()
    return None


class Agent:
    """Stateful ReAct agent."""

    def __init__(self, model_fn: Any | None = None) -> None:
        """
        Parameters
        ----------
        model_fn:
            Callable ``(prompt: str) -> str``.  When *None* the agent
            operates in *echo / tool-only* mode, which is useful for tests
            and for running without an LLM back-end.
        """
        self._model_fn = model_fn
        self._history: list[str] = []

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def reset(self) -> None:
        """Clear conversation history."""
        self._history.clear()

    def run(self, user_input: str) -> str:
        """Process *user_input* and return the agent's final answer."""
        tool_descriptions = _build_tool_descriptions()
        system = SYSTEM_PROMPT.format(tool_descriptions=tool_descriptions)

        self._history.append(f"User: {user_input}")
        context = system + "\n\n" + "\n".join(self._history) + "\n"

        for step in range(MAX_STEPS):
            if self._model_fn is not None:
                response = self._model_fn(context)
            else:
                # No model: act as a simple pass-through so callers can
                # still exercise the tool-dispatch path by embedding
                # Action / Input lines directly in their input.
                response = user_input

            context += response + "\n"

            final = _parse_final_answer(response)
            if final is not None:
                self._history.append(f"Agent: {final}")
                return final

            parsed = _parse_action(response)
            if parsed is not None:
                tool_name, tool_input = parsed
                observation = _call_tool(tool_name, tool_input)
                obs_line = f"Observation: {observation}"
                context += obs_line + "\n"
                if self._model_fn is None:
                    # In echo mode return the observation directly.
                    self._history.append(f"Agent: {observation}")
                    return observation
                continue

            # Model produced neither a tool call nor a final answer –
            # treat the whole response as the final answer.
            self._history.append(f"Agent: {response}")
            return response

        return "I reached the maximum number of steps without a final answer."


def _call_tool(tool_name: str, tool_input: str) -> str:
    if tool_name not in TOOLS:
        available = ", ".join(TOOLS.keys())
        return f"Unknown tool '{tool_name}'. Available tools: {available}"
    try:
        return str(TOOLS[tool_name]["fn"](tool_input))
    except Exception as exc:  # noqa: BLE001
        return f"Tool error: {exc}"
