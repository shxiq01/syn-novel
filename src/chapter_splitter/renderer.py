from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(slots=True)
class RenderChapter:
    title: str
    content: str


def default_output_path(input_path: Path) -> Path:
    return input_path.with_name(f"{input_path.stem}_split.txt")


def render_text(chapters: list[RenderChapter], separator: str = "===", blank_lines: int = 2) -> str:
    chunks: list[str] = []
    line_break = "\n" * max(1, blank_lines)

    for chapter in chapters:
        wrapped_title = f"{separator}{chapter.title}{separator}"
        chunk = f"{wrapped_title}\n{chapter.content.strip()}"
        chunks.append(chunk.strip())

    return line_break.join(chunks).strip() + "\n"


def write_output(
    output_path: Path,
    chapters: list[RenderChapter],
    separator: str = "===",
    blank_lines: int = 2,
    encoding: str = "utf-8",
) -> Path:
    output_text = render_text(chapters, separator=separator, blank_lines=blank_lines)
    output_path.write_text(output_text, encoding=encoding)
    return output_path
