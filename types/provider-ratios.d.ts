/**
 * Aspect ratios each image provider accepts — single source of truth.
 *
 * The wc validates llm+ratio before making any endpoint call. The app imports
 * the exported types (OpenAiRatio, GeminiRatio) so TypeScript can enforce the
 * same constraints at compile time without duplicating the lists.
 */
export declare const OPENAI_RATIOS: readonly ["1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "21:9", "9:21", "3:1", "1:3"];
export declare const GEMINI_RATIOS: readonly ["1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "21:9", "4:1", "1:4", "8:1", "1:8"];
/** Literal union of every ratio gpt-image-2 accepts. */
export type OpenAiRatio = (typeof OPENAI_RATIOS)[number];
/** Literal union of every ratio Gemini accepts. */
export type GeminiRatio = (typeof GEMINI_RATIOS)[number];
export declare const PROVIDER_RATIOS: Readonly<Record<string, ReadonlySet<string>>>;
export declare function isRatioSupported(provider: string, ratio: string): boolean;
