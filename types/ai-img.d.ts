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
    /** Storage handle. Reflected: set by the server when a new image is minted. */
    imageId: string;
    /** Provider/model hint forwarded to the endpoint (e.g. "gemini", "openai"). */
    llm: string;
    /** Aspect ratio forwarded to the endpoint (e.g. "16:9", "4:1"). */
    ratio: string;
    /** Shown when the image cannot be resolved (otherwise a 1x1 transparent PNG). */
    fallback: string;
    width: string;
    height: string;
    alt: string;
    private imgsrc;
    private imgAttributes;
    private onFallback;
    private retried;
    private resolvedUrl;
    connectedCallback(): void;
    private start;
    private collectPassThroughAttributes;
    private resolve;
    private settle;
    private settleFallback;
    private onImgError;
    protected render(): import("lit").TemplateResult<1>;
    static styles: import("lit").CSSResult;
}
declare global {
    interface HTMLElementTagNameMap {
        "ai-img": AiImg;
    }
}
