/**
 * Provider capabilities — single source of truth for both client and server.
 *
 * - The wc validates llm+ratio before making any endpoint call.
 * - The server module uses PROVIDER_CANVAS_CAPABILITIES / generationCanvasForProvider
 *   to map a requested pixel canvas to what each provider actually accepts.
 * - App code imports the typed ratio unions (OpenAiRatio, GeminiRatio) so
 *   TypeScript enforces the same constraints at compile time.
 */
export type HeroProvider = 'openai' | 'gemini';
type PixelCanvasCapabilities = {
    mode: 'pixel-canvas';
    minDimension: number;
    minPixelBudget: number;
    dimensionStep: number;
    maxAspectRatio: number;
};
type RatioEnumCapabilities = {
    mode: 'ratio-enum';
    imageSize2KThreshold: number;
};
export type ProviderCanvasCapabilities = PixelCanvasCapabilities | RatioEnumCapabilities;
export declare const PROVIDER_CANVAS_CAPABILITIES: {
    readonly openai: {
        readonly mode: "pixel-canvas";
        readonly minDimension: 512;
        readonly minPixelBudget: number;
        readonly dimensionStep: 16;
        readonly maxAspectRatio: 3;
    };
    readonly gemini: {
        readonly mode: "ratio-enum";
        readonly imageSize2KThreshold: 1024;
    };
};
/**
 * Returns the provider-facing generation canvas. Ratio-enum providers ignore
 * pixel dimensions; pixel-canvas providers may need a larger source canvas
 * than the requested final output.
 */
export declare function generationCanvasForProvider(provider: HeroProvider, width: number, height: number): {
    width: number;
    height: number;
};
export declare const OPENAI_RATIOS: readonly ["1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "21:9", "9:21", "3:1", "1:3"];
export declare const GEMINI_RATIOS: readonly ["1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "21:9", "4:1", "1:4", "8:1", "1:8"];
/** Literal union of every ratio gpt-image-2 accepts. */
export type OpenAiRatio = (typeof OPENAI_RATIOS)[number];
/** Literal union of every ratio Gemini accepts. */
export type GeminiRatio = (typeof GEMINI_RATIOS)[number];
export declare const PROVIDER_RATIOS: Readonly<Record<string, ReadonlySet<string>>>;
export declare function isRatioSupported(provider: string, ratio: string): boolean;
/** Whether a width×height canvas fits within OpenAI's 3:1 aspect-ratio limit. */
export declare function withinOpenaiRatio(width: number, height: number): boolean;
/** The `WxH` size string to pass to the OpenAI images API for a given canvas. */
export declare function openaiGenerationSize(width: number, height: number): string;
/** The nearest Gemini aspect-ratio string for a given pixel canvas. */
export declare function nearestGeminiRatio(width: number, height: number): string;
export {};
