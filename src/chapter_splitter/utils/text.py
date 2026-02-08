from __future__ import annotations

from collections.abc import Iterable
import re


def normalize_newlines(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def sample_text_chunks(text: str, sample_size: int = 2000, sample_count: int = 3) -> list[str]:
    normalized = normalize_newlines(text)
    if not normalized:
        return []

    sample_size = max(100, sample_size)
    sample_count = max(1, sample_count)

    if len(normalized) <= sample_size:
        return [normalized]

    if sample_count == 1:
        return [normalized[:sample_size]]

    max_start = max(0, len(normalized) - sample_size)
    points = [round(max_start * i / (sample_count - 1)) for i in range(sample_count)]

    chunks: list[str] = []
    for pos in points:
        chunks.append(normalized[pos : pos + sample_size])
    return chunks


def split_by_paragraph(text: str) -> list[str]:
    normalized = normalize_newlines(text)
    chunks = [chunk.strip() for chunk in re.split(r"\n\s*\n+", normalized) if chunk.strip()]
    return chunks


def split_by_sentence(text: str, target_chars: int = 1000) -> list[str]:
    normalized = normalize_newlines(text).strip()
    if not normalized:
        return []

    sentence_tokens = re.split(r"(?<=[。.!?！？])", normalized)
    sentence_tokens = [token.strip() for token in sentence_tokens if token.strip()]

    if not sentence_tokens:
        return [normalized]

    target_chars = max(200, target_chars)
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0

    for sentence in sentence_tokens:
        sentence_len = len(sentence)
        if current and current_len + sentence_len > target_chars:
            chunks.append("".join(current).strip())
            current = [sentence]
            current_len = sentence_len
            continue
        current.append(sentence)
        current_len += sentence_len

    if current:
        chunks.append("".join(current).strip())

    return [chunk for chunk in chunks if chunk]


def iter_non_empty_lines(text: str) -> Iterable[str]:
    for line in normalize_newlines(text).split("\n"):
        stripped = line.strip()
        if stripped:
            yield stripped
