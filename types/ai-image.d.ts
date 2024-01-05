export declare class AIImage extends HTMLImageElement {
    static get observedAttributes(): string[];
    private _fallbackSrc;
    private _prompt;
    private _originalSrc;
    private svgPlaceholder;
    private _endpoint;
    private ph_w;
    private ph_h;
    constructor();
    get src(): string;
    set src(value: string);
    set fallbackSrc(value: string | null);
    attributeChangedCallback(name: string, _oldValue: string, newValue: string): void;
    protected getGeneratedImage: (endpoint: string, prompt: string, width: number, height: number) => Promise<string | undefined>;
}
declare global {
    interface AIImage extends HTMLImageElement {
        "data-fallback"?: string;
    }
    interface HTMLElementTagNameMap {
        "ai-image": AIImage;
    }
}
