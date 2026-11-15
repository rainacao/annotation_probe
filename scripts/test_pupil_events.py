"""Tests for pupil_events.py on synthetic gaze.

Run: uv run --with msgpack --with numpy python -m unittest scripts/test_pupil_events.py
"""

from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import pupil_events

RATE = 250.0


def gaze_at(t: float, deg: float, confidence: float = 1.0) -> dict:
    """A binocular gaze sample looking `deg` degrees to the right of straight ahead."""
    rad = math.radians(deg)
    return {"topic": "gaze.3d.01.", "timestamp": t, "confidence": confidence, "gaze_point_3d": (500 * math.sin(rad), 0.0, 500 * math.cos(rad))}


def trace(points: list[float], confidence: list[float] | None = None) -> list[dict]:
    return [gaze_at(i / RATE, deg, 1.0 if confidence is None else confidence[i]) for i, deg in enumerate(points)]


def detect(gaze: list[dict]) -> list[tuple[float, float, float]]:
    return pupil_events.detect_saccades(gaze, min_confidence=0.85, threshold=30.0, span=2, min_ms=8.0, min_amplitude=1.0)


class DetectSaccadesTest(unittest.TestCase):
    def test_one_jump_between_fixations_is_one_saccade(self) -> None:
        # 200 ms at 0 deg, a 10 deg jump over 20 ms (500 deg/s), 200 ms at 10 deg.
        points = [0.0] * 50 + [i * 2.0 for i in range(1, 6)] + [10.0] * 50
        saccades = detect(trace(points))
        self.assertEqual(len(saccades), 1)
        self.assertGreater(saccades[0][2], 100)

    def test_small_jitter_is_not_a_saccade(self) -> None:
        # Fast but tiny (0.3 deg) movements: above the speed threshold, below the amplitude threshold.
        points = [0.3 * (i % 2) for i in range(200)]
        self.assertEqual(detect(trace(points)), [])

    def test_jump_next_to_a_blink_is_dropped(self) -> None:
        points = [0.0] * 50 + [i * 2.0 for i in range(1, 6)] + [10.0] * 50
        confidence = [1.0] * 52 + [0.0] * 3 + [1.0] * 50
        self.assertEqual(detect(trace(points, confidence)), [])


class MergeFixationsTest(unittest.TestCase):
    def test_back_to_back_pieces_merge_but_separate_fixations_do_not(self) -> None:
        def fixation(start: float, deg: float) -> dict:
            return {"timestamp": start, "duration": 300.0, "gaze_point_3d": gaze_at(0, deg)["gaze_point_3d"]}
        # Two capped pieces of one fixation at 0 deg, then a separate fixation at 5 deg after a gap.
        fixations = [fixation(0.0, 0.0), fixation(0.3, 0.2), fixation(0.7, 5.0)]
        self.assertEqual(pupil_events.merge_fixations(fixations, max_dispersion=1.0, sample_s=1.5 / RATE), 2)


if __name__ == "__main__":
    unittest.main()
