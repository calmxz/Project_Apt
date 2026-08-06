import logging

from lib.logging_config import configure_logging


def test_configure_logging_sets_formatted_console_handler(capsys):
    configure_logging()
    logging.getLogger("crux.test").info("hello world")
    out = capsys.readouterr().out
    assert "INFO" in out
    assert "crux.test" in out
    assert "hello world" in out
    assert "[-]" in out  # request_id placeholder outside a request


def test_root_level_from_settings(monkeypatch):
    monkeypatch.setattr("lib.logging_config.settings.log_level", "WARNING")
    configure_logging()
    assert logging.getLogger().level == logging.WARNING
