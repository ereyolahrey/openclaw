"""Calculator tool: safely evaluate a mathematical expression."""

from __future__ import annotations

import ast
import math
import operator as op
from typing import Any

# Allowed operators
_OPERATORS: dict[type, Any] = {
    ast.Add: op.add,
    ast.Sub: op.sub,
    ast.Mult: op.mul,
    ast.Div: op.truediv,
    ast.Pow: op.pow,
    ast.USub: op.neg,
    ast.UAdd: op.pos,
    ast.Mod: op.mod,
    ast.FloorDiv: op.floordiv,
}

# Allowed names
_NAMES: dict[str, float] = {
    name: getattr(math, name)
    for name in dir(math)
    if not name.startswith("_")
}
_NAMES["pi"] = math.pi
_NAMES["e"] = math.e


def _eval(node: ast.AST) -> float:
    if isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float)):
            return float(node.value)
        raise ValueError(f"Unsupported constant: {node.value!r}")
    if isinstance(node, ast.Name):
        if node.id in _NAMES:
            return float(_NAMES[node.id])
        raise ValueError(f"Unknown name: {node.id!r}")
    if isinstance(node, ast.BinOp):
        cls = type(node.op)
        if cls not in _OPERATORS:
            raise ValueError(f"Unsupported operator: {cls.__name__}")
        return _OPERATORS[cls](_eval(node.left), _eval(node.right))
    if isinstance(node, ast.UnaryOp):
        cls = type(node.op)
        if cls not in _OPERATORS:
            raise ValueError(f"Unsupported operator: {cls.__name__}")
        return _OPERATORS[cls](_eval(node.operand))
    if isinstance(node, ast.Call):
        if isinstance(node.func, ast.Name) and node.func.id in _NAMES:
            fn = getattr(math, node.func.id, None)
            if callable(fn):
                args = [_eval(a) for a in node.args]
                return float(fn(*args))
        raise ValueError(f"Unsupported function call: {ast.dump(node.func)}")
    raise ValueError(f"Unsupported expression: {ast.dump(node)}")


def calculator(expression: str) -> str:
    """Return the result of evaluating *expression*.

    Only numeric arithmetic and standard ``math`` functions are allowed.
    No arbitrary code can be executed.
    """
    try:
        tree = ast.parse(expression.strip(), mode="eval")
        result = _eval(tree.body)
        # Format as integer when the result is a whole number.
        if result == int(result) and abs(result) < 1e15:
            return str(int(result))
        return str(result)
    except Exception as exc:  # noqa: BLE001
        return f"Error: {exc}"
