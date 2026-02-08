from __future__ import annotations

from .client import LLMClient, RetryPolicy


class DeepSeekClient(LLMClient):
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = "https://api.deepseek.com/v1",
        model: str = "deepseek-chat",
        timeout: int = 30,
        retry_policy: RetryPolicy | None = None,
    ) -> None:
        super().__init__(
            provider="deepseek",
            api_key=api_key,
            base_url=base_url,
            model=model,
            timeout=timeout,
            retry_policy=retry_policy,
        )
