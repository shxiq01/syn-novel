from chapter_splitter.parser import ParsedChapter
from chapter_splitter.splitter import calculate_split_count, find_split_point, split_chapter


def test_calculate_split_count_basic():
    assert calculate_split_count(1000, 1000, 0.7, 1.3) == 1
    assert calculate_split_count(3200, 1000, 0.7, 1.3) >= 3


def test_find_split_point_prefers_paragraph():
    text = "A" * 120 + "\n\n" + "B" * 120
    point = find_split_point(text, target_pos=121, search_range=30)
    assert text[max(0, point - 2) : point].endswith("\n\n")


def test_split_chapter_multiple_parts():
    content = ("这是一段内容。" * 100) + "\n\n" + ("第二段内容。" * 120)
    chapter = ParsedChapter(original_title="第1章 测试", content=content)
    parts = split_chapter(chapter, target_chars=300, min_ratio=0.7, max_ratio=1.3)
    assert len(parts) >= 2
    assert parts[0].part == 1
    assert parts[-1].total == len(parts)
