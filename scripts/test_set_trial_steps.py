"""Tests for set_trial_steps.py on a copy of the study config.

Run: uv run python -m unittest scripts/test_set_trial_steps.py
"""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import set_trial_steps as steps


class SetTrialStepsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.config = Path(tempfile.mkdtemp()) / "config.json"
        shutil.copy(steps.CONFIG, self.config)

    def run_script(self, *args: str) -> dict:
        self.assertEqual(steps.main([*args, "--config", str(self.config)]), 0)
        return json.loads(self.config.read_text())

    def blocks(self, config: dict) -> dict[str, list[str]]:
        return {block["id"]: block["components"] for block in steps.item_blocks(config)}

    def test_toggle_off_and_back_on(self) -> None:
        original = json.loads(self.config.read_text())
        config = self.run_script("--no-tlx")
        self.assertEqual(self.blocks(config)["treemap"], ["fixation-treemap", "graph-treemap"])
        config = self.run_script("--no-fixation")
        self.assertEqual(self.blocks(config)["treemap"], ["graph-treemap"])
        self.assertEqual(steps.current_steps(config), {"fixation": False, "tlx": False})
        config = self.run_script("--fixation", "--tlx")
        self.assertEqual(config, original)

    def test_no_flags_leaves_config_unchanged(self) -> None:
        before = self.config.read_text()
        self.run_script()
        self.assertEqual(self.config.read_text(), before)


if __name__ == "__main__":
    unittest.main()
