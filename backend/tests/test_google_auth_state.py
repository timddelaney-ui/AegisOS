import ast
from pathlib import Path


def test_server_parses_and_google_routes_present():
    src = (Path(__file__).resolve().parents[1] / "server.py").read_text()
    ast.parse(src)
    for route in ("/auth/google/login", "/auth/google/callback", "/auth/config"):
        assert route in src
    assert "_finish_login(" in src and "_llm_reply(" in src
