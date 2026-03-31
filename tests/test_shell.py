"""Tests for the shell tool."""

import pytest

from openclaw.tools.shell import shell_exec


def test_echo_command():
    result = shell_exec("echo hello")
    assert "hello" in result


def test_stderr_is_captured():
    result = shell_exec("echo err >&2")
    assert "err" in result


def test_multiline_output():
    result = shell_exec("printf 'a\\nb\\nc\\n'")
    assert "a" in result and "b" in result and "c" in result


def test_no_output_command():
    result = shell_exec("true")
    assert result == "(no output)"


def test_timeout():
    result = shell_exec("sleep 999")
    assert "timed out" in result.lower()


def test_output_truncation(monkeypatch):
    import openclaw.tools.shell as shell_mod

    monkeypatch.setattr(shell_mod, "_MAX_OUTPUT_CHARS", 5)
    result = shell_exec("echo 123456789")
    assert "truncated" in result
