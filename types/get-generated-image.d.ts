import type { MediaPrompt } from '@tanstack/ai';
export declare const spinner = "<svg width=\"32\" height=\"16\" viewBox=\"0 0 32 16\" xmlns=\"http://www.w3.org/2000/svg\"><style>.d{fill:#777;transform-origin:center;animation:think 1.05s cubic-bezier(.4,0,.2,1) infinite}.b{animation-delay:.14s}.c{animation-delay:.28s}@keyframes think{0%,60%,100%{opacity:.28;transform:translateY(0) scale(.72)}30%{opacity:1;transform:translateY(-2px) scale(1)}}</style><circle class=\"d\" cx=\"8\" cy=\"9\" r=\"1.8\"/><circle class=\"d b\" cx=\"16\" cy=\"9\" r=\"1.8\"/><circle class=\"d c\" cx=\"24\" cy=\"9\" r=\"1.8\"/></svg>";
/** Image-transfer glyph: a framed landscape with a scanning highlight. */
export declare const imageLoader = "<svg width=\"32\" height=\"24\" viewBox=\"0 0 32 24\" xmlns=\"http://www.w3.org/2000/svg\"><defs><clipPath id=\"f\"><rect x=\"4\" y=\"3\" width=\"24\" height=\"18\" rx=\"3\"/></clipPath><linearGradient id=\"s\" x1=\"0\" x2=\"1\"><stop stop-color=\"#888\" stop-opacity=\"0\"/><stop offset=\".5\" stop-color=\"#888\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#888\" stop-opacity=\"0\"/></linearGradient></defs><g fill=\"none\" stroke=\"#888\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"4\" y=\"3\" width=\"24\" height=\"18\" rx=\"3\" opacity=\".65\"/><circle cx=\"21.5\" cy=\"8.5\" r=\"1.5\" opacity=\".65\"/><path d=\"m7 18 6-6 4 4 2-2 6 4\" opacity=\".65\"/></g><g clip-path=\"url(#f)\"><rect class=\"scan\" x=\"-12\" y=\"3\" width=\"12\" height=\"18\" fill=\"url(#s)\" transform=\"skewX(-12)\"/></g><style>.scan{animation:scan 1.35s cubic-bezier(.4,0,.2,1) infinite}@keyframes scan{0%{transform:translateX(-8px) skewX(-12deg)}70%,100%{transform:translateX(52px) skewX(-12deg)}}</style></svg>";
export declare const TRANSPARENT_PIXEL: string;
export interface ResolveImageRequest {
    prompt?: MediaPrompt;
    imageId?: string;
    width?: number;
    height?: number;
    /** Provider/model hint forwarded to the endpoint (e.g. "gemini", "openai"). */
    llm?: string;
    /** Exact image model hint forwarded to endpoints that support model selection. */
    model?: string;
    /** Aspect ratio forwarded to the endpoint (e.g. "16:9", "4:1"). */
    ratio?: string;
    /** Prefer a faster/lower-cost model when the selected provider supports it. */
    light?: boolean;
    /** Use a locally configured subscription transport instead of API billing. */
    subscription?: boolean;
    /** Bypass and replace any cache entry for this generation identity. */
    regenerate?: boolean;
}
export interface ResolvedImage {
    id: string;
    url: string;
    /** Present when the endpoint returned raw image bytes (blob-proxy mode).
     *  The host is responsible for uploading this to a storage endpoint. */
    blob?: Blob;
}
export interface PendingImageResponse extends Record<string, unknown> {
    id?: string;
    status: 'pending' | 'processing';
    statusUrl?: string;
}
export interface FailedImageResponse extends Record<string, unknown> {
    id?: string;
    status: 'error';
    error?: string;
}
export type ResolveImageStatusEvent = PendingImageResponse | FailedImageResponse | ({
    id?: string;
    status: 'completed';
    url: string;
} & Partial<ResolvedImage>);
export interface ResolveImageOptions {
    pollIntervalMs?: number;
    maxPollAttempts?: number;
    onStatus?: (event: ResolveImageStatusEvent & {
        attempt: number;
    }) => void;
}
export declare class ResolveImageError extends Error {
    readonly status?: number | undefined;
    constructor(message: string, status?: number | undefined);
}
/**
 * Sends a single POST to the endpoint and lets the server decide whether to
 * return an already-stored image (looked up by `imageId`) or generate a new
 * one. The component never branches on existence — it just trusts the result.
 *
 * Resolves to `{ id, url }` on success and throws `ResolveImageError` with the
 * endpoint's message/status on failure.
 */
export declare const resolveImage: (endpoint: string, req: ResolveImageRequest, options?: ResolveImageOptions) => Promise<ResolvedImage>;
