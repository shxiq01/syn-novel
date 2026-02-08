from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .config import AppConfig
from .detector import build_detection_samples, detect_language
from .formatter import TitleFormatInput, format_titles_batch
from .llm import DeepSeekClient, GrokClient, LLMClient
from .llm.client import RetryPolicy
from .parser import parse_chapters
from .renderer import RenderChapter, write_output
from .splitter import split_chapter


@dataclass(slots=True)
class ProcessResult:
    output_path: Path
    language: str
    parse_strategy: str
    input_chapter_count: int
    output_chapter_count: int


class ChapterSplitterPipeline:
    def __init__(self, config: AppConfig) -> None:
        self.config = config
        self.llm_client = self._build_llm_client()

    def _build_llm_client(self) -> LLMClient | None:
        retry = RetryPolicy(
            max_attempts=self.config.llm.retry.max_attempts,
            delay_seconds=self.config.llm.retry.delay_seconds,
        )

        if self.config.llm.provider == "deepseek":
            return DeepSeekClient(
                api_key=self.config.llm.api_key,
                base_url=self.config.llm.base_url,
                model=self.config.llm.model,
                timeout=self.config.llm.timeout,
                retry_policy=retry,
            )

        if self.config.llm.provider == "grok":
            return GrokClient(
                api_key=self.config.llm.api_key,
                base_url=self.config.llm.base_url,
                model=self.config.llm.model,
                timeout=self.config.llm.timeout,
                retry_policy=retry,
            )

        return None

    def process(self, input_path: Path, output_path: Path) -> ProcessResult:
        text = input_path.read_text(encoding="utf-8")

        language_result = detect_language(text, llm_client=self.llm_client)
        language = "zh" if language_result.language in {"zh", "mixed"} else "en"

        sample_text = build_detection_samples(
            text,
            sample_size=self.config.llm.chapter_detection.sample_size,
            sample_count=self.config.llm.chapter_detection.sample_count,
        )

        parser_llm = self.llm_client if self.config.llm.chapter_detection.enable_llm_fallback else None
        parse_result = parse_chapters(
            text,
            llm_client=parser_llm,
            llm_sample_text=sample_text,
            fallback_mode=self.config.fallback.no_chapter_detected,
            target_chars=self.config.splitter.target_chars,
        )

        title_inputs: list[TitleFormatInput] = []
        piece_contents: list[str] = []
        running_num = 1

        for chapter in parse_result.chapters:
            pieces = split_chapter(
                chapter,
                target_chars=self.config.splitter.target_chars,
                min_ratio=self.config.splitter.min_ratio,
                max_ratio=self.config.splitter.max_ratio,
                split_search_range=self.config.splitter.split_search_range,
            )

            for piece in pieces:
                title_inputs.append(
                    TitleFormatInput(
                        original_title=piece.original_title,
                        chapter_num=running_num,
                        part=piece.part,
                        total=piece.total,
                    )
                )
                piece_contents.append(piece.content)
                running_num += 1

        formatted_titles = format_titles_batch(
            title_inputs,
            language=language,
            formats=self.config.formats,
            batch_size=self.config.llm.title_formatting.batch_size,
            llm_client=self.llm_client,
        )

        render_chapters = [
            RenderChapter(title=title_result.title, content=content)
            for title_result, content in zip(formatted_titles, piece_contents, strict=True)
        ]

        write_output(
            output_path,
            render_chapters,
            separator=self.config.splitter.separator,
            blank_lines=self.config.output.blank_lines_between_chapters,
            encoding=self.config.output.encoding,
        )

        return ProcessResult(
            output_path=output_path,
            language=language,
            parse_strategy=parse_result.strategy,
            input_chapter_count=len(parse_result.chapters),
            output_chapter_count=len(render_chapters),
        )
