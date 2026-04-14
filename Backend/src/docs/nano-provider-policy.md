# Nano Provider Policy

`/image/generate` 在 `apiType=nano` 时采用请求级策略：

- 默认先调用 Ace。
- Ace 出现可恢复错误时，最多重试 `NANO_ACE_MAX_ATTEMPTS_PER_REQUEST` 次。
- 若仍失败且允许切换，则回退到 AnyFast 一次。

## 环境变量

- `NANO_PRIMARY_PROVIDER`：默认 `ace`
- `NANO_FALLBACK_PROVIDER`：默认 `anyfast`
- `NANO_ACE_MAX_ATTEMPTS_PER_REQUEST`：默认 `2`
- `NANO_FALLBACK_ON_TRANSIENT_ONLY`：默认 `true`
- `NANO_ANYFAST_CIRCUIT_FAILURE_THRESHOLD`：默认 `3`
- `NANO_ANYFAST_CIRCUIT_OPEN_MS`：默认 `60000`
- `ANYFAST_BASE_URL`：默认 `https://www.anyfast.ai`
- `ANYFAST_API_KEY`：AnyFast key
- `ANYFAST_NANO_DEFAULT_MODEL`：默认 `gemini-2.5-flash-image`
- `ANYFAST_REQUEST_TIMEOUT_MS`：默认 `600000`

## 日志字段

每次请求返回中附带 `provider_policy`：

- `request_id`
- `provider_chain`
- `switch_reason`
- `attempt_count`
- `final_provider`
- `latency_ms`
