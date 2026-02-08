from __future__ import annotations

from dataclasses import dataclass
import re

from .parser import ParsedChapter


@dataclass(slots=True)
class SplitPiece:
    original_title: str
    content: str
    part: int
    total: int

    @property
    def char_count(self) -> int:
        return len(self.content)


def calculate_split_count(char_count: int, target: int, min_ratio: float, max_ratio: float) -> int:
    if char_count <= 0:
        return 1

    min_chars = max(1, int(target * min_ratio))
    max_chars = max(min_chars, int(target * max_ratio))

    split_count = max(1, round(char_count / max(1, target)))
    chars_per_part = char_count / split_count

    if chars_per_part > max_chars:
        split_count += 1

    while split_count > 1 and (char_count / split_count) < min_chars:
        split_count -= 1

    return max(1, split_count)


def _closest(candidates: list[int], target: int) -> int | None:
    if not candidates:
        return None
    return min(candidates, key=lambda value: abs(value - target))


def find_split_point(text: str, target_pos: int, search_range: int = 200) -> int:
    if not text:
        return 0

    start = max(0, target_pos - search_range)
    end = min(len(text), target_pos + search_range)
    window = text[start:end]

    paragraph_breaks = [start + match.start() + 2 for match in re.finditer(r"\n\n+", window)]
    best_paragraph = _closest(paragraph_breaks, target_pos)
    if best_paragraph is not None:
        return best_paragraph

    sentence_breaks = [start + match.end() for match in re.finditer(r"[。.!?！？]", window)]
    best_sentence = _closest(sentence_breaks, target_pos)
    if best_sentence is not None:
        return best_sentence

    comma_breaks = [start + match.end() for match in re.finditer(r"[,，]", window)]
    best_comma = _closest(comma_breaks, target_pos)
    if best_comma is not None:
        return best_comma

    return max(1, min(len(text) - 1, target_pos))


def split_content(
    content: str,
    target_chars: int,
    min_ratio: float,
    max_ratio: float,
    split_search_range: int = 200,
) -> list[str]:
    normalized = content.strip()
    if not normalized:
        return [""]

    total_chars = len(normalized)
    split_count = calculate_split_count(total_chars, target_chars, min_ratio, max_ratio)
    if split_count == 1:
        return [normalized]

    pieces: list[str] = []
    remaining = normalized
    remaining_count = split_count

    while remaining_count > 1:
        target_pos = max(1, len(remaining) // remaining_count)
        split_point = find_split_point(remaining, target_pos, split_search_range)

        left = remaining[:split_point].strip()
        right = remaining[split_point:].strip()

        if not left or not right:
            hard_point = max(1, len(remaining) // remaining_count)
            left = remaining[:hard_point].strip()
            right = remaining[hard_point:].strip()

        pieces.append(left)
        remaining = right
        remaining_count -= 1

    pieces.append(remaining.strip())
    return [piece for piece in pieces if piece]


def split_chapter(
    chapter: ParsedChapter,
    target_chars: int,
    min_ratio: float,
    max_ratio: float,
    split_search_range: int = 200,
) -> list[SplitPiece]:
    parts = split_content(
        content=chapter.content,
        target_chars=target_chars,
        min_ratio=min_ratio,
        max_ratio=max_ratio,
        split_search_range=split_search_range,
    )

    total = len(parts)
    return [
        SplitPiece(
            original_title=chapter.original_title,
            content=content,
            part=index,
            total=total,
        )
        for index, content in enumerate(parts, start=1)
    ]
