from chapter_splitter.formatter import (
    TitleFormatInput,
    build_title_inputs,
    extract_chapter_number,
    format_titles_batch,
)


class BadLLM:
    def format_titles(self, payload, language):
        return ["only-one"]


class GoodLLM:
    def __init__(self):
        self.calls = 0

    def format_titles(self, payload, language):
        self.calls += 1
        return [f"LLM-{item['chapter_num']}" for item in payload]


def test_extract_chapter_number_variants():
    assert extract_chapter_number("第12章 归来") == 12
    assert extract_chapter_number("Chapter 7: Return") == 7
    assert extract_chapter_number("c88") == 88
    assert extract_chapter_number("No heading") is None


def test_format_titles_batch_local_fallback():
    entries = [
        TitleFormatInput(original_title="Chapter 1: Start", chapter_num=1, part=1, total=1),
        TitleFormatInput(original_title="Chapter 2: Start", chapter_num=2, part=1, total=2),
    ]
    results = format_titles_batch(entries, language="en", formats={}, batch_size=20, llm_client=BadLLM())
    assert len(results) == 2
    assert results[0].title.startswith("Chapter 1")


def test_format_titles_batch_llm_success_in_batches():
    entries = [
        TitleFormatInput(original_title=f"Chapter {idx}: Start", chapter_num=idx, part=1, total=1)
        for idx in range(1, 101)
    ]
    llm = GoodLLM()
    results = format_titles_batch(entries, language="en", formats={}, batch_size=20, llm_client=llm)
    assert len(results) == 100
    assert llm.calls == 5
    assert results[0].title == "LLM-1"


def test_build_title_inputs_from_dict():
    raw = [{"original_title": "第5章 终局", "part": 1, "total": 1, "chapter_num": None}]
    outputs = build_title_inputs(raw)
    assert outputs[0].chapter_num == 5
