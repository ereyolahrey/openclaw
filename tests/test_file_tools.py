"""Tests for the file_read and file_write tools."""

import json
import os
import tempfile

import pytest

from openclaw.tools.file_read import file_read
from openclaw.tools.file_write import file_write


def test_file_write_and_read(tmp_path):
    target = tmp_path / "hello.txt"
    result = file_write(json.dumps({"path": str(target), "content": "hello world"}))
    assert "Written" in result
    assert target.read_text() == "hello world"
    assert file_read(str(target)) == "hello world"


def test_file_write_creates_parent_dirs(tmp_path):
    target = tmp_path / "a" / "b" / "c.txt"
    file_write(json.dumps({"path": str(target), "content": "nested"}))
    assert target.read_text() == "nested"


def test_file_read_missing_file():
    result = file_read("/nonexistent/path/file.txt")
    assert "Error" in result


def test_file_write_invalid_json():
    result = file_write("not json")
    assert "Error" in result


def test_file_write_missing_keys():
    result = file_write(json.dumps({"path": "/tmp/x.txt"}))
    assert "Error" in result
