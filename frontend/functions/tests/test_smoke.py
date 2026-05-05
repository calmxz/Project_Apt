"""Functions-side smoke test. CI relies on this passing on a clean install."""

import ast
import pathlib


def test_arithmetic_is_intact():
    assert 1 + 1 == 2


def test_main_py_parses_and_exposes_health_check():
    """Parse main.py without importing it.

    Avoids forcing the full firebase-functions/ADK install just to run a smoke test.
    Real handler tests arrive in Phase 2 once chat() exists.
    """
    main_path = pathlib.Path(__file__).resolve().parents[1] / "main.py"
    tree = ast.parse(main_path.read_text(encoding="utf-8"))

    function_names = {
        node.name for node in tree.body if isinstance(node, ast.FunctionDef)
    }
    assert "health_check" in function_names
