from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
import os

import yaml
from dotenv import load_dotenv


@dataclass(slots=True)
class RetryConfig:
    max_attempts: int = 3
    delay_seconds: int = 2


@dataclass(slots=True)
class ChapterDetectionConfig:
    enable_llm_fallback: bool = True
    sample_size: int = 2000
    sample_count: int = 3


@dataclass(slots=True)
class TitleFormattingConfig:
    batch_size: int = 20


@dataclass(slots=True)
class LLMConfig:
    provider: str = "deepseek"
    api_key: str = ""
    base_url: str = "https://api.deepseek.com/v1"
    model: str = "deepseek-chat"
    timeout: int = 30
    retry: RetryConfig = field(default_factory=RetryConfig)
    chapter_detection: ChapterDetectionConfig = field(default_factory=ChapterDetectionConfig)
    title_formatting: TitleFormattingConfig = field(default_factory=TitleFormattingConfig)


@dataclass(slots=True)
class SplitterConfig:
    target_chars: int = 1000
    min_ratio: float = 0.7
    max_ratio: float = 1.3
    separator: str = "==="
    split_search_range: int = 200


@dataclass(slots=True)
class OutputConfig:
    encoding: str = "utf-8"
    blank_lines_between_chapters: int = 2


@dataclass(slots=True)
class FallbackConfig:
    no_chapter_detected: str = "paragraph"
    llm_failure_keep_original: bool = True


@dataclass(slots=True)
class AppConfig:
    llm: LLMConfig = field(default_factory=LLMConfig)
    splitter: SplitterConfig = field(default_factory=SplitterConfig)
    output: OutputConfig = field(default_factory=OutputConfig)
    fallback: FallbackConfig = field(default_factory=FallbackConfig)
    formats: dict[str, str] = field(
        default_factory=lambda: {
            "zh": "第{num}章：{title} ({part}/{total})",
            "zh_no_split": "第{num}章：{title}",
            "en": "Chapter {num}: {title} (part {part})",
            "en_no_split": "Chapter {num}: {title}",
        }
    )


def _deep_update(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _deep_update(base[key], value)
        else:
            base[key] = value
    return base


def _resolve_env(data: Any) -> Any:
    if isinstance(data, dict):
        return {key: _resolve_env(value) for key, value in data.items()}
    if isinstance(data, list):
        return [_resolve_env(item) for item in data]
    if isinstance(data, str):
        return os.path.expandvars(data)
    return data


def _load_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    content = path.read_text(encoding="utf-8")
    parsed = yaml.safe_load(content) or {}
    return parsed


def load_config(config_path: str | None = None, overrides: dict[str, Any] | None = None) -> AppConfig:
    load_dotenv(override=False)

    default_path = Path("config/default.yaml")
    selected_path = Path(config_path) if config_path else default_path

    default_data = _load_yaml(default_path)
    selected_data = _load_yaml(selected_path)

    merged = _deep_update(default_data, selected_data)
    if overrides:
        merged = _deep_update(merged, overrides)

    merged = _resolve_env(merged)

    llm_data = merged.get("llm", {})
    retry = RetryConfig(**llm_data.get("retry", {}))
    chapter_detection = ChapterDetectionConfig(**llm_data.get("chapter_detection", {}))
    title_formatting = TitleFormattingConfig(**llm_data.get("title_formatting", {}))

    llm_config = LLMConfig(
        provider=llm_data.get("provider", "deepseek"),
        api_key=llm_data.get("api_key", ""),
        base_url=llm_data.get("base_url", "https://api.deepseek.com/v1"),
        model=llm_data.get("model", "deepseek-chat"),
        timeout=llm_data.get("timeout", 30),
        retry=retry,
        chapter_detection=chapter_detection,
        title_formatting=title_formatting,
    )

    splitter_config = SplitterConfig(**merged.get("splitter", {}))
    output_config = OutputConfig(**merged.get("output", {}))
    fallback_config = FallbackConfig(**merged.get("fallback", {}))
    formats = merged.get("formats", {})

    return AppConfig(
        llm=llm_config,
        splitter=splitter_config,
        output=output_config,
        fallback=fallback_config,
        formats=formats,
    )


def apply_cli_overrides(config: AppConfig, target_chars: int | None = None) -> AppConfig:
    if target_chars is not None and target_chars > 0:
        config.splitter.target_chars = target_chars
    return config
