# openclaw

**OpenClaw** is a general-purpose *everything agent* — a command-line AI agent that can reason about tasks and use built-in tools to accomplish them.

## Features

| Tool | Description |
|---|---|
| `calculator` | Safely evaluate mathematical expressions |
| `file_read` | Read the contents of any text file |
| `file_write` | Write text to a file (creates parent directories) |
| `shell` | Run a shell command and return its output |
| `web_search` | Search the web via DuckDuckGo Instant Answer API |

The agent uses a **ReAct** (Reason + Act) loop: it reasons about what to do, calls a tool if needed, observes the result, then continues until it has a final answer.

## Installation

```bash
pip install -e .
```

## Usage

### Interactive mode

```bash
openclaw
```

### Single prompt

```bash
openclaw "What is 123 * 456?"
```

### With an LLM back-end

```bash
export OPENAI_API_KEY=sk-...
openclaw --model openai "Summarize the file README.md"
```

When no `--model` is provided the agent runs in *tool-only* mode, which dispatches explicit `Action: … / Input: …` lines directly to the tools — useful for testing and scripting.

## Running tests

```bash
pip install pytest
pytest
```
