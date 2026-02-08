from __future__ import annotations

from .client import LLMClient, RetryPolicy


class GrokClient(LLMClient):
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = "https://api.x.ai/v1",
        model: str = "grok-2-latest",
        timeout: int = 30,
        retry_policy: RetryPolicy | None = None,
    ) -> None:
        super().__init__(
            provider="grok",
            api_key=api_key,
            base_url=base_url,
            model=model,
            timeout=timeout,
            retry_policy=retry_policy,
        )
