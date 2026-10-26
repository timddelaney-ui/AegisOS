import ast
from pathlib import Path


def test_server_is_a_fastapi_entrypoint():
    source = (Path(__file__).resolve().parents[1] / "server.py").read_text()
    module = ast.parse(source)

    assert "import React" not in source
    assert any(
        isinstance(node, ast.ImportFrom)
        and node.module == "fastapi"
        and any(alias.name == "FastAPI" for alias in node.names)
        for node in module.body
    )
    assert any(
        isinstance(node, ast.Assign)
        and any(isinstance(target, ast.Name) and target.id == "app" for target in node.targets)
        and isinstance(node.value, ast.Call)
        and isinstance(node.value.func, ast.Name)
        and node.value.func.id == "FastAPI"
        for node in module.body
    )
    assert any(
        isinstance(node, ast.Expr)
        and isinstance(node.value, ast.Call)
        and isinstance(node.value.func, ast.Attribute)
        and isinstance(node.value.func.value, ast.Name)
        and node.value.func.value.id == "app"
        and node.value.func.attr == "include_router"
        for node in module.body
    )


def test_legacy_free_for_all_is_disabled_by_default():
    source = (Path(__file__).resolve().parents[1] / "server.py").read_text()
    module = ast.parse(source)
    assignment = next(
        node
        for node in module.body
        if isinstance(node, ast.Assign)
        and any(isinstance(target, ast.Name) and target.id == "FREE_FOR_ALL" for target in node.targets)
    )

    assert any(
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "get"
        and len(node.args) > 1
        and isinstance(node.args[0], ast.Constant)
        and node.args[0].value == "CT_FREE_FOR_ALL"
        and isinstance(node.args[1], ast.Constant)
        and node.args[1].value == "false"
        for node in ast.walk(assignment.value)
    )
