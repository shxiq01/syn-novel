from __future__ import annotations

from dataclasses import dataclass
import json
import time
from typing import Any


@dataclass(slots=True)
class RetryPolicy:
    max_attempts: int = 3
    delay_seconds: float = 2.0


class LLMClient:
    def __init__(
        self,
        *,
        provider: str,
        api_key: str,
        base_url: str,
        model: str,
        timeout: int = 30,
        retry_policy: RetryPolicy | None = None,
    ) -> None:
        self.provider = provider
        self.api_key = api_key or ""
        self.base_url = base_url
        self.model = model
        self.timeout = timeout
        self.retry_policy = retry_policy or RetryPolicy()

    @property
    def enabled(self) -> bool:
        return bool(self.api_key and self.model and self.base_url)

    def _request_json(self, system_prompt: str, user_prompt: str) -> Any | None:
        if not self.enabled:
            return None

        try:
            from openai import OpenAI
        except Exception:
            return None

        client = OpenAI(api_key=self.api_key, base_url=self.base_url, timeout=self.timeout)

        attempts = max(1, self.retry_policy.max_attempts)
        for attempt in range(1, attempts + 1):
            try:
                completion = client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    temperature=0.1,
                    response_format={"type": "json_object"},
                )
                content = completion.choices[0].message.content or "{}"
                return json.loads(content)
            except Exception:
                if attempt >= attempts:
                    return None
                time.sleep(max(0, self.retry_policy.delay_seconds))
        return None

    def detect_language(self, sample_text: str) -> dict[str, Any] | None:
        prompt = (
            "识别文本主要语言，仅返回 JSON："
            '{"language":"zh|en|mixed|unknown","confidence":0-1}'
        )
        payload = self._request_json("You are a language classifier.", f"{prompt}\n\n{sample_text}")
        if not isinstance(payload, dict):
            return None
        return payload

    def detect_chapter_pattern(self, sample_text: str) -> dict[str, Any] | None:
        prompt = (
            "根据样本文本识别章节标题正则，只返回 JSON："
            '{"pattern":"^...$"}；若无法识别返回 {"pattern":""}'
        )
        payload = self._request_json("You are a chapter pattern detector.", f"{prompt}\n\n{sample_text}")
        if not isinstance(payload, dict):
            return None
        return payload

    def format_titles(self, items: list[dict[str, Any]], language: str) -> list[str] | None:
        user_prompt = (
            "按输入顺序返回格式化标题数组，必须是 JSON 对象，键名为 formatted，值为字符串数组。"
            f"\n语言: {language}\n输入: {json.dumps(items, ensure_ascii=False)}"
        )
        payload = self._request_json("You are a title formatter.", user_prompt)
        if not isinstance(payload, dict):
            return None

        formatted = payload.get("formatted")
        if not isinstance(formatted, list):
            return None

        cleaned = [str(item).strip() for item in formatted]
        return cleaned
