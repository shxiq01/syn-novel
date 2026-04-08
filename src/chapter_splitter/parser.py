from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Match, Pattern

from .utils.text import split_by_paragraph, split_by_sentence


GENERIC_NUMBERED_HEADING_PATTERN = re.compile(
    r"^(?P<number>\d{1,4})(?P<sep>[.\s、:：\-])\s*(?P<body>.+)$",
    re.IGNORECASE,
)

_GENERIC_NUMBERED_END_PUNCT_RE = re.compile(r"(?:[。.!?！？…]|\.{3,}|…+)[\"'”’）)\]}]*$")
_GENERIC_NUMBERED_SENTENCE_MARK_RE = re.compile(r"[。!?！？…]")


DEFAULT_CHAPTER_PATTERNS: tuple[Pattern[str], ...] = (
    re.compile(r"^第[一二三四五六七八九十百千万零〇\d]+[章节篇回]\b.*", re.IGNORECASE),
    re.compile(r"^[一二三四五六七八九十百千万零〇]+[、.]\s*.+", re.IGNORECASE),
    re.compile(r"^(序章|楔子|番外)\b.*", re.IGNORECASE),
    re.compile(r"^chapter\s*\d+\b.*", re.IGNORECASE),
    re.compile(r"^part\s*\d+\b.*", re.IGNORECASE),
    re.compile(r"^(prologue|epilogue)\b.*", re.IGNORECASE),
    GENERIC_NUMBERED_HEADING_PATTERN,
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
    leading_text: str = ""


def _is_generic_numbered_heading(line: str, matched: Match[str]) -> bool:
    body = matched.group("body").strip()
    if not body:
        return False

    if len(line) > 90:
        return False

    if (body.count(",") + body.count("，")) >= 3:
        return False

    if _GENERIC_NUMBERED_END_PUNCT_RE.search(body):
        return False

    sep = matched.group("sep")
    if sep.isspace():
        if _GENERIC_NUMBERED_SENTENCE_MARK_RE.search(body):
            return False
        words = [token for token in body.split() if token]
        if len(words) > 12:
            return False

    return True


def _is_chapter_heading(line: str, patterns: tuple[Pattern[str], ...]) -> bool:
    for pattern in patterns:
        matched = pattern.match(line)
        if not matched:
            continue
        if pattern is GENERIC_NUMBERED_HEADING_PATTERN:
            return _is_generic_numbered_heading(line, matched)
        return True
    return False


def _extract_chapters_and_leading_text(
    text: str,
    patterns: tuple[Pattern[str], ...],
) -> tuple[list[ParsedChapter], str]:
    raw_lines = text.splitlines(keepends=True)
    heading_indices: list[int] = []

    for idx, raw_line in enumerate(raw_lines):
        line = raw_line.strip()
        if not line:
            continue
        if _is_chapter_heading(line, patterns):
            heading_indices.append(idx)

    if not heading_indices:
        return [], ""

    leading_text = "".join(raw_lines[: heading_indices[0]])

    chapters: list[ParsedChapter] = []
    for i, start_idx in enumerate(heading_indices):
        end_idx = heading_indices[i + 1] if i + 1 < len(heading_indices) else len(raw_lines)
        heading = raw_lines[start_idx].strip()
        content_lines = raw_lines[start_idx + 1 : end_idx]
        content = "".join(content_lines).strip()
        chapters.append(ParsedChapter(original_title=heading, content=content))

    return chapters, leading_text


def _parse_with_llm_pattern(
    text: str,
    llm_client: object | None,
    sample_text: str,
) -> tuple[list[ParsedChapter], str]:
    if llm_client is None:
        return [], ""

    detector = getattr(llm_client, "detect_chapter_pattern", None)
    if detector is None:
        return [], ""

    try:
        result = detector(sample_text)
    except Exception:
        return [], ""

    pattern_text = ""
    if isinstance(result, str):
        pattern_text = result.strip()
    elif isinstance(result, dict):
        pattern_text = str(result.get("pattern", "")).strip()

    if not pattern_text:
        return [], ""

    try:
        pattern = re.compile(pattern_text, re.IGNORECASE)
    except re.error:
        return [], ""

    return _extract_chapters_and_leading_text(text, (pattern,))


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
    chapters, leading_text = _extract_chapters_and_leading_text(text, DEFAULT_CHAPTER_PATTERNS)
    if chapters:
        return ParseResult(chapters=chapters, strategy="regex", leading_text=leading_text)

    llm_chapters, llm_leading_text = _parse_with_llm_pattern(
        text=text,
        llm_client=llm_client,
        sample_text=llm_sample_text or text[:6000],
    )
    if llm_chapters:
        return ParseResult(chapters=llm_chapters, strategy="llm_pattern", leading_text=llm_leading_text)

    fallback_chapters = _fallback_parse(text, mode=fallback_mode, target_chars=target_chars)
    return ParseResult(chapters=fallback_chapters, strategy=f"fallback_{fallback_mode}", leading_text="")
