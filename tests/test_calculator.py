"""Tests for the calculator tool."""

import pytest

from openclaw.tools.calculator import calculator


def test_basic_addition():
    assert calculator("2 + 2") == "4"


def test_basic_subtraction():
    assert calculator("10 - 3") == "7"


def test_basic_multiplication():
    assert calculator("6 * 7") == "42"


def test_basic_division():
    assert calculator("10 / 4") == "2.5"


def test_integer_division():
    assert calculator("9 // 2") == "4"


def test_modulo():
    assert calculator("17 % 5") == "2"


def test_exponentiation():
    assert calculator("2 ** 10") == "1024"


def test_math_function_sqrt():
    assert calculator("sqrt(144)") == "12"


def test_math_function_floor():
    assert calculator("floor(3.7)") == "3"


def test_constant_pi():
    result = calculator("pi")
    assert result.startswith("3.14")


def test_nested_expression():
    assert calculator("(3 + 4) * 2") == "14"


def test_unary_negation():
    assert calculator("-5 + 10") == "5"


def test_error_on_unknown_name():
    result = calculator("x + 1")
    assert "Error" in result


def test_error_on_invalid_syntax():
    result = calculator("2 +* 2")
    assert "Error" in result


def test_error_on_string_constant():
    result = calculator('"hello"')
    assert "Error" in result
