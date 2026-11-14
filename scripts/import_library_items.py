# /// script
# requires-python = ">=3.11"
# ///
"""Build a study config from a reVISit library's image-question items.

Each library item becomes the trio fixation-<item> -> graph-<item> -> tlx-<item> (see SPEC.md): the
library's image on our drawing trial, with the item's question as the answer prompt and its options
and correct answer copied exactly. The sequence mirrors one of the library's own sequences, including
any nested random draws. Shared settings (uiConfig and the fixation, graph, and nasa-tlx base
components) are copied from a template config, so the new study has its own copy of each. The
template's opening pages (the components listed by name before its first item, e.g. consent and
introduction) are copied too and shown first, in the same order.

Usage:
    uv run scripts/import_library_items.py calvi --sequence full --study-id calvi-annotation \\
        --title "CALVI Annotation Study" --out public/annotation-probe/calvi-config.json

The library config is read from revisit-studies/study at a pinned commit (--ref). Library time limits
(nextButtonDisableTime) are not copied. Fixation and NASA-TLX steps are generated and can then be turned
on or off with --fixation/--no-fixation and --tlx/--no-tlx (or later with set_trial_steps.py --config).
The study is registered in public/global.json under --study-id.
"""

from __future__ import annotations

import argparse
import copy
import json
import sys
import urllib.request
from datetime import date
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent))

import set_trial_steps

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
TEMPLATE = PUBLIC / "annotation-probe" / "config.json"
UPSTREAM = "https://raw.githubusercontent.com/revisit-studies/study"
# revisit-studies/study main on 2026-11-14.
DEFAULT_REF = "278db9d4f39feb7fed6b92e7fe857b45380f54ef"


def fetch_library(name: str, ref: str) -> dict[str, Any]:
    with urllib.request.urlopen(f"{UPSTREAM}/{ref}/public/libraries/{name}/config.json", timeout=30) as response:
        return json.load(response)


def image_url(path: str, ref: str) -> str:
    """Library image paths are either full URLs or relative to the upstream public/ folder."""
    return path if path.startswith(("http://", "https://")) else f"{UPSTREAM}/{ref}/public/{path.lstrip('/')}"


def convert_item(library: str, key: str, item: dict[str, Any], ref: str) -> dict[str, dict[str, Any]]:
    """One library item -> our fixation, graph, and tlx components."""
    responses = item.get("response", [])
    if item.get("type") != "image" or len(responses) != 1 or responses[0].get("type") != "radio":
        raise SystemExit(f"error: {library}.{key} is not an image with one radio question; not supported")
    response = responses[0]
    # Mini-VLAT puts the question in `instruction` (prompt "Your answer"); CALVI puts it in the prompt.
    question = item.get("instruction") or response["prompt"]
    answers = [answer["answer"] for answer in item.get("correctAnswer", []) if answer.get("id") == response["id"]]
    url = image_url(item["path"], ref)
    graph: dict[str, Any] = {
        "baseComponent": "graph",
        "meta": {
            "library": library, "item": key, **item.get("meta", {}),
            **({"title": item["description"]} if item.get("description") else {}),
        },
        "parameters": {"imageUrl": url},
        "response": [{"id": "answer", "type": "radio", "prompt": question, "options": response["options"]}],
    }
    if answers:
        graph["correctAnswer"] = [{"id": "answer", "answer": answers[0]}]
    return {
        f"fixation-{key}": {"baseComponent": "fixation", "parameters": {"imageUrl": url}},
        f"graph-{key}": graph,
        f"tlx-{key}": {"baseComponent": "nasa-tlx"},
    }


def convert_block(block: dict[str, Any], items: set[str]) -> dict[str, Any]:
    """A library sequence block -> ours: each item name becomes a fixed block of its three steps."""
    converted: dict[str, Any] = {key: value for key, value in block.items() if key in {"id", "order", "numSamples"}}
    children = []
    for child in block["components"]:
        if isinstance(child, str):
            items.add(child)
            children.append({"id": child, "order": "fixed", "components": [f"fixation-{child}", f"graph-{child}", f"tlx-{child}"]})
        else:
            children.append(convert_block(child, items))
    converted["components"] = children
    return converted


def build_config(library: str, library_config: dict[str, Any], sequence: str, template: dict[str, Any],
                 *, title: str, ref: str) -> dict[str, Any]:
    sequences = library_config.get("sequences", {})
    if sequence not in sequences:
        raise SystemExit(f"error: {library} has no sequence {sequence!r}; choose from {', '.join(sequences)}")
    items: set[str] = set()
    converted = convert_block(sequences[sequence], items)
    converted.pop("id", None)
    components: dict[str, Any] = {}
    # Opening pages (e.g. consent, then the introduction the participant starts from, so the first
    # fixation begins on their cue) come before the first item in the template's sequence.
    opening: list[str] = []
    for entry in template["sequence"]["components"]:
        if not isinstance(entry, str):
            break
        opening.append(entry)
        components[entry] = copy.deepcopy(template["components"][entry])
    if opening and converted.get("order") != "fixed":
        # A shuffled library sequence (e.g. CALVI specificBank) must not shuffle the opening pages, so
        # they go first in a fixed outer block and the library's items follow as one nested block.
        converted = {"order": "fixed", "components": [*opening, {"id": sequences[sequence].get("id", sequence), **converted}]}
    else:
        converted["components"][:0] = opening
    for key in library_config["components"]:
        if key in items:
            components.update(convert_item(library, key, library_config["components"][key], ref))
    reference = library_config.get("reference", "")
    return {
        "$schema": template["$schema"],
        "studyMetadata": {
            **template["studyMetadata"],
            "title": title,
            "date": date.today().isoformat(),
            "description": (
                f"{len(items)} items from the reVISit {library} library (sequence {sequence!r}) with multiple-choice "
                f"answers and drawing. Generated by scripts/import_library_items.py. {reference}"
            ).strip(),
        },
        "uiConfig": copy.deepcopy(template["uiConfig"]),
        "baseComponents": copy.deepcopy(template["baseComponents"]),
        "components": components,
        "sequence": converted,
    }


def register(study_id: str, config_path: Path) -> None:
    global_path = PUBLIC / "global.json"
    global_config = json.loads(global_path.read_text(encoding="utf-8"))
    if study_id not in global_config["configsList"]:
        global_config["configsList"].append(study_id)
    global_config["configs"][study_id] = {"path": config_path.resolve().relative_to(PUBLIC).as_posix()}
    global_path.write_text(json.dumps(global_config, indent=2) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("library", help="library folder name in revisit-studies/study public/libraries, e.g. calvi")
    parser.add_argument("--sequence", default="full", help="which of the library's sequences to use (default: full)")
    parser.add_argument("--study-id", required=True, help="ID to register in public/global.json; also the study URL path")
    parser.add_argument("--title", required=True, help="study title (also names downloaded participant files)")
    parser.add_argument("--out", required=True, type=Path, help="config file to write, under public/")
    parser.add_argument("--ref", default=DEFAULT_REF, help="revisit-studies/study commit to read the library from")
    parser.add_argument("--template", type=Path, default=TEMPLATE, help="config to copy uiConfig and base components from")
    parser.add_argument("--fixation", action=argparse.BooleanOptionalAction, default=True, help="fixation before each graph")
    parser.add_argument("--tlx", action=argparse.BooleanOptionalAction, default=True, help="NASA-TLX after each graph")
    parser.add_argument("--library-file", type=Path, help=argparse.SUPPRESS)  # local library config, for tests
    args = parser.parse_args(argv)

    if not args.out.resolve().is_relative_to(PUBLIC):
        raise SystemExit("error: --out must be inside public/ so reVISit can load it")
    library_config = (
        json.loads(args.library_file.read_text(encoding="utf-8")) if args.library_file else fetch_library(args.library, args.ref)
    )
    template = json.loads(args.template.read_text(encoding="utf-8"))
    config = build_config(args.library, library_config, args.sequence, template, title=args.title, ref=args.ref)
    set_trial_steps.set_steps(config, fixation=args.fixation, tlx=args.tlx)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    register(args.study_id, args.out)
    steps = set_trial_steps.current_steps(config)
    print(
        f"{len(set_trial_steps.item_blocks(config))} items from {args.library} ({args.sequence}) -> {args.out}; "
        f"registered as {args.study_id}; fixation {'on' if steps['fixation'] else 'off'}, tlx {'on' if steps['tlx'] else 'off'}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
