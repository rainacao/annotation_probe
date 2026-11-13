# /// script
# requires-python = ">=3.11"
# ///
"""Turn the fixation baseline and NASA-TLX steps of every item on or off in the study config.

Each item block in `sequence` is rebuilt as fixation-<key> -> graph-<key> -> tlx-<key>, keeping
only the steps that are on. Component definitions are never removed, so steps can be turned back on.

Usage:
    uv run scripts/set_trial_steps.py                       # show the current setting
    uv run scripts/set_trial_steps.py --no-tlx              # fixation on (unchanged), TLX off
    uv run scripts/set_trial_steps.py --fixation --tlx      # both on
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

CONFIG = Path(__file__).resolve().parent.parent / "public" / "annotation-probe" / "config.json"
OPTIONAL_STEPS = ("fixation", "tlx")


def item_blocks(config: dict[str, Any]) -> list[dict[str, Any]]:
    """Sequence blocks that hold one item's steps, identified by their graph-<key> component."""
    return [
        block for block in config["sequence"]["components"]
        if isinstance(block, dict) and f"graph-{block.get('id')}" in block.get("components", [])
    ]


def current_steps(config: dict[str, Any]) -> dict[str, bool | None]:
    """Each optional step -> True/False if it is on/off for every item, None if items differ."""
    blocks = item_blocks(config)
    states: dict[str, bool | None] = {}
    for step in OPTIONAL_STEPS:
        present = {f"{step}-{block['id']}" in block["components"] for block in blocks}
        states[step] = present.pop() if len(present) == 1 else None
    return states


def set_steps(config: dict[str, Any], *, fixation: bool, tlx: bool) -> None:
    enabled = {"fixation": fixation, "graph": True, "tlx": tlx}
    for block in item_blocks(config):
        key = block["id"]
        for step, on in enabled.items():
            if on and f"{step}-{key}" not in config["components"]:
                raise SystemExit(f"error: component {step}-{key} is not defined in {CONFIG.name}")
        block["components"] = [f"{step}-{key}" for step, on in enabled.items() if on]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--fixation", action=argparse.BooleanOptionalAction, help="fixation baseline before each graph")
    parser.add_argument("--tlx", action=argparse.BooleanOptionalAction, help="NASA-TLX after each graph")
    parser.add_argument("--config", type=Path, default=CONFIG, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)

    config = json.loads(args.config.read_text(encoding="utf-8"))
    before = current_steps(config)
    if args.fixation is not None or args.tlx is not None:
        set_steps(
            config,
            fixation=args.fixation if args.fixation is not None else before["fixation"] is not False,
            tlx=args.tlx if args.tlx is not None else before["tlx"] is not False,
        )
        args.config.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    after = current_steps(config)
    labels = {True: "on", False: "off", None: "mixed"}
    print(", ".join(f"{step}: {labels[after[step]]}" for step in OPTIONAL_STEPS))
    return 0


if __name__ == "__main__":
    sys.exit(main())
