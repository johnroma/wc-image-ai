declare global {
    interface AIImage extends HTMLImageElement {
        "data-fallback"?: string;
    }
    interface HTMLElementTagNameMap {
        "ai-image": AIImage;
    }
}
export {};
