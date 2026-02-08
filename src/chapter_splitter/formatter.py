from __future__ import annotations

from dataclasses import dataclass
import itertools
import re
from typing import Any


CHAPTER_NO_PATTERNS = (
    re.compile(r"第\s*(\d+)\s*[章节回]", re.IGNORECASE),
    re.compile(r"chapter\s*(\d+)", re.IGNORECASE),
    re.compile(r"\bc\s*(\d+)\b", re.IGNORECASE),
    re.compile(r"^\s*(\d+)(?:[.\s]|$)", re.IGNORECASE),
)


@dataclass(slots=True)
class TitleFormatInput:
    original_title: str
    chapter_num: int | None
    part: int
    total: int


@dataclass(slots=True)
class TitleFormatResult:
    title: str
    source: str


def extract_chapter_number(title: str) -> int | None:
    for pattern in CHAPTER_NO_PATTERNS:
        matched = pattern.search(title)
        if matched:
            return int(matched.group(1))
    return None


def _normalize_title_text(title: str) -> str:
    normalized = title.strip()
    normalized = re.sub(r"^第\s*\d+\s*[章节回][:：\-\s]*", "", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"^chapter\s*\d+[:：\-\s]*", "", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"^\bc\s*\d+[:：\-\s]*", "", normalized, flags=re.IGNORECASE)
    return normalized.strip() or title.strip()


def _format_local(entry: TitleFormatInput, chapter_num: int, language: str, formats: dict[str, str]) -> str:
    title_body = _normalize_title_text(entry.original_title)
    is_split = entry.total > 1

    if language == "zh":
        if is_split:
            template = formats.get("zh", "第{num}章：{title} ({part}/{total})")
            return template.format(num=chapter_num, title=title_body, part=entry.part, total=entry.total)
        template = formats.get("zh_no_split", "第{num}章：{title}")
        return template.format(num=chapter_num, title=title_body, part=entry.part, total=entry.total)

    template_key = "en" if is_split else "en_no_split"
    template_default = "Chapter {num}: {title} (part {part})" if is_split else "Chapter {num}: {title}"
    template = formats.get(template_key, template_default)
    return template.format(num=chapter_num, title=title_body, part=entry.part, total=entry.total)


def _build_llm_payload(entries: list[TitleFormatInput], fallback_titles: list[str]) -> list[dict[str, Any]]:
    payload: list[dict[str, Any]] = []
    for idx, (entry, fallback_title) in enumerate(zip(entries, fallback_titles, strict=True)):
        payload.append(
            {
                "index": idx,
                "original_title": entry.original_title,
                "chapter_num": entry.chapter_num,
                "part": entry.part,
                "total": entry.total,
                "fallback_title": fallback_title,
            }
        )
    return payload


def format_titles_batch(
    entries: list[TitleFormatInput],
    *,
    language: str,
    formats: dict[str, str],
    batch_size: int = 20,
    llm_client: object | None = None,
) -> list[TitleFormatResult]:
    if not entries:
        return []

    numbered = []
    serial = 1
    for entry in entries:
        chapter_num = entry.chapter_num if entry.chapter_num is not None else serial
        numbered.append((entry, chapter_num))
        serial = max(serial + 1, chapter_num + 1)

    fallback_titles = [
        _format_local(entry, chapter_num=chapter_num, language=language, formats=formats)
        for entry, chapter_num in numbered
    ]

    if llm_client is None:
        return [TitleFormatResult(title=title, source="local") for title in fallback_titles]

    formatter = getattr(llm_client, "format_titles", None)
    if formatter is None:
        return [TitleFormatResult(title=title, source="local") for title in fallback_titles]

    results: list[str] = []
    size = max(1, batch_size)

    for start in range(0, len(entries), size):
        end = start + size
        entry_chunk = entries[start:end]
        fallback_chunk = fallback_titles[start:end]

        payload = _build_llm_payload(entry_chunk, fallback_chunk)
        formatted_chunk = None
        try:
            formatted_chunk = formatter(payload, language)
        except Exception:
            formatted_chunk = None

        if not isinstance(formatted_chunk, list) or len(formatted_chunk) != len(entry_chunk):
            results.extend(fallback_chunk)
            continue

        safe_chunk = [str(title).strip() or fallback for title, fallback in zip(formatted_chunk, fallback_chunk, strict=True)]
        results.extend(safe_chunk)

    return [
        TitleFormatResult(title=title, source="llm" if title != fallback else "local")
        for title, fallback in zip(results, fallback_titles, strict=True)
    ]


def build_title_inputs(items: list[dict[str, Any]]) -> list[TitleFormatInput]:
    outputs: list[TitleFormatInput] = []
    for item in items:
        title = str(item.get("original_title", "")).strip()
        part = int(item.get("part", 1))
        total = int(item.get("total", 1))
        chapter_num = item.get("chapter_num")
        if chapter_num is None:
            chapter_num = extract_chapter_number(title)
        outputs.append(
            TitleFormatInput(
                original_title=title,
                chapter_num=chapter_num,
                part=part,
                total=total,
            )
        )
    return outputs
