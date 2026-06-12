export declare const spinner = "<svg width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\"><style>.a{animation:b .8s linear infinite;fill:#888}.c{animation-delay:-.65s}.d{animation-delay:-.5s}@keyframes b{93.75%,100%{r:3px}46.875%{r:.2px}}</style><circle class=\"a\" cx=\"4\" cy=\"12\" r=\"3\"/><circle class=\"a c\" cx=\"12\" cy=\"12\" r=\"3\"/><circle class=\"a d\" cx=\"20\" cy=\"12\" r=\"3\"/></svg>";
export declare const TRANSPARENT_PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
export interface ResolveImageRequest {
    prompt?: string;
    imageId?: string;
    width?: number;
    height?: number;
    /** Provider/model hint forwarded to the endpoint (e.g. "gemini", "openai"). */
    llm?: string;
    /** Aspect ratio forwarded to the endpoint (e.g. "16:9", "4:1"). */
    ratio?: string;
}
export interface ResolvedImage {
    id: string;
    url: string;
}
/**
 * Sends a single POST to the endpoint and lets the server decide whether to
 * return an already-stored image (looked up by `imageId`) or generate a new
 * one. The component never branches on existence — it just trusts the result.
 *
 * Resolves to `{ id, url }` on success, or `null` when the endpoint is missing,
 * the request fails, or the server reports the image could not be resolved
 * (e.g. 404). A `null` tells the component to fall back.
 */
export declare const resolveImage: (endpoint: string, req: ResolveImageRequest) => Promise<ResolvedImage | null>;
