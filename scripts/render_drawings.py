# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow>=10"]
# ///
"""Render each participant's final drawing on each graph as a PNG.

Usage:
    uv run scripts/render_drawings.py <folder-or-json> [...] --out <output-folder>

Writes <out>/<participant_id>/<position>-<item>.png: the graph with the participant's kept
marks drawn on top, on the white drawable area and neutral-grey surround the participant saw,
cropped to the graph plus any marks outside it. Trials with no kept marks get no PNG.
Reads the same participant files as combine_participants.py, in either graph format
(`drawing` or `annotationEvents`). Graph images are downloaded once and cached in <out>/.images.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import sys
import urllib.request
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))

import combine_participants as combine

PUBLIC = Path(__file__).resolve().parent.parent / "public"
STUDY_GREY = (128, 128, 128)
WHITE = (255, 255, 255)
STROKE_COLOR = (17, 17, 17)
# Matches the study: the pen draws ~4.5 CSS px wide, and the white area extends 24 CSS px past the graph.
STROKE_WIDTH_CSS_PX = 4.5
MARGIN_CSS_PX = 24


def on_white(image: Image.Image) -> Image.Image:
    """Flatten transparency onto white, as the graph appears on the study's white drawable area."""
    rgba = image.convert("RGBA")
    background = Image.new("RGBA", rgba.size, (*WHITE, 255))
    return Image.alpha_composite(background, rgba).convert("RGB")


def load_image(url: str, cache: Path) -> Image.Image:
    """Graph image from a URL (cached) or a path under public/."""
    if not url.startswith(("http://", "https://")):
        return on_white(Image.open(PUBLIC / url.lstrip("/")))
    cache.mkdir(parents=True, exist_ok=True)
    cached = cache / (hashlib.sha256(url.encode()).hexdigest()[:16] + Path(url).suffix)
    if not cached.exists():
        with urllib.request.urlopen(url, timeout=30) as response:
            cached.write_bytes(response.read())
    return on_white(Image.open(io.BytesIO(cached.read_bytes())))


def trial_marks(graph_answer: dict[str, Any]) -> list[dict[str, Any]]:
    if isinstance(graph_answer.get("drawing"), dict) and graph_answer["drawing"].get("image"):
        return combine.marks_from_drawing(graph_answer["drawing"])
    return combine.marks_from_events(graph_answer.get("annotationEvents") or [])


def render(graph: Image.Image, marks: list[dict[str, Any]], image_css_width: float) -> Image.Image:
    """Draw marks (points as fractions of the graph) at the graph's native resolution."""
    width, height = graph.size
    scale = width / image_css_width  # image px per CSS px the participant saw
    margin = MARGIN_CSS_PX * scale
    strokes = [[(x * width, y * height) for _, x, y in mark["points"]] for mark in marks]
    xs = [x for stroke in strokes for x, _ in stroke]
    ys = [y for stroke in strokes for _, y in stroke]
    pad = margin + STROKE_WIDTH_CSS_PX * scale
    left = min([-margin, *xs]) - pad
    top = min([-margin, *ys]) - pad
    right = max([width + margin, *xs]) + pad
    bottom = max([height + margin, *ys]) + pad

    canvas = Image.new("RGB", (round(right - left), round(bottom - top)), STUDY_GREY)
    draw = ImageDraw.Draw(canvas)
    draw.rectangle([-margin - left, -margin - top, width + margin - left, height + margin - top], fill=WHITE)
    canvas.paste(graph, (round(-left), round(-top)))
    line_width = max(1, round(STROKE_WIDTH_CSS_PX * scale))
    for stroke in strokes:
        points = [(x - left, y - top) for x, y in stroke]
        if len(points) > 1:
            draw.line(points, fill=STROKE_COLOR, width=line_width, joint="curve")
        for x, y in (points[0], points[-1]):
            draw.ellipse([x - line_width / 2, y - line_width / 2, x + line_width / 2, y + line_width / 2], fill=STROKE_COLOR)
    return canvas


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("inputs", nargs="+", help="participant .json files or folders containing them")
    parser.add_argument("--out", required=True, type=Path, help="folder to write the PNGs into")
    args = parser.parse_args(argv)

    participants = combine.load_participants(combine.find_json_files(args.inputs))
    if not participants:
        combine.warn("no participant files found")
        return 1
    written = skipped = 0
    for participant_id, (_, data) in participants.items():
        graphs = [answer for answer in data["answers"].values() if answer.get("componentName", "").startswith("graph-")]
        for position, answer in enumerate(sorted(graphs, key=lambda answer: int(answer["trialOrder"])), start=1):
            _, item = combine.split_component(answer["componentName"])
            graph_answer = answer.get("answer") or {}
            kept = [mark for mark in trial_marks(graph_answer) if mark["status"] == "kept" and mark["points"]]
            if not kept:
                skipped += 1
                continue
            image_url = answer.get("parameters", {}).get("imageUrl")
            if not image_url:
                combine.warn(f"participant {participant_id}, {item}: no imageUrl; skipped")
                continue
            png = render(load_image(image_url, args.out / ".images"), kept, kept[0]["image"][2])
            path = args.out / participant_id / f"{position:02d}-{item}.png"
            path.parent.mkdir(parents=True, exist_ok=True)
            png.save(path)
            written += 1
    print(f"{written} PNGs written to {args.out}; {skipped} trials had no kept marks")
    return 0


if __name__ == "__main__":
    sys.exit(main())
