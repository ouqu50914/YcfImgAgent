export type ProviderName = 'ace' | 'anyfast';

export class ProviderError extends Error {
    code: string;
    status: number;
    provider: ProviderName;
    transient: boolean;

    constructor(params: {
        code: string;
        message: string;
        provider: ProviderName;
        status?: number;
        transient?: boolean;
    }) {
        super(params.message);
        this.code = params.code;
        this.status = params.status ?? 502;
        this.provider = params.provider;
        this.transient = params.transient ?? false;
    }
}

export function isTransientProviderError(error: unknown): boolean {
    if (error instanceof ProviderError) return error.transient;
    return false;
}
