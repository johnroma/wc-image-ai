import { LitElement } from "lit";
export declare class AiImg extends LitElement {
    fallback: string;
    width: string;
    height: string;
    src: string;
    alt: string;
    imgsrc: string;
    prompt: string;
    imgAttributes: {
        [key: string]: string;
    };
    connectedCallback(): void;
    protected constructor();
    private _onImgError;
    protected render(): import("lit").TemplateResult<1>;
    static styles: import("lit").CSSResult;
}
declare global {
    interface HTMLElementTagNameMap {
        "ai-img": AiImg;
    }
}
