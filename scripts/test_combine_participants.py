"""Tests for combine_participants.py on small synthetic participant files.

Run: uv run python -m unittest scripts/test_combine_participants.py
"""

from __future__ import annotations

import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent))

import combine_participants as combine

IMAGE = [100.0, 50.0, 400.0, 300.0]


def draw(start: int, points: list[list[float]]) -> list[Any]:
    return [start, "draw", {"end": int(points[-1][0]), "image": IMAGE, "points": points}]


def participant(participant_id: str, *, created: int, events: list[Any], answer: str = "False", finished: bool = True) -> dict[str, Any]:
    end = 2_500 if finished else -1
    return {
        "participantId": participant_id,
        "participantIndex": 1,
        "createdTime": created,
        "finalized": finished,
        "rejected": False,
        "metadata": {"userAgent": "test", "language": "en", "resolution": {"width": 1024, "height": 768}},
        "answers": {
            "fixation-treemap_0": {
                "componentName": "fixation-treemap", "trialOrder": "0", "startTime": 0, "endTime": 1_000,
                "answer": {"baseline": {"crossShownAt": 10, "crossHiddenAt": 5_012, "durationMs": 5_000}},
                "parameters": {}, "correctAnswer": [],
            },
            "graph-treemap_1": {
                "componentName": "graph-treemap", "trialOrder": "1", "startTime": 1_000, "endTime": end,
                "answer": {"answer": answer, "annotationEvents": events},
                "parameters": {"imageUrl": "TreeMap.png"}, "correctAnswer": [{"id": "answer", "answer": "False"}],
            },
            "tlx-treemap_2": {
                "componentName": "tlx-treemap", "trialOrder": "2", "startTime": 2_500, "endTime": 3_000 if finished else -1,
                "answer": dict.fromkeys(combine.TLX_SCALES, 30),
                "parameters": {}, "correctAnswer": [],
            },
        },
    }


EVENTS = [
    draw(1_100, [[1_100, 0.0, 0.0], [1_150, 0.5, 0.5]]),
    draw(1_200, [[1_200, 0.1, 0.1], [1_250, 1.05, 0.2]]),
    [1_300, "undo", 1],
    draw(1_400, [[1_400, 0.2, 0.2]]),
    [1_500, "clear", [0, 3]],
    draw(1_600, [[1_600, 0.3, 0.3], [1_700, 0.4, 0.4]]),
]


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


class CombineParticipantsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        self.inputs = self.tmp / "in"
        (self.inputs / "device2").mkdir(parents=True)
        complete = participant("p-a", created=1, events=EVENTS)
        partial = participant("p-a", created=1, events=EVENTS)
        del partial["answers"]["tlx-treemap_2"]
        (self.inputs / "a.json").write_text(json.dumps(partial))
        (self.inputs / "a (1).json").write_text(json.dumps(complete))
        (self.inputs / "device2" / "b.json").write_text(json.dumps(participant("p-b", created=2, events=[], answer="Skip", finished=False)))
        (self.inputs / "notes.json").write_text(json.dumps({"hello": 1}))
        (self.inputs / "broken.json").write_text("{not json")
        self.assertEqual(combine.main([str(self.inputs), "--out", str(self.tmp / "out")]), 0)
        self.out = self.tmp / "out"

    def test_replay_marks_statuses(self) -> None:
        self.assertEqual(combine.replay_marks(EVENTS), {
            0: ("cleared", 1_500),
            1: ("undone", 1_300),
            3: ("cleared", 1_500),
            5: ("kept", None),
        })

    def test_duplicates_keep_most_complete_and_skip_non_participants(self) -> None:
        rows = read_csv(self.out / "participants.csv")
        self.assertEqual([row["participant_id"] for row in rows], ["p-a", "p-b"])
        self.assertTrue(rows[0]["source_file"].endswith("a (1).json"))

    def test_trials(self) -> None:
        a, b = read_csv(self.out / "trials.csv")
        self.assertEqual((a["item"], a["position"], a["correct"], a["skipped"]), ("treemap", "1", "True", "False"))
        self.assertEqual((a["marks_drawn"], a["marks_kept"]), ("4", "1"))
        self.assertEqual((a["baseline_actual_ms"], a["tlx_raw_mean"], a["graph_duration_ms"]), ("5002", "30.0", "1500"))
        self.assertEqual((b["completed"], b["skipped"], b["correct"], b["tlx_raw_mean"]), ("False", "True", "False", ""))

    def test_marks_and_points(self) -> None:
        marks = [row for row in read_csv(self.out / "annotation_marks.csv") if row["participant_id"] == "p-a"]
        self.assertEqual([row["status"] for row in marks], ["cleared", "undone", "cleared", "kept"])
        self.assertEqual(marks[1]["ms_since_graph_start"], "200")
        points = [row for row in read_csv(self.out / "annotation_points.csv") if row["mark"] == "2"]
        self.assertEqual([row["in_image"] for row in points], ["True", "False"])
        self.assertEqual((points[1]["screen_x"], points[1]["screen_y"]), ("520.0", "110.0"))


if __name__ == "__main__":
    unittest.main()
