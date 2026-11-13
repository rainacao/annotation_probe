# /// script
# requires-python = ">=3.11"
# ///
"""Combine reVISit participant JSON downloads into analysis-ready CSV tables.

Usage:
    uv run scripts/combine_participants.py <folder-or-json> [...] --out <output-folder>

Each item is the trio fixation-<item> -> graph-<item> -> tlx-<item> (see SPEC.md). Writes:
    participants.csv       one row per participant (device, screen, completion)
    trials.csv             one row per participant x item: timing, answer, correctness,
                           fixation baseline, NASA-TLX, and mark counts
    annotation_marks.csv   one row per drawn mark, with whether it was kept or removed
    annotation_points.csv  one row per point, in image fractions and viewport CSS px

Marks are read from either graph response format: the Excalidraw scene (`drawing`, from
ExcalidrawTrial.tsx) or the pointer event log (`annotationEvents`, from AnnotationTrial.tsx).

Files that are not participant data are skipped with a warning. If the same participant
appears in several files (e.g. repeated downloads), the copy with the most answers is kept.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections.abc import Iterable
from pathlib import Path
from typing import Any

TLX_SCALES = ["mental-demand", "physical-demand", "temporal-demand", "performance", "effort", "frustration"]
SKIP_ANSWER = "Skip"


def warn(message: str) -> None:
    print(f"warning: {message}", file=sys.stderr)


def find_json_files(inputs: Iterable[str]) -> list[Path]:
    files: list[Path] = []
    for raw in inputs:
        path = Path(raw)
        if path.is_dir():
            files.extend(sorted(path.rglob("*.json")))
        elif path.suffix == ".json":
            files.append(path)
        else:
            warn(f"{path} is not a folder or .json file; skipped")
    return files


def load_participants(files: list[Path]) -> dict[str, tuple[Path, dict[str, Any]]]:
    """Map participantId -> (source file, data), keeping the most complete copy of duplicates."""
    participants: dict[str, tuple[Path, dict[str, Any]]] = {}
    for path in files:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            warn(f"{path}: could not read JSON ({error}); skipped")
            continue
        if not isinstance(data, dict) or "participantId" not in data or not isinstance(data.get("answers"), dict):
            warn(f"{path}: not a reVISit participant file; skipped")
            continue
        participant_id = data["participantId"]
        existing = participants.get(participant_id)
        if existing is None:
            participants[participant_id] = (path, data)
            continue
        keep, drop = (path, existing[0]) if len(data["answers"]) > len(existing[1]["answers"]) else (existing[0], path)
        if keep == path:
            participants[participant_id] = (path, data)
        warn(f"participant {participant_id} is in both {keep} and {drop}; using {keep}")
    return participants


def is_completed(answer: dict[str, Any]) -> bool:
    return answer.get("endTime", -1) > 0


def split_component(component_name: str) -> tuple[str, str]:
    """'graph-treemap' -> ('graph', 'treemap')."""
    kind, _, item = component_name.partition("-")
    return kind, item


def replay_marks(events: list[Any]) -> dict[int, tuple[str, int | None]]:
    """Map each draw event's index -> (status, time removed) by replaying undo/clear events."""
    status: dict[int, tuple[str, int | None]] = {}
    visible: list[int] = []
    for index, (time, action, data) in enumerate(events):
        if action == "draw":
            status[index] = ("kept", None)
            visible.append(index)
        elif action == "undo" and data in visible:
            visible.remove(data)
            status[data] = ("undone", time)
        elif action == "clear":
            for removed in data:
                if removed in visible:
                    visible.remove(removed)
                    status[removed] = ("cleared", time)
    return status


def marks_from_events(events: list[Any]) -> list[dict[str, Any]]:
    """Marks from AnnotationTrial's annotationEvents log; points carry their own timestamps."""
    statuses = replay_marks(events)
    marks = []
    for event_index in sorted(statuses):
        start, _, mark = events[event_index]
        status, removed_at = statuses[event_index]
        marks.append({
            "mark_id": event_index,
            "start": start,
            "end": mark["end"],
            "status": status,
            "removed_at": removed_at,
            "image": mark["image"],
            "points": [tuple(point) for point in mark["points"]],
        })
    return marks


def marks_from_drawing(scene: dict[str, Any]) -> list[dict[str, Any]]:
    """Marks from ExcalidrawTrial's scene. Element coordinates are CSS px from the stage's top-left
    (the view is locked), drawn against `image` (stage-relative); points have no timestamps.
    Marks removed by undo or clear are only in markTimes, so their points are not available."""
    image_left, image_top, width, height = scene["image"]
    stage_left, stage_top = scene["stage"][:2]
    viewport_image = [round(stage_left + image_left, 1), round(stage_top + image_top, 1), width, height]
    elements = {element["id"]: element for element in scene.get("elements", []) if element.get("type") == "freedraw"}
    times = scene.get("markTimes") or {}
    marks = []
    for mark_id in sorted(set(times) | set(elements), key=lambda key: times.get(key, {}).get("start", 0)):
        element = elements.get(mark_id)
        timing = times.get(mark_id, {})
        if element is None:
            status, points = "removed", []
        else:
            status = "erased" if element.get("isDeleted") else "kept"
            points = [
                (None, round((element["x"] + px - image_left) / width, 4), round((element["y"] + py - image_top) / height, 4))
                for px, py in element["points"]
            ]
        marks.append({
            "mark_id": mark_id,
            "start": timing.get("start"),
            "end": timing.get("end"),
            "status": status,
            "removed_at": timing.get("erasedAt"),
            "image": viewport_image,
            "points": points,
        })
    return marks


def build_tables(participants: dict[str, tuple[Path, dict[str, Any]]]) -> dict[str, list[dict[str, Any]]]:
    tables: dict[str, list[dict[str, Any]]] = {
        "participants": [],
        "trials": [],
        "annotation_marks": [],
        "annotation_points": [],
    }
    for participant_id, (path, data) in sorted(participants.items(), key=lambda entry: entry[1][1].get("createdTime") or 0):
        answers: dict[str, dict[str, Any]] = data["answers"]
        metadata = data.get("metadata") or {}
        resolution = metadata.get("resolution") or {}
        by_item: dict[str, dict[str, dict[str, Any]]] = {}
        for answer in answers.values():
            kind, item = split_component(answer.get("componentName", ""))
            if kind in {"fixation", "graph", "tlx"} and item:
                by_item.setdefault(item, {})[kind] = answer

        tables["participants"].append({
            "participant_id": participant_id,
            "source_file": str(path),
            "participant_index": data.get("participantIndex"),
            "created_time": data.get("createdTime"),
            "completed": bool(data.get("finalized")),
            "items_answered": sum(1 for trio in by_item.values() if "graph" in trio and is_completed(trio["graph"])),
            "rejected": bool(data.get("rejected")),
            "screen_width": resolution.get("width"),
            "screen_height": resolution.get("height"),
            "user_agent": metadata.get("userAgent"),
            "language": metadata.get("language"),
        })

        # Items in the order this participant saw them.
        def first_trial_order(trio: dict[str, dict[str, Any]]) -> int:
            return min(int(answer["trialOrder"]) for answer in trio.values())

        ordered_items = sorted(by_item.items(), key=lambda entry: first_trial_order(entry[1]))
        for position, (item, trio) in enumerate(ordered_items, start=1):
            graph = trio.get("graph", {})
            fixation = trio.get("fixation", {})
            tlx = trio.get("tlx", {})
            graph_answer = graph.get("answer", {})
            response = graph_answer.get("answer")
            correct_answer = next((entry.get("answer") for entry in graph.get("correctAnswer", []) if entry.get("id") == "answer"), None)
            if isinstance(graph_answer.get("drawing"), dict) and graph_answer["drawing"].get("image"):
                marks = marks_from_drawing(graph_answer["drawing"])
            else:
                marks = marks_from_events(graph_answer.get("annotationEvents") or [])
            if graph_answer.get("annotation") is not None:
                warn(f"participant {participant_id}, {item}: old 'annotation' format is not parsed")
            baseline = fixation.get("answer", {}).get("baseline") or {}
            tlx_values = tlx.get("answer", {}) if is_completed(tlx) else {}
            tlx_scores = [tlx_values[scale] for scale in TLX_SCALES if isinstance(tlx_values.get(scale), (int, float))]

            tables["trials"].append({
                "participant_id": participant_id,
                "item": item,
                "position": position,
                "completed": is_completed(graph),
                "graph_start": graph.get("startTime"),
                "graph_end": graph.get("endTime"),
                "graph_duration_ms": graph["endTime"] - graph["startTime"] if is_completed(graph) else None,
                "answer": response,
                "correct_answer": correct_answer,
                "correct": None if response is None or correct_answer is None else response == correct_answer,
                "skipped": response == SKIP_ANSWER,
                "marks_drawn": len(marks),
                "marks_kept": sum(1 for mark in marks if mark["status"] == "kept"),
                "baseline_cross_shown": baseline.get("crossShownAt"),
                "baseline_cross_hidden": baseline.get("crossHiddenAt"),
                "baseline_duration_ms": baseline.get("durationMs"),
                # Configured duration vs what actually happened; browsers delay timers in background tabs.
                "baseline_actual_ms": baseline["crossHiddenAt"] - baseline["crossShownAt"] if "crossHiddenAt" in baseline else None,
                **{f"tlx_{scale.replace('-', '_')}": tlx_values.get(scale) for scale in TLX_SCALES},
                "tlx_raw_mean": sum(tlx_scores) / len(tlx_scores) if len(tlx_scores) == len(TLX_SCALES) else None,
                "image_url": graph.get("parameters", {}).get("imageUrl"),
            })

            for mark_number, mark in enumerate(marks, start=1):
                start, status = mark["start"], mark["status"]
                left, top, width, height = mark["image"]
                tables["annotation_marks"].append({
                    "participant_id": participant_id,
                    "item": item,
                    "mark": mark_number,
                    "mark_id": mark["mark_id"],
                    "start": start,
                    "end": mark["end"],
                    "duration_ms": mark["end"] - start if start is not None and mark["end"] is not None else None,
                    "ms_since_graph_start": start - graph["startTime"] if start is not None and graph.get("startTime") else None,
                    "n_points": len(mark["points"]),
                    "status": status,
                    "removed_at": mark["removed_at"],
                    "image_left": left,
                    "image_top": top,
                    "image_width": width,
                    "image_height": height,
                })
                for point_number, (t, x, y) in enumerate(mark["points"], start=1):
                    tables["annotation_points"].append({
                        "participant_id": participant_id,
                        "item": item,
                        "mark": mark_number,
                        "point": point_number,
                        "t": t,
                        "x": x,
                        "y": y,
                        "in_image": 0 <= x <= 1 and 0 <= y <= 1,
                        "screen_x": round(left + x * width, 1),
                        "screen_y": round(top + y * height, 1),
                        "status": status,
                    })
    return tables


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("inputs", nargs="+", help="participant .json files or folders containing them")
    parser.add_argument("--out", required=True, type=Path, help="folder to write the CSV files into")
    args = parser.parse_args(argv)

    participants = load_participants(find_json_files(args.inputs))
    if not participants:
        warn("no participant files found")
        return 1
    tables = build_tables(participants)
    args.out.mkdir(parents=True, exist_ok=True)
    for name, rows in tables.items():
        write_csv(args.out / f"{name}.csv", rows)
        print(f"{name}.csv: {len(rows)} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
