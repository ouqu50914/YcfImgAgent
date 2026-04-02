import { ERROR_CATALOG_CORE, getCatalogEntry } from "./error-catalog";
import { normalizeProviderError } from "./normalize-provider-error";
import type { NormalizedErrorLog } from "./normalize-provider-error";

function normalizeOpts(
    input: {
        httpStatus: number;
        rawMessage: string;
        provider: string;
        providerCode?: string;
    }
): Parameters<typeof normalizeProviderError>[0] {
    const base: Parameters<typeof normalizeProviderError>[0] = {
        httpStatus: input.httpStatus,
        rawMessage: input.rawMessage,
        provider: input.provider,
    };
    if (input.providerCode !== undefined && input.providerCode !== "") {
        return { ...base, providerCode: input.providerCode };
    }
    return base;
}

export function resolveForErrorLog(input: {
    errorKey: string;
    messageZh: string;
    messageRaw?: string;
    httpStatus: number;
    provider?: string;
    providerCode?: string;
}): NormalizedErrorLog {
    const catalogHit = getCatalogEntry(input.errorKey);
    if (catalogHit) {
        return {
            errorKey: input.errorKey,
            numericCode: catalogHit.numericCode,
            category: catalogHit.category,
            messageZh: input.messageZh || catalogHit.messageZh,
        };
    }

    if (input.errorKey === "UNKNOWN_ERROR") {
        const n = normalizeProviderError(
            normalizeOpts({
                httpStatus: input.httpStatus,
                rawMessage: input.messageRaw || input.messageZh,
                provider: input.provider || "upstream",
                ...(input.providerCode !== undefined && input.providerCode !== ""
                    ? { providerCode: input.providerCode }
                    : {}),
            })
        );
        if (n.errorKey !== "UNKNOWN_LLM") {
            return { ...n, messageZh: input.messageZh || n.messageZh };
        }
        const unk = ERROR_CATALOG_CORE.UNKNOWN_ERROR;
        return {
            errorKey: "UNKNOWN_ERROR",
            numericCode: unk.numericCode,
            category: unk.category,
            messageZh: input.messageZh || unk.messageZh,
        };
    }

    if (input.errorKey.includes(".")) {
        const n = normalizeProviderError(
            normalizeOpts({
                httpStatus: input.httpStatus,
                rawMessage: input.messageRaw || input.messageZh,
                provider: input.provider || "seedance",
                providerCode: input.errorKey,
            })
        );
        return { ...n, messageZh: input.messageZh || n.messageZh };
    }

    const n = normalizeProviderError(
        normalizeOpts({
            httpStatus: input.httpStatus,
            rawMessage: input.messageRaw || input.messageZh,
            provider: input.provider || "upstream",
            ...(input.providerCode !== undefined && input.providerCode !== ""
                ? { providerCode: input.providerCode }
                : {}),
        })
    );
    if (n.errorKey !== "UNKNOWN_LLM") {
        return { ...n, messageZh: input.messageZh || n.messageZh };
    }

    const unk = ERROR_CATALOG_CORE.UNKNOWN_ERROR;
    return {
        errorKey: input.errorKey,
        numericCode: unk.numericCode,
        category: unk.category,
        messageZh: input.messageZh || unk.messageZh,
    };
}
