from __future__ import annotations

from dataclasses import dataclass

from .utils.text import sample_text_chunks


@dataclass(slots=True)
class LanguageDetectionResult:
    language: str
    confidence: float
    source: str


def _heuristic_detect_language(sample_text: str) -> LanguageDetectionResult:
    if not sample_text.strip():
        return LanguageDetectionResult(language="unknown", confidence=0.0, source="heuristic")

    zh_chars = sum(1 for ch in sample_text if "\u4e00" <= ch <= "\u9fff")
    latin_chars = sum(1 for ch in sample_text if ("a" <= ch.lower() <= "z"))

    if zh_chars == 0 and latin_chars == 0:
        return LanguageDetectionResult(language="unknown", confidence=0.1, source="heuristic")

    total = max(1, zh_chars + latin_chars)
    zh_ratio = zh_chars / total
    latin_ratio = latin_chars / total

    if zh_ratio >= 0.6:
        return LanguageDetectionResult(language="zh", confidence=zh_ratio, source="heuristic")
    if latin_ratio >= 0.6:
        return LanguageDetectionResult(language="en", confidence=latin_ratio, source="heuristic")

    return LanguageDetectionResult(language="mixed", confidence=max(zh_ratio, latin_ratio), source="heuristic")


def detect_language(text: str, llm_client: object | None = None, sample_chars: int = 500) -> LanguageDetectionResult:
    sample = text[:sample_chars]
    heuristic = _heuristic_detect_language(sample)

    if llm_client is None:
        return heuristic

    detector = getattr(llm_client, "detect_language", None)
    if detector is None:
        return heuristic

    try:
        result = detector(sample)
    except Exception:
        return heuristic

    if not result:
        return heuristic

    if isinstance(result, str):
        return LanguageDetectionResult(language=result, confidence=0.7, source="llm")

    if isinstance(result, dict):
        return LanguageDetectionResult(
            language=result.get("language", heuristic.language),
            confidence=float(result.get("confidence", heuristic.confidence)),
            source="llm",
        )

    return heuristic


def build_detection_samples(text: str, sample_size: int = 2000, sample_count: int = 3) -> str:
    chunks = sample_text_chunks(text, sample_size=sample_size, sample_count=sample_count)
    return "\n\n--- SAMPLE BREAK ---\n\n".join(chunks)
