import "express-serve-static-core";

declare module "express-serve-static-core" {
    interface Request {
        traceId?: string;
        user?: {
            userId: number;
            username: string;
            role: number;
            type?: string;
        };
    }
}

export {};
