import { isTransientProviderError } from "../adapters/provider-error";

export function isFallbackEligible(error: unknown, transientOnly: boolean): boolean {
    if (!transientOnly) return true;
    return isTransientProviderError(error);
}

export function calculateNanoPolicyRates(metrics: {
    totalRequests: number;
    switchedToAnyfast: number;
    finalAnyfast: number;
}) {
    if (metrics.totalRequests <= 0) {
        return {
            switchToAnyfastRate: "0",
            anyfastFinalRate: "0",
        };
    }
    return {
        switchToAnyfastRate: (metrics.switchedToAnyfast / metrics.totalRequests).toFixed(4),
        anyfastFinalRate: (metrics.finalAnyfast / metrics.totalRequests).toFixed(4),
    };
}
