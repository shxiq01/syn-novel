from chapter_splitter.parser import parse_chapters


class DummyPatternLLM:
    def detect_chapter_pattern(self, sample_text: str):
        return {"pattern": r"^@@\d+"}


def test_parse_chinese_fixture_uses_regex():
    text = open("tests/fixtures/chinese_sample.txt", encoding="utf-8").read()
    result = parse_chapters(text)
    assert result.strategy == "regex"
    assert len(result.chapters) == 3
    assert result.chapters[0].original_title.startswith("第一章")


def test_parse_with_llm_pattern_fallback():
    text = "@@1 opening\nline\n@@2 second\nline"
    result = parse_chapters(text, llm_client=DummyPatternLLM(), llm_sample_text=text)
    assert result.strategy == "llm_pattern"
    assert len(result.chapters) == 2


def test_parse_fallback_sentence_when_no_heading():
    text = "这是没有章节标题的文本。第一句结束。第二句继续。第三句结束。"
    result = parse_chapters(text, fallback_mode="sentence", target_chars=12)
    assert result.strategy == "fallback_sentence"
    assert len(result.chapters) >= 1
