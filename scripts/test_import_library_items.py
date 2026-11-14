"""Tests for import_library_items.py on a small synthetic library.

Run: uv run python -m unittest scripts/test_import_library_items.py
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import import_library_items as importer
import set_trial_steps

LIBRARY = {
    "components": {
        # Mini-VLAT style: question in the instruction, plain string options, relative image path.
        "bars": {
            "type": "image", "path": "libraries/demo/assets/Bars.png", "instruction": "Which bar is tallest?",
            "nextButtonDisableTime": 25000, "meta": {"chartType": "bar"},
            "response": [{"id": "res-bars", "type": "radio", "prompt": "Your answer", "options": ["A", "B"]}],
            "correctAnswer": [{"id": "res-bars", "answer": "B"}],
        },
        # CALVI style: question in the prompt, label/value options, full image URL.
        "T1": {
            "type": "image", "path": "https://example.test/T1.jpg", "description": "A trick chart",
            "response": [{"id": "q1", "type": "radio", "prompt": "Is A > B?", "options": [{"label": "Yes", "value": "yes"}, {"label": "No", "value": "no"}]}],
            "correctAnswer": [{"id": "q1", "answer": "no"}],
        },
        "T2": {
            "type": "image", "path": "https://example.test/T2.jpg",
            "response": [{"id": "q1", "type": "radio", "prompt": "Is C > D?", "options": ["Yes", "No"]}],
            "correctAnswer": [{"id": "q1", "answer": "Yes"}],
        },
        "unused": {"type": "image", "path": "x.png", "response": [{"id": "q", "type": "radio", "prompt": "?", "options": ["a"]}]},
    },
    "sequences": {
        "bank": {"id": "bankSeq", "order": "fixed", "components": ["bars", {"order": "random", "numSamples": 1, "components": ["T1", "T2"]}]},
    },
}


class ImportLibraryItemsTest(unittest.TestCase):
    def setUp(self) -> None:
        template = json.loads(importer.TEMPLATE.read_text())
        self.config = importer.build_config("demo", LIBRARY, "bank", template, title="Demo", ref="abc123")
        self.template = template

    def test_items_and_answers_are_copied(self) -> None:
        components = self.config["components"]
        self.assertEqual(
            sorted(components),
            sorted(["consent", "introduction", *(f"{step}-{key}" for key in ("bars", "T1", "T2") for step in ("fixation", "graph", "tlx"))]),
        )
        self.assertEqual(components["introduction"], self.template["components"]["introduction"])
        self.assertEqual(components["consent"], self.template["components"]["consent"])
        bars, t1 = components["graph-bars"], components["graph-T1"]
        self.assertEqual(bars["response"], [{"id": "answer", "type": "radio", "prompt": "Which bar is tallest?", "options": ["A", "B"]}])
        self.assertEqual(bars["correctAnswer"], [{"id": "answer", "answer": "B"}])
        self.assertEqual(bars["parameters"]["imageUrl"], f"{importer.UPSTREAM}/abc123/public/libraries/demo/assets/Bars.png")
        self.assertEqual(components["fixation-bars"]["parameters"]["imageUrl"], bars["parameters"]["imageUrl"])
        self.assertEqual(t1["response"][0]["prompt"], "Is A > B?")
        self.assertEqual(t1["response"][0]["options"][1], {"label": "No", "value": "no"})
        self.assertEqual(t1["correctAnswer"], [{"id": "answer", "answer": "no"}])
        self.assertEqual(t1["meta"], {"library": "demo", "item": "T1", "title": "A trick chart"})
        self.assertNotIn("nextButtonDisableTime", json.dumps(self.config))

    def test_sequence_keeps_nested_random_draw(self) -> None:
        sequence = self.config["sequence"]
        self.assertEqual(sequence["order"], "fixed")
        self.assertEqual(sequence["components"][:2], ["consent", "introduction"])
        sequence = {**sequence, "components": sequence["components"][2:]}
        self.assertEqual(sequence["components"][0], {"id": "bars", "order": "fixed", "components": ["fixation-bars", "graph-bars", "tlx-bars"]})
        draw = sequence["components"][1]
        self.assertEqual((draw["order"], draw["numSamples"], [block["id"] for block in draw["components"]]), ("random", 1, ["T1", "T2"]))

    def test_steps_switch_reaches_nested_items(self) -> None:
        set_trial_steps.set_steps(self.config, fixation=False, tlx=False)
        self.assertEqual(set_trial_steps.current_steps(self.config), {"fixation": False, "tlx": False})
        self.assertEqual(self.config["sequence"]["components"][3]["components"][0]["components"], ["graph-T1"])

    def test_shared_settings_are_copied_not_shared(self) -> None:
        self.assertEqual(self.config["baseComponents"], self.template["baseComponents"])
        self.assertIsNot(self.config["baseComponents"], self.template["baseComponents"])
        self.assertEqual(self.config["studyMetadata"]["title"], "Demo")

    def test_shuffled_sequence_keeps_opening_pages_first(self) -> None:
        library = {**LIBRARY, "sequences": {"shuffled": {"id": "mix", "order": "random", "components": ["bars", "T1"]}}}
        config = importer.build_config("demo", library, "shuffled", self.template, title="Demo", ref="abc123")
        sequence = config["sequence"]
        self.assertEqual(sequence["order"], "fixed")
        self.assertEqual(sequence["components"][:2], ["consent", "introduction"])
        inner = sequence["components"][2]
        self.assertEqual((inner["id"], inner["order"], [block["id"] for block in inner["components"]]), ("mix", "random", ["bars", "T1"]))
        set_trial_steps.set_steps(config, fixation=False, tlx=False)
        self.assertEqual(inner["components"][0]["components"], ["graph-bars"])

    def test_unknown_sequence_is_an_error(self) -> None:
        with self.assertRaises(SystemExit):
            importer.build_config("demo", LIBRARY, "missing", self.template, title="Demo", ref="abc123")


if __name__ == "__main__":
    unittest.main()
