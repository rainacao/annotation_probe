"""Tests for render_drawings.py on a synthetic participant file and graph image.

Run: uv run --with pillow python -m unittest scripts/test_render_drawings.py
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))

import render_drawings as render


def graph_answer(order: int, item: str, image: Path, elements: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "componentName": f"graph-{item}", "trialOrder": str(order), "startTime": 0, "endTime": 1,
        "parameters": {"imageUrl": f"http://example.test/{image.name}"},
        "answer": {"answer": "x", "drawing": {
            # Shown at half the image's native size (100 CSS px wide, 50 tall), 24 px from the stage edge.
            "image": [24.0, 24.0, 100.0, 50.0], "stage": [0.0, 0.0, 148.0, 98.0],
            "elements": elements, "markTimes": {element["id"]: {"start": 0, "end": 1} for element in elements},
        }},
    }


class RenderDrawingsTest(unittest.TestCase):
    def test_writes_png_only_for_trials_with_kept_marks(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        image = tmp / "graph.png"
        Image.new("RGB", (200, 100), (0, 200, 0)).save(image)
        kept = {"id": "a", "type": "freedraw", "x": 24.0, "y": 49.0, "points": [[0, 0], [100, 0]], "isDeleted": False}
        erased = {**kept, "id": "b", "isDeleted": True}
        data = {"participantId": "p1", "answers": {
            "graph-one_0": graph_answer(0, "one", image, [kept]),
            "graph-two_1": graph_answer(1, "two", image, [erased]),
            "graph-three_2": graph_answer(2, "three", image, []),
        }}
        (tmp / "in").mkdir()
        (tmp / "in" / "p1.json").write_text(json.dumps(data))
        # Pre-fill the image cache so the test needs no network.
        cache = tmp / "out" / ".images"
        cache.mkdir(parents=True)
        url = data["answers"]["graph-one_0"]["parameters"]["imageUrl"]
        cached = cache / (render.hashlib.sha256(url.encode()).hexdigest()[:16] + ".png")
        cached.write_bytes(image.read_bytes())

        self.assertEqual(render.main([str(tmp / "in"), "--out", str(tmp / "out")]), 0)
        self.assertEqual(sorted(path.name for path in (tmp / "out" / "p1").iterdir()), ["01-one.png"])

        png = Image.open(tmp / "out" / "p1" / "01-one.png").convert("RGB")
        # At 2 image px per CSS px, the graph is surrounded by the white margin plus a padding of margin + stroke width.
        margin = round(2 * (2 * render.MARGIN_CSS_PX + render.STROKE_WIDTH_CSS_PX))
        self.assertEqual(png.size, (200 + 2 * margin, 100 + 2 * margin))
        self.assertEqual(png.getpixel((margin + 100, margin + 50)), render.STROKE_COLOR)  # the stroke crosses the middle
        self.assertEqual(png.getpixel((margin + 100, margin + 10)), (0, 200, 0))  # graph elsewhere
        self.assertEqual(png.getpixel((1, 1)), render.STUDY_GREY)


if __name__ == "__main__":
    unittest.main()
