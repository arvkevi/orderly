#!/usr/bin/env python3
"""
Generate and maintain events for Orderly.

Usage:
    # Add events from a category using Claude API
    python generate_events.py generate --category "90s movies" --count 200

    # Validate all events in events.json
    python generate_events.py validate

    # Show stats about current events
    python generate_events.py stats

    # Merge a new JSON file of events into events.json
    python generate_events.py merge new_events.json

    # Deduplicate events.json
    python generate_events.py dedup

    # Export events for a specific category
    python generate_events.py export --category sports --output sports_events.json

Requirements:
    pip install anthropic
"""

import json
import re
import sys
import argparse
from datetime import datetime
from pathlib import Path
from collections import Counter

EVENTS_FILE = Path(__file__).parent / "events.json"


def load_events() -> list[dict]:
    with open(EVENTS_FILE) as f:
        return json.load(f)


def save_events(events: list[dict]):
    with open(EVENTS_FILE, "w") as f:
        json.dump(events, f, indent=None, separators=(",", ":"))
    print(f"Saved {len(events)} events to {EVENTS_FILE}")


def validate_date(date_str: str) -> tuple[bool, str]:
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
        return False, f"Invalid format: {date_str}"
    try:
        y, m, d = date_str.split("-")
        datetime(int(y), int(m), int(d))
        return True, ""
    except ValueError as e:
        return False, str(e)


def cmd_validate(_args):
    events = load_events()
    errors = []
    seen = set()
    for i, ev in enumerate(events):
        if "event" not in ev:
            errors.append(f"[{i}] Missing 'event' field")
            continue
        if "date" not in ev:
            errors.append(f"[{i}] Missing 'date' field: {ev['event']}")
            continue
        valid, msg = validate_date(ev["date"])
        if not valid:
            errors.append(f"[{i}] {msg}: {ev['event']}")
        key = ev["event"].lower().strip()
        if key in seen:
            errors.append(f"[{i}] Duplicate: {ev['event']}")
        seen.add(key)
    if errors:
        print(f"Found {len(errors)} issues:")
        for err in errors[:50]:
            print(f"  - {err}")
        if len(errors) > 50:
            print(f"  ... and {len(errors) - 50} more")
    else:
        print(f"All {len(events)} events are valid.")


def cmd_stats(_args):
    events = load_events()
    cats = Counter(e.get("category", "uncategorized") for e in events)
    decades = Counter()
    for e in events:
        try:
            year = int(e["date"][:4])
            decades[f"{(year // 10) * 10}s"] += 1
        except (ValueError, KeyError):
            decades["unknown"] += 1

    print(f"Total events: {len(events)}")
    print(f"\nBy category ({len(cats)} categories):")
    for cat, count in sorted(cats.items(), key=lambda x: -x[1]):
        print(f"  {cat:20s} {count:5d}  {'█' * (count // 20)}")

    print(f"\nBy decade:")
    for decade, count in sorted(decades.items()):
        print(f"  {decade:10s} {count:5d}  {'█' * (count // 20)}")


def cmd_merge(args):
    existing = load_events()
    with open(args.file) as f:
        new_events = json.load(f)

    if not isinstance(new_events, list):
        print("Error: file must contain a JSON array")
        return

    seen = {e["event"].lower().strip() for e in existing}
    added = 0
    skipped = 0
    invalid = 0

    for ev in new_events:
        if "event" not in ev or "date" not in ev:
            invalid += 1
            continue
        valid, _ = validate_date(ev.get("date", ""))
        if not valid:
            invalid += 1
            continue
        key = ev["event"].lower().strip()
        if key in seen:
            skipped += 1
            continue
        seen.add(key)
        existing.append(ev)
        added += 1

    save_events(existing)
    print(f"Added: {added}, Skipped (dupes): {skipped}, Invalid: {invalid}")


def cmd_dedup(_args):
    events = load_events()
    seen = set()
    unique = []
    for ev in events:
        key = ev["event"].lower().strip()
        if key not in seen:
            seen.add(key)
            unique.append(ev)
    removed = len(events) - len(unique)
    if removed:
        save_events(unique)
        print(f"Removed {removed} duplicates")
    else:
        print("No duplicates found")


def cmd_export(args):
    events = load_events()
    filtered = [e for e in events if e.get("category", "").lower() == args.category.lower()]
    output = args.output or f"{args.category}_events.json"
    with open(output, "w") as f:
        json.dump(filtered, f, indent=2)
    print(f"Exported {len(filtered)} events to {output}")


def cmd_generate(args):
    try:
        import anthropic
    except ImportError:
        print("Install anthropic: pip install anthropic")
        return

    category = args.category
    count = args.count
    existing = load_events()
    existing_names = {e["event"].lower().strip() for e in existing}

    # Sample some existing events from this category for style reference
    cat_events = [e for e in existing if e.get("category", "").lower() == category.lower()]
    sample = cat_events[:5] if cat_events else []
    sample_text = ""
    if sample:
        sample_text = "\n\nHere are some existing events in this category for style reference:\n"
        for s in sample:
            sample_text += f'  {{"event": "{s["event"]}", "date": "{s["date"]}", "category": "{s["category"]}"}}\n'

    prompt = f"""Generate exactly {count} historical events for the category "{category}".

Return a JSON array of objects, each with:
- "event": string (short, clear description — 5-15 words)
- "date": string in "YYYY-MM-DD" format (must be accurate — use 01 for unknown day/month)
- "category": "{category}"

Rules:
- All events MUST be real historical events with accurate dates
- Events should be interesting and recognizable for a trivia game
- Cover a wide time range
- No duplicates
- IMPORTANT: Do NOT include any year (or 4-digit number resembling a year) in the "event" text — the game hides the date until the player submits, and putting the year in the description would give it away. Phrase events without dates, e.g. "Michael Jordan hits The Last Shot to win 6th title" instead of "1998: Michael Jordan...".
- Return ONLY the JSON array, no other text
- Return compact JSON: no indentation, no newlines between objects, no extra whitespace
{sample_text}"""

    client = anthropic.Anthropic()
    print(f"Generating {count} events for '{category}'...")
    # Streaming is required above ~16K max_tokens (SDK refuses non-streamed
    # requests at that size to avoid HTTP timeouts).
    with client.messages.stream(
        model="claude-sonnet-4-6",
        max_tokens=32000,
        messages=[{"role": "user", "content": prompt}],
    ) as stream:
        response = stream.get_final_message()

    text = response.content[0].text.strip()
    # Extract JSON array from response
    match = re.search(r"\[.*\]", text, re.DOTALL)
    if not match:
        print("Error: Could not parse JSON from response")
        print(text[:500])
        return

    try:
        new_events = json.loads(match.group())
    except json.JSONDecodeError as e:
        print(f"Error parsing JSON: {e}")
        return

    # Validate and deduplicate
    year_pattern = re.compile(r"\b(1[6-9]\d{2}|20\d{2}|2100)\b")
    added = 0
    skipped_year = 0
    for ev in new_events:
        if "event" not in ev or "date" not in ev:
            continue
        valid, _ = validate_date(ev.get("date", ""))
        if not valid:
            continue
        if year_pattern.search(ev["event"]):
            skipped_year += 1
            continue
        key = ev["event"].lower().strip()
        if key in existing_names:
            continue
        existing_names.add(key)
        existing.append(ev)
        added += 1

    save_events(existing)
    extra = f", {skipped_year} stripped (year in text)" if skipped_year else ""
    print(f"Generated {len(new_events)}, added {added} new events (skipped {len(new_events) - added} dupes/invalid{extra})")


def main():
    parser = argparse.ArgumentParser(description="Orderly event manager")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("validate", help="Validate events.json")
    sub.add_parser("stats", help="Show event statistics")
    sub.add_parser("dedup", help="Remove duplicate events")

    merge_p = sub.add_parser("merge", help="Merge events from a JSON file")
    merge_p.add_argument("file", help="JSON file to merge")

    export_p = sub.add_parser("export", help="Export events by category")
    export_p.add_argument("--category", required=True)
    export_p.add_argument("--output", help="Output filename")

    gen_p = sub.add_parser("generate", help="Generate events with Claude API")
    gen_p.add_argument("--category", required=True, help="Event category/theme")
    gen_p.add_argument("--count", type=int, default=100, help="Number of events to generate")

    args = parser.parse_args()
    commands = {
        "validate": cmd_validate,
        "stats": cmd_stats,
        "dedup": cmd_dedup,
        "merge": cmd_merge,
        "export": cmd_export,
        "generate": cmd_generate,
    }

    if args.command in commands:
        commands[args.command](args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
