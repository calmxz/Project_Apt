from pathlib import Path

ENTRYPOINT = Path(__file__).resolve().parent.parent / "entrypoint.sh"


def _text():
    return ENTRYPOINT.read_text(encoding="utf-8")


def test_entrypoint_exists():
    assert ENTRYPOINT.is_file()


def test_migrate_before_exec():
    text = _text()
    assert "alembic upgrade head" in text
    assert "exec uvicorn" in text
    assert text.index("alembic upgrade head") < text.index("exec uvicorn")


def test_honors_injected_port():
    assert "${PORT:-8000}" in _text()


def test_fails_fast_on_error():
    assert "set -e" in _text()
