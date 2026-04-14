import test from "node:test";
import assert from "node:assert/strict";
import { ProviderError } from "../adapters/provider-error";
import { calculateNanoPolicyRates, isFallbackEligible } from "../services/nano-policy.util";

test("仅在 transientOnly=true 且错误可恢复时允许兜底", () => {
    const transientError = new ProviderError({
        code: "ACE_RATE_LIMITED",
        message: "rate limited",
        provider: "ace",
        transient: true,
    });
    const deterministicError = new ProviderError({
        code: "ACE_REQUEST_BODY_TOO_LARGE",
        message: "too large",
        provider: "ace",
        transient: false,
    });

    assert.equal(isFallbackEligible(transientError, true), true);
    assert.equal(isFallbackEligible(deterministicError, true), false);
    assert.equal(isFallbackEligible(deterministicError, false), true);
});

test("指标比率计算符合预期", () => {
    const rates = calculateNanoPolicyRates({
        totalRequests: 10,
        switchedToAnyfast: 2,
        finalAnyfast: 1,
    });
    assert.equal(rates.switchToAnyfastRate, "0.2000");
    assert.equal(rates.anyfastFinalRate, "0.1000");
});
