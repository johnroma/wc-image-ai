import { LitElement } from "lit";
export declare class AiImg extends LitElement {
    /**
     * A ready image URL (or data URL). When set, the component acts as a plain
     * <img> and never calls the AI endpoint — use it when you already have the
     * image (e.g. a precomputed/returning one). Highest priority.
     */
    src: string;
    /** Server route that owns the API key, generation, storage and lookup. */
    endpoint: string;
    /** Description used to generate the image (omit when fetching a known id). */
    prompt: string;
    /** Storage handle. Reflected after the server mints a new image. */
    imageId: string;
    /** Provider/model hint forwarded to the endpoint (e.g. "gemini", "openai"). */
    llm: string;
    /** Aspect ratio forwarded to the endpoint and used to derive an omitted height. */
    ratio: string;
    /** Shown when the image cannot be resolved (otherwise a 1x1 transparent PNG). */
    fallback: string;
    width: string;
    height: string;
    alt: string;
    /** Durable request state for hosts that attach event listeners after upgrade. */
    status: "idle" | "loading" | "loaded" | "error";
    /** Durable endpoint/load error message; also emitted via `ai-image-error`. */
    errorMessage: string;
    /** Durable HTTP status when the endpoint returned a non-success response. */
    errorStatus: number | undefined;
    private imgsrc;
    private imgAttributes;
    private onFallback;
    private retried;
    private resolvedUrl;
    private blobUrl;
    connectedCallback(): void;
    debugState(): {
        src: string;
        prompt: string;
        imageId: string;
        status: "error" | "loading" | "idle" | "loaded";
        blobUrl: string;
        imgsrc: string;
    };
    disconnectedCallback(): void;
    private start;
    private collectPassThroughAttributes;
    private resolve;
    private settle;
    private settleFallback;
    private dispatchError;
    private onImgError;
    protected render(): import("lit").TemplateResult<1>;
    static styles: import("lit").CSSResult;
}
declare global {
    interface HTMLElementTagNameMap {
        "ai-img": AiImg;
    }
}
