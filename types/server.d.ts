/**
 * Server-side generation module for wc-img-ai.
 *
 * Executes a single generation request against the specified provider and
 * returns raw bytes.  No fallback logic — the caller decides which provider
 * to use and what to do when it fails.
 *
 * Usage:
 *   import { generateImageBuffer } from 'wc-img-ai/server'
 *   const { buffer, mimeType } = await generateImageBuffer(prompt, 1536, 864, {
 *     provider: 'gemini',
 *     aspectRatio: '16:9',
 *   })
 */
import type { MediaPrompt } from '@tanstack/ai';
export type { MediaPrompt, MediaPromptPart } from '@tanstack/ai';
import { assertGeminiGenerationSupported, GEMINI_FLASH_IMAGE_MODEL, GEMINI_FLASH_LITE_IMAGE_MODEL, type GeminiFlashImageSize, type GeminiFlashLiteImageSize, type GeminiRatio, geminiModelCapabilities, type HeroProvider, nearestGeminiRatio, type OpenAiImageModel, openaiGenerationSize, withinOpenaiRatio } from './provider-ratios.js';
export type { GeminiImageModel, GeminiImageSize, GeminiRatio, OpenAiImageModel, } from './provider-ratios.js';
export { assertGeminiGenerationSupported, geminiModelCapabilities, nearestGeminiRatio, openaiGenerationSize, withinOpenaiRatio, };
type BuiltinGenerateOptionsBase = {
    /** Which provider to call. Defaults to `'openai'`. */
    provider?: HeroProvider;
    /** Explicit aspect-ratio string forwarded to Gemini (e.g. `'16:9'`).
     *  When omitted, the nearest supported ratio is derived from width/height. */
    aspectRatio?: GeminiRatio;
    /** Override the OpenAI model. Falls back to `OPENAI_IMAGE_MODEL` env var,
     *  then `gpt-image-2`. */
    openaiModel?: OpenAiImageModel;
    /** Per-request timeout in milliseconds. Defaults to 90 000 (90 s). */
    timeoutMs?: number;
};
type GeminiFlashOptions = {
    /** Regular Gemini Flash is selected when light is absent or false. */
    light?: false;
    geminiModel?: typeof GEMINI_FLASH_IMAGE_MODEL;
    geminiImageSize?: GeminiFlashImageSize;
};
type GeminiFlashLiteOptions = {
    /** Select the faster/lower-cost Flash Lite model. */
    light: true;
    geminiModel?: typeof GEMINI_FLASH_LITE_IMAGE_MODEL;
    geminiImageSize?: GeminiFlashLiteImageSize;
};
/**
 * Generation options with model-specific Gemini image-size constraints.
 * The 512 tier cannot be paired with `light: true`, because Flash Lite starts
 * at 1K. Explicit model names remain available for server-side configuration.
 */
export type BuiltinGenerateOptions = BuiltinGenerateOptionsBase & (GeminiFlashOptions | GeminiFlashLiteOptions);
export type CustomGenerateRequest = {
    prompt: MediaPrompt;
    width: number;
    height: number;
    /** Aborts when timeoutMs elapses. Custom generators should pass this signal
     *  to fetch, child-process handling, or other cancellable work. */
    signal: AbortSignal;
};
export type CustomGenerateResult = {
    buffer: Uint8Array;
    mimeType: `image/${string}`;
};
export type CustomImageGenerator = (request: CustomGenerateRequest) => Promise<CustomGenerateResult>;
export type CustomGenerateOptions = {
    provider: 'custom';
    generate: CustomImageGenerator;
    /** Per-request timeout in milliseconds. Defaults to 90 000 (90 s). */
    timeoutMs?: number;
};
/** Built-in provider configuration or an explicitly selected custom transport. */
export type GenerateOptions = BuiltinGenerateOptions | CustomGenerateOptions;
export type GeneratedBuffer = {
    buffer: Buffer;
    mimeType: string;
    width: number | null;
    height: number | null;
};
/**
 * Generate an image and return the raw bytes.
 *
 * Calls the specified provider (default: `openai`) and throws on failure —
 * no automatic fallback between providers.  If you need a fallback strategy,
 * catch the error and call again with a different provider.
 */
export declare function generateImageBuffer(prompt: MediaPrompt, width: number, height: number, options?: GenerateOptions): Promise<GeneratedBuffer>;
