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
