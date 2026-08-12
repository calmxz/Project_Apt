"""Import-time directory creation in config.py.

Render boot crashed (PermissionError) because config.py unconditionally
mkdir'd settings.uploads_path at import even when uploads_store=r2, where
the local uploads dir is never used. The mkdir must only run for the
local store. Each test imports config in a subprocess so the module-level
code runs fresh under controlled env.
"""

import os
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _import_config(uploads_store: str, uploads_path: Path) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env.update(
        {
            "CRUX_SKIP_DOTENV": "1",
            "UPLOADS_STORE": uploads_store,
            "UPLOADS_PATH": str(uploads_path),
        }
    )
    return subprocess.run(
        [sys.executable, "-c", "import config"],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
    )


def test_r2_store_does_not_create_uploads_dir(tmp_path):
    target = tmp_path / "nested" / "uploads"
    result = _import_config("r2", target)
    assert result.returncode == 0, result.stderr
    assert not target.exists()


def test_local_store_creates_uploads_dir(tmp_path):
    target = tmp_path / "nested" / "uploads"
    result = _import_config("local", target)
    assert result.returncode == 0, result.stderr
    assert target.is_dir()
