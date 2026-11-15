# /// script
# requires-python = ">=3.11"
# dependencies = ["msgpack", "numpy"]
# ///
"""Count fixations and saccades per trial in a Pupil Core recording, using a reVISit participant file for trial times.

Trial windows: each answer's startTime -> endTime (epoch ms on the study device), converted to Pupil time with
the recording's info.player.json (start_time_system_s - start_time_synced_s). This assumes the study device's and
the Pupil computer's clocks agree; check by comparing a few screen changes in the scene video.

Fixations: Pupil Player's offline fixation detector output (offline_data/fixations.pldata), with whatever settings
were used in Player (printed). A fixation counts toward the trial its start falls in. Pupil's detector ends a
fixation at max_duration, so one long fixation can be reported as several; `fixations_capped` counts those that hit
the cap, and `fixations_merged` joins back-to-back pieces (next starts within one gaze sample of the previous end and
its centre is within max_dispersion of the previous one).

Saccades: Pupil Core has no saccade detector, so this uses velocity thresholding (I-VT) on binocular 3D gaze
(topic gaze.3d.01., confidence >= --min-confidence): angular speed of the gaze direction between samples
--velocity-span apart, samples above --velocity-threshold deg/s grouped into events, events shorter than
--min-saccade-ms or moving gaze less than --min-amplitude (default: Player's max_dispersion) dropped. Events next to a low-confidence gap (blinks, tracking loss) are dropped.

Usage:
    uv run scripts/pupil_events.py ~/recordings/2026_11_14/003 "~/Downloads/<participant>.json" --out results/003_events.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any

import msgpack
import numpy as np


def load_pldata(path: Path) -> list[dict[str, Any]]:
    out = []
    with path.open("rb") as f:
        for _topic, payload in msgpack.Unpacker(f, raw=False, use_list=False):
            out.append(msgpack.unpackb(payload, raw=False, use_list=False))
    return out


def clock_offset(recording: Path) -> float:
    """Seconds to subtract from epoch seconds to get Pupil time."""
    info = json.loads((recording / "info.player.json").read_text())
    return info["start_time_system_s"] - info["start_time_synced_s"]


def trial_windows(participant: dict[str, Any], offset: float, prefix: str) -> list[tuple[str, str, float, float]]:
    """(identifier, component name, start, end) per matching answer, in Pupil time. The identifier
    (`<component>_<position>`) tells repeated components apart, e.g. each validation break."""
    rows = []
    for key, answer in participant["answers"].items():
        if answer.get("componentName", key).startswith(prefix) and answer.get("startTime") and answer.get("endTime"):
            rows.append((answer.get("identifier", key), answer.get("componentName", key),
                         answer["startTime"] / 1000 - offset, answer["endTime"] / 1000 - offset))
    return sorted(rows, key=lambda row: row[2])


def angle_deg(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    a = a / np.linalg.norm(a, axis=1, keepdims=True)
    b = b / np.linalg.norm(b, axis=1, keepdims=True)
    return np.degrees(np.arccos(np.clip((a * b).sum(axis=1), -1, 1)))


def detect_saccades(gaze: list[dict[str, Any]], *, min_confidence: float, threshold: float, span: int,
                    min_ms: float, min_amplitude: float) -> list[tuple[float, float, float]]:
    """Returns (start, end, peak deg/s) per saccade, in Pupil time."""
    samples = [g for g in gaze if g["topic"].startswith("gaze.3d.01")]
    t = np.array([g["timestamp"] for g in samples])
    good = np.array([g["confidence"] >= min_confidence for g in samples])
    direction = np.array([g["gaze_point_3d"] for g in samples], dtype=float)
    t, good, direction = t[np.argsort(t)], good[np.argsort(t)], direction[np.argsort(t)]
    # Speed at sample i from samples i-span and i+span; undefined if either end is low confidence.
    speed = np.full(len(t), np.nan)
    lo, hi = np.arange(len(t) - 2 * span), np.arange(2 * span, len(t))
    ok = good[lo] & good[hi]
    speed[lo + span] = np.where(ok, angle_deg(direction[lo], direction[hi]) / (t[hi] - t[lo]), np.nan)
    fast = np.nan_to_num(speed, nan=0) > threshold
    saccades = []
    i = 0
    while i < len(t):
        if not fast[i]:
            i += 1
            continue
        j = i
        while j + 1 < len(t) and fast[j + 1]:
            j += 1
        neighbours_valid = i > 0 and j + 1 < len(t) and not np.isnan(speed[i - 1]) and not np.isnan(speed[j + 1])
        # Amplitude: gaze direction just before vs. just after the fast samples.
        before, after = max(0, i - span), min(len(t) - 1, j + span)
        amplitude = angle_deg(direction[[before]], direction[[after]])[0]
        if neighbours_valid and (t[j] - t[i]) * 1000 >= min_ms and amplitude >= min_amplitude:
            saccades.append((float(t[i]), float(t[j]), float(np.nanmax(speed[i:j + 1]))))
        i = j + 1
    return saccades


def merge_fixations(fixations: list[dict[str, Any]], max_dispersion: float, sample_s: float) -> int:
    """Number of fixations after joining back-to-back pieces of one long fixation."""
    merged = 0
    previous: dict[str, Any] | None = None
    for fixation in fixations:
        if previous is not None:
            gap = fixation["timestamp"] - (previous["timestamp"] + previous["duration"] / 1000)
            apart = angle_deg(np.array([previous["gaze_point_3d"]], dtype=float), np.array([fixation["gaze_point_3d"]], dtype=float))[0]
            if gap <= sample_s and apart <= max_dispersion:
                previous = fixation
                continue
        merged += 1
        previous = fixation
    return merged


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("recording", type=Path, help="Pupil Capture recording folder (with offline_data from Player)")
    parser.add_argument("participant", type=Path, help="reVISit participant JSON for the same session")
    parser.add_argument("--prefix", default="graph-", help="component name prefix of the trials to report (default graph-)")
    parser.add_argument("--out", type=Path, help="CSV to write (one row per trial)")
    parser.add_argument("--min-confidence", type=float, help="gaze confidence for saccades (default: Player's fixation setting)")
    parser.add_argument("--velocity-threshold", type=float, default=30.0, help="I-VT threshold, deg/s (default 30)")
    parser.add_argument("--velocity-span", type=int, default=2, help="samples on each side for the speed estimate (default 2)")
    parser.add_argument("--min-saccade-ms", type=float, default=8.0, help="drop shorter saccades (default 8 ms)")
    parser.add_argument("--min-amplitude", type=float, help="drop saccades that move gaze less than this, deg "
                        "(default: Player's fixation max_dispersion, so noise inside a fixation is not a saccade)")
    args = parser.parse_args(argv)

    recording = args.recording.expanduser()
    meta = msgpack.unpackb((recording / "offline_data" / "fixations.meta").read_bytes(), raw=False)["config"]
    fixations = sorted(load_pldata(recording / "offline_data" / "fixations.pldata"), key=lambda f: f["timestamp"])
    gaze = load_pldata(recording / "gaze.pldata")
    min_confidence = args.min_confidence if args.min_confidence is not None else meta["min_data_confidence"]
    gaze_t = np.sort(np.array([g["timestamp"] for g in gaze]))
    sample_s = float(np.median(np.diff(gaze_t)))
    min_amplitude = args.min_amplitude if args.min_amplitude is not None else meta["max_dispersion"]
    saccades = detect_saccades(gaze, min_confidence=min_confidence, threshold=args.velocity_threshold,
                               span=args.velocity_span, min_ms=args.min_saccade_ms, min_amplitude=min_amplitude)
    participant = json.loads(args.participant.expanduser().read_text())
    windows = trial_windows(participant, clock_offset(recording), args.prefix)

    print(f"Player fixation settings: max_dispersion {meta['max_dispersion']:.2f} deg, duration {meta['min_duration']}-{meta['max_duration']} ms, "
          f"min confidence {meta['min_data_confidence']:.2f}; {len(fixations)} fixations in the recording")
    print(f"Saccades (I-VT): {args.velocity_threshold:g} deg/s, span {args.velocity_span}, >= {args.min_saccade_ms:g} ms, "
          f"amplitude >= {min_amplitude:.2f} deg, confidence >= {min_confidence:.2f}; {len(saccades)} in the recording")
    rows = []
    for identifier, name, start, end in windows:
        inside = [f for f in fixations if start <= f["timestamp"] < end]
        in_window = [g for g in gaze if start <= g["timestamp"] < end]
        valid = sum(g["confidence"] >= min_confidence for g in in_window) / max(1, len(in_window))
        rows.append({
            "trial": name,
            "position": identifier.rpartition("_")[2],
            "duration_s": round(end - start, 2),
            "fixations": len(inside),
            "fixations_capped": sum(f["duration"] >= meta["max_duration"] - 2 for f in inside),
            "fixations_merged": merge_fixations(inside, meta["max_dispersion"], 1.5 * sample_s),
            "fixation_time_s": round(sum(f["duration"] for f in inside) / 1000, 2),
            "saccades": sum(start <= s < end for s, _e, _p in saccades),
            "valid_gaze_pct": round(100 * valid, 1),
        })
    columns = list(rows[0]) if rows else []
    print(" ".join(c.rjust(max(len(c), 8)) for c in columns))
    for row in rows:
        print(" ".join(str(row[c]).rjust(max(len(c), 8)) for c in columns))
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        with args.out.open("w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=columns)
            writer.writeheader()
            writer.writerows(rows)
        print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
