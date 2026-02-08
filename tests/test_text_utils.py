from chapter_splitter.utils.text import split_by_sentence


def test_split_by_sentence_keeps_chinese_quote_boundary():
    second_sentence = "然后" + ("继续观察并记录" * 60) + "。"
    text = "医生说：「先吃一周药（饭后）。」" + second_sentence
    chunks = split_by_sentence(text, target_chars=20)
    assert len(chunks) >= 2
    assert chunks[0].endswith("。」")
    assert not chunks[1].startswith("」")


def test_split_by_sentence_keeps_english_double_quote_boundary():
    second_sentence = "Then " + ("continue observation and keep daily logs " * 20) + "."
    text = 'He said, "Take this medicine for one week." ' + second_sentence
    chunks = split_by_sentence(text, target_chars=25)
    assert len(chunks) >= 2
    assert chunks[0].endswith('."')
    assert not chunks[1].startswith('"')


def test_split_by_sentence_keeps_multi_closing_marks_after_period():
    second_sentence = "Then " + ("proceed with the next steps and document outcomes " * 20) + "."
    text = 'The report noted this clearly.")]} ' + second_sentence
    chunks = split_by_sentence(text, target_chars=35)
    assert len(chunks) >= 2
    assert chunks[0].endswith('.")]}')
    assert not chunks[1].startswith('")]}')
