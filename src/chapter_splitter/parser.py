from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Pattern

from .utils.text import split_by_paragraph, split_by_sentence


DEFAULT_CHAPTER_PATTERNS: tuple[Pattern[str], ...] = (
    re.compile(r"^第[一二三四五六七八九十百千万零〇\d]+[章节篇回]\b.*", re.IGNORECASE),
    re.compile(r"^[一二三四五六七八九十百千万零〇]+[、.]\s*.+", re.IGNORECASE),
    re.compile(r"^(序章|楔子|番外)\b.*", re.IGNORECASE),
    re.compile(r"^chapter\s*\d+\b.*", re.IGNORECASE),
    re.compile(r"^part\s*\d+\b.*", re.IGNORECASE),
    re.compile(r"^(prologue|epilogue)\b.*", re.IGNORECASE),
    re.compile(r"^\d+[.\s]+.+", re.IGNORECASE),
)


@dataclass(slots=True)
class ParsedChapter:
    original_title: str
    content: str
    index_hint: int | None = None

    @property
    def char_count(self) -> int:
        return len(self.content)


@dataclass(slots=True)
class ParseResult:
    chapters: list[ParsedChapter]
    strategy: str


def _parse_with_patterns(text: str, patterns: tuple[Pattern[str], ...]) -> list[ParsedChapter]:
    lines = text.splitlines()
    heading_indices: list[int] = []

    for idx, raw_line in enumerate(lines):
        line = raw_line.strip()
        if not line:
            continue
        if any(pattern.match(line) for pattern in patterns):
            heading_indices.append(idx)

    if not heading_indices:
        return []

    chapters: list[ParsedChapter] = []
    for i, start_idx in enumerate(heading_indices):
        end_idx = heading_indices[i + 1] if i + 1 < len(heading_indices) else len(lines)
        heading = lines[start_idx].strip()
        content_lines = lines[start_idx + 1 : end_idx]
        content = "\n".join(content_lines).strip()
        chapters.append(ParsedChapter(original_title=heading, content=content))

    return chapters


def _parse_with_llm_pattern(text: str, llm_client: object | None, sample_text: str) -> list[ParsedChapter]:
    if llm_client is None:
        return []

    detector = getattr(llm_client, "detect_chapter_pattern", None)
    if detector is None:
        return []

    try:
        result = detector(sample_text)
    except Exception:
        return []

    pattern_text = ""
    if isinstance(result, str):
        pattern_text = result.strip()
    elif isinstance(result, dict):
        pattern_text = str(result.get("pattern", "")).strip()

    if not pattern_text:
        return []

    try:
        pattern = re.compile(pattern_text, re.IGNORECASE)
    except re.error:
        return []

    return _parse_with_patterns(text, (pattern,))


def _fallback_parse(text: str, mode: str = "paragraph", target_chars: int = 1000) -> list[ParsedChapter]:
    if mode == "sentence":
        segments = split_by_sentence(text, target_chars=target_chars)
        prefix = "句"
    else:
        segments = split_by_paragraph(text)
        prefix = "段"

    if not segments:
        return [ParsedChapter(original_title="第1段", content=text.strip())]

    return [
        ParsedChapter(original_title=f"第{idx}{prefix}", content=segment)
        for idx, segment in enumerate(segments, start=1)
    ]


def parse_chapters(
    text: str,
    llm_client: object | None = None,
    llm_sample_text: str | None = None,
    fallback_mode: str = "paragraph",
    target_chars: int = 1000,
) -> ParseResult:
    chapters = _parse_with_patterns(text, DEFAULT_CHAPTER_PATTERNS)
    if chapters:
        return ParseResult(chapters=chapters, strategy="regex")

    llm_chapters = _parse_with_llm_pattern(
        text=text,
        llm_client=llm_client,
        sample_text=llm_sample_text or text[:6000],
    )
    if llm_chapters:
        return ParseResult(chapters=llm_chapters, strategy="llm_pattern")

    fallback_chapters = _fallback_parse(text, mode=fallback_mode, target_chars=target_chars)
    return ParseResult(chapters=fallback_chapters, strategy=f"fallback_{fallback_mode}")
