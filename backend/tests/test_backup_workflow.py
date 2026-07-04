from pathlib import Path

import yaml

_WORKFLOW = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "backup.yml"
_RESTORE = Path(__file__).resolve().parents[2] / "docs" / "deploy" / "RESTORE.md"


def _load():
    return yaml.safe_load(_WORKFLOW.read_text(encoding="utf-8"))


def test_workflow_exists():
    assert _WORKFLOW.exists()


def test_workflow_runs_daily_and_manual():
    wf = _load()
    # PyYAML parses the bare `on:` key as boolean True.
    triggers = wf[True]
    assert triggers["schedule"][0]["cron"] == "0 3 * * *"
    assert "workflow_dispatch" in triggers


def test_workflow_dumps_uploads_and_prunes():
    text = _WORKFLOW.read_text(encoding="utf-8")
    assert "pg_dump" in text
    assert "postgresql-client-17" in text
    assert "scripts.backup upload" in text
    assert "scripts.backup prune" in text


def test_workflow_reads_secrets():
    text = _WORKFLOW.read_text(encoding="utf-8")
    for secret in (
        "DATABASE_URL",
        "R2_ENDPOINT",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET",
    ):
        assert f"secrets.{secret}" in text


def test_restore_doc_documents_pg_restore():
    text = _RESTORE.read_text(encoding="utf-8")
    assert "pg_restore" in text
    assert "--clean" in text
    assert "scratch" in text.lower()
