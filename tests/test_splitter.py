from chapter_splitter.parser import ParsedChapter
from chapter_splitter.splitter import (
    calculate_split_count,
    find_split_point,
    split_chapter,
    split_content,
)


CLOSING_PREFIXES = ('”', '」', '』', '》', '】', '〕', '）', ')', ']', '}', '"')


def test_calculate_split_count_basic():
    assert calculate_split_count(1000, 1000, 0.7, 1.3) == 1
    assert calculate_split_count(3200, 1000, 0.7, 1.3) >= 3


def test_find_split_point_prefers_paragraph():
    text = "A" * 120 + "\n\n" + "B" * 120
    point = find_split_point(text, target_pos=121, search_range=30)
    assert text[max(0, point - 2) : point].endswith("\n\n")


def test_find_split_point_keeps_closing_quote_with_sentence():
    text = "他说：「不过现在还不能排除早泄的问题，先吃一周的药，如果问题没有改善就要复诊了。」然后继续安排复诊。"
    target_pos = text.index("复诊了。") + len("复诊了。")
    point = find_split_point(text, target_pos=target_pos, search_range=30)
    assert text[:point].endswith("。」")


def test_split_content_should_not_start_next_piece_with_closing_quote():
    content = "他说：「不过现在还不能排除早泄的问题，先吃一周的药，如果问题没有改善就要复诊了。」然后继续讨论治疗方案和复查时间。"
    pieces = split_content(content, target_chars=35, min_ratio=0.7, max_ratio=1.3, split_search_range=40)
    assert len(pieces) >= 2
    assert not pieces[1].startswith("」")


def test_split_content_should_not_start_with_nested_closing_marks():
    content = (
        'He said, "Take this medicine for one week.")]} '
        'Then return in 7 days for follow-up and additional checks.'
    )
    pieces = split_content(content, target_chars=40, min_ratio=0.7, max_ratio=1.3, split_search_range=60)
    assert len(pieces) >= 2
    assert not pieces[1].startswith(CLOSING_PREFIXES)


def test_split_chapter_multiple_parts():
    content = ("这是一段内容。" * 100) + "\n\n" + ("第二段内容。" * 120)
    chapter = ParsedChapter(original_title="第1章 测试", content=content)
    parts = split_chapter(chapter, target_chars=300, min_ratio=0.7, max_ratio=1.3)
    assert len(parts) >= 2
    assert parts[0].part == 1
    assert parts[-1].total == len(parts)
