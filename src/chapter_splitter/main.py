from __future__ import annotations

from pathlib import Path
import json

import click

from .config import apply_cli_overrides, load_config
from .pipeline import ChapterSplitterPipeline


@click.command()
@click.argument("input_path", type=click.Path(exists=True, dir_okay=False, path_type=Path))
@click.option("--output", "output_path", type=click.Path(dir_okay=False, path_type=Path), default=None)
@click.option("--config", "config_path", type=click.Path(dir_okay=False, path_type=Path), default=None)
@click.option("--target-chars", type=int, default=None)
@click.option("--dry-run", is_flag=True, default=False, help="只校验配置和输入，不执行处理")
def main(
    input_path: Path,
    output_path: Path | None,
    config_path: Path | None,
    target_chars: int | None,
    dry_run: bool,
) -> None:
    """章节划分 CLI 入口。"""
    config = load_config(str(config_path) if config_path else None)
    config = apply_cli_overrides(config, target_chars=target_chars)

    if output_path is None:
        output_path = input_path.with_name(f"{input_path.stem}_split.txt")

    summary = {
        "input": str(input_path),
        "output": str(output_path),
        "llm_provider": config.llm.provider,
        "llm_model": config.llm.model,
        "target_chars": config.splitter.target_chars,
        "separator": config.splitter.separator,
        "dry_run": dry_run,
    }
    click.echo(json.dumps(summary, ensure_ascii=False, indent=2))

    if dry_run:
        click.echo("[INFO] Dry-run completed")
        return

    result = ChapterSplitterPipeline(config).process(input_path=input_path, output_path=output_path)
    click.echo(
        f"[INFO] Completed: language={result.language}, strategy={result.parse_strategy}, "
        f"input_chapters={result.input_chapter_count}, output_chapters={result.output_chapter_count}, "
        f"output={result.output_path}"
    )


if __name__ == "__main__":
    main()
