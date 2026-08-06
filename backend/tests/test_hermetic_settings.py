"""Q-01: the test suite must never load the developer's real .env."""

import os

from config import Settings, settings


def test_dotenv_disabled_under_pytest():
    assert os.environ.get("CRUX_SKIP_DOTENV") == "1"
    assert Settings.model_config.get("env_file") is None


def test_cap_settings_are_code_defaults():
    assert settings.llm_soft_cap_usd == 2.00
    assert settings.llm_hard_cap_usd == 3.00


def test_cost_guard_defaults():
    assert settings.max_chunks == 5000
    assert settings.global_daily_cost_cap_usd is None
