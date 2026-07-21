#!/usr/bin/env python3
"""Build the photography gallery manifest from media in /gallery."""

from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
GALLERY_DIR = ROOT / "gallery"
OUTPUT = GALLERY_DIR / "gallery-manifest.json"

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}
VIDEO_EXTENSIONS = {".mp4", ".webm"}


def natural_key(value: str) -> list[object]:
    return [int(part) if part.isdigit() else part.casefold()
            for part in re.split(r"(\d+)", value)]


def caption_from(filename: str) -> str:
    stem = Path(filename).stem
    stem = re.sub(r"^\d+[-_.\s]*", "", stem)
    stem = re.sub(r"[-_]+", " ", stem).strip()
    return stem[:1].upper() + stem[1:] if stem else ""


def build_items() -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    for path in sorted(GALLERY_DIR.iterdir(), key=lambda p: natural_key(p.name)):
        if not path.is_file():
            continue
        suffix = path.suffix.lower()
        if suffix in IMAGE_EXTENSIONS:
            media_type = "photo"
        elif suffix in VIDEO_EXTENSIONS:
            media_type = "video"
        else:
            continue
        items.append({
            "name": path.name,
            "url": "./gallery/" + quote(path.name),
            "type": media_type,
            "caption": caption_from(path.name),
        })
    return items


def main() -> None:
    GALLERY_DIR.mkdir(parents=True, exist_ok=True)
    payload = {"items": build_items()}
    OUTPUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(payload['items'])} gallery items to {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
