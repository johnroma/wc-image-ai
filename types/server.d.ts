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
import {
  withinOpenaiRatio,
  openaiGenerationSize,
  nearestGeminiRatio,
  type HeroProvider,
} from "./provider-ratios.js"
export { withinOpenaiRatio, openaiGenerationSize, nearestGeminiRatio }
export type GenerateOptions = {
  /** Which provider to call. Defaults to `'openai'`. */
  provider?: HeroProvider
  /** Explicit aspect-ratio string forwarded to Gemini (e.g. `'16:9'`).
   *  When omitted, the nearest supported ratio is derived from width/height. */
  aspectRatio?: string
  /** Override the OpenAI model. Falls back to `OPENAI_IMAGE_MODEL` env var,
   *  then `gpt-image-2`. */
  openaiModel?: string
  /** Override the Gemini model. Falls back to `GEMINI_IMAGE_MODEL` env var,
   *  then `gemini-3.1-flash-image`. */
  geminiModel?: string
  /** Explicit Gemini output-size tier (`'512'`, `'1K'`, `'2K'`).
   *  When omitted, size is derived automatically from the requested dimensions.
   *  Note: `'512'` is only supported by `gemini-3.1-flash-image`. */
  geminiImageSize?: string
  /** Per-request timeout in milliseconds. Defaults to 90 000 (90 s). */
  timeoutMs?: number
}
export type GeneratedBuffer = {
  buffer: Buffer
  mimeType: string
  width: number | null
  height: number | null
}
/**
 * Generate an image and return the raw bytes.
 *
 * Calls the specified provider (default: `openai`) and throws on failure —
 * no automatic fallback between providers.  If you need a fallback strategy,
 * catch the error and call again with a different provider.
 */
export declare function generateImageBuffer(
  prompt: string,
  width: number,
  height: number,
  options?: GenerateOptions,
): Promise<GeneratedBuffer>
