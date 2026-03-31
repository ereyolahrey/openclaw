"""Command-line interface for the OpenClaw everything agent."""

from __future__ import annotations

import argparse
import sys
from typing import Callable


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="openclaw",
        description="OpenClaw – a general-purpose everything agent.",
    )
    parser.add_argument(
        "prompt",
        nargs="?",
        help="Prompt to send to the agent.  If omitted, enter interactive mode.",
    )
    parser.add_argument(
        "--model",
        metavar="BACKEND",
        default=None,
        help=(
            "LLM back-end to use.  Currently supported: 'openai' (requires the "
            "OPENAI_API_KEY environment variable).  Omit to run in tool-only mode."
        ),
    )
    return parser


def _make_model_fn(backend: str | None) -> Callable[[str], str] | None:
    """Return a model callable, or *None* for tool-only mode."""
    if backend is None:
        return None
    if backend == "openai":
        return _openai_fn()
    print(f"Warning: unknown backend '{backend}', running in tool-only mode.")
    return None


def _openai_fn() -> Callable[[str], str]:
    """Return a callable that queries OpenAI's chat completion API."""
    try:
        import os

        import openai  # type: ignore[import-untyped]
    except ImportError:
        print(
            "Error: the 'openai' package is not installed.  "
            "Install it with:  pip install openai"
        )
        sys.exit(1)

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("Error: OPENAI_API_KEY environment variable is not set.")
        sys.exit(1)

    client = openai.OpenAI(api_key=api_key)

    def call(prompt: str) -> str:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
        )
        return response.choices[0].message.content or ""

    return call


def _run_interactive(model_fn: Callable[[str], str] | None) -> None:
    from .agent import Agent

    agent = Agent(model_fn=model_fn)
    print("OpenClaw agent  (type 'exit' or Ctrl-D to quit)\n")
    while True:
        try:
            user_input = input("You> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if user_input.lower() in {"exit", "quit"}:
            break
        if not user_input:
            continue
        answer = agent.run(user_input)
        print(f"\nAgent> {answer}\n")


def main(argv: list[str] | None = None) -> None:
    parser = _build_parser()
    args = parser.parse_args(argv)
    model_fn = _make_model_fn(args.model)

    if args.prompt:
        from .agent import Agent

        agent = Agent(model_fn=model_fn)
        print(agent.run(args.prompt))
    else:
        _run_interactive(model_fn)


if __name__ == "__main__":
    main()
