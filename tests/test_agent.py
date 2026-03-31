"""Tests for the core Agent class."""

import pytest

from openclaw.agent import Agent, _call_tool, _parse_action, _parse_final_answer


# ---------------------------------------------------------------------------
# Unit tests for parsing helpers
# ---------------------------------------------------------------------------


def test_parse_final_answer_found():
    text = "Thought: done.\nFinal Answer: 42"
    assert _parse_final_answer(text) == "42"


def test_parse_final_answer_not_found():
    assert _parse_final_answer("no answer here") is None


def test_parse_action_found():
    text = "Thought: let me calculate.\nAction: calculator\nInput: 2 + 2"
    result = _parse_action(text)
    assert result == ("calculator", "2 + 2")


def test_parse_action_not_found():
    assert _parse_action("just some text") is None


def test_parse_action_strips_observation():
    text = "Action: calculator\nInput: 3 * 3\nObservation: 9"
    name, inp = _parse_action(text)
    assert inp == "3 * 3"


# ---------------------------------------------------------------------------
# Unit tests for tool dispatch
# ---------------------------------------------------------------------------


def test_call_known_tool():
    result = _call_tool("calculator", "1 + 1")
    assert result == "2"


def test_call_unknown_tool():
    result = _call_tool("nonexistent", "anything")
    assert "Unknown tool" in result


# ---------------------------------------------------------------------------
# Integration tests for the Agent
# ---------------------------------------------------------------------------


def test_agent_tool_only_mode_with_action_input():
    """In tool-only mode the agent dispatches Action/Input lines."""
    agent = Agent(model_fn=None)
    # Embed the Action/Input pattern in the user message so the echo path
    # picks it up and dispatches to the calculator.
    response = agent.run("Action: calculator\nInput: 10 * 10")
    assert response == "100"


def test_agent_tool_only_mode_no_action():
    """Without Action/Input the agent returns the raw input."""
    agent = Agent(model_fn=None)
    response = agent.run("hello there")
    assert response == "hello there"


def test_agent_with_mock_model_final_answer():
    """A model that immediately returns a Final Answer should work."""

    def mock_model(prompt: str) -> str:
        return "Thought: simple.\nFinal Answer: 99"

    agent = Agent(model_fn=mock_model)
    result = agent.run("what is the answer?")
    assert result == "99"


def test_agent_with_mock_model_uses_tool():
    """A model that issues one tool call then gives a final answer."""
    call_count = 0

    def mock_model(prompt: str) -> str:
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return "Thought: calculate.\nAction: calculator\nInput: 6 * 7"
        return "Thought: done.\nFinal Answer: 42"

    agent = Agent(model_fn=mock_model)
    result = agent.run("what is 6 times 7?")
    assert result == "42"
    assert call_count == 2


def test_agent_reset_clears_history():
    agent = Agent(model_fn=None)
    agent.run("hello")
    agent.reset()
    # After reset the history should be empty.
    assert agent._history == []


def test_agent_max_steps():
    """An always-cycling model should hit the step limit gracefully."""

    def looping_model(prompt: str) -> str:
        return "Thought: still going.\nAction: calculator\nInput: 1 + 1"

    agent = Agent(model_fn=looping_model)
    result = agent.run("loop forever")
    assert "maximum" in result.lower()
