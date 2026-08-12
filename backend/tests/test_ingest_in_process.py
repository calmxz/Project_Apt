"""start_ingest_loop: flag-gated daemon thread wrapping worker.main_loop
(2026-08-12 worker-deferral spec)."""

import threading

import main as main_module
from config import settings


def test_start_ingest_loop_noop_when_flag_off(monkeypatch):
    monkeypatch.setattr(settings, "ingest_in_process", False)
    thread, ev = main_module.start_ingest_loop()
    assert thread is None and ev is None


def test_start_ingest_loop_starts_and_stops_thread(monkeypatch):
    monkeypatch.setattr(settings, "ingest_in_process", True)

    entered = threading.Event()

    def fake_main_loop(max_iterations=None, stop_event=None):
        entered.set()
        stop_event.wait(5)

    monkeypatch.setattr(main_module, "main_loop", fake_main_loop)

    thread, ev = main_module.start_ingest_loop()
    assert thread is not None and thread.daemon
    assert thread.name == "ingest-loop"
    assert entered.wait(2), "main_loop was never entered"

    ev.set()
    thread.join(timeout=2)
    assert not thread.is_alive()
