/**
 * Aspect ratios each image provider accepts — single source of truth.
 *
 * The wc validates llm+ratio before making any endpoint call. The app imports
 * the exported types (OpenAiRatio, GeminiRatio) so TypeScript can enforce the
 * same constraints at compile time without duplicating the lists.
 */

export const OPENAI_RATIOS = [
  '1:1',
  '3:2', '2:3',
  '4:3', '3:4',
  '5:4', '4:5',
  '16:9', '9:16',
  '21:9', '9:21',
  '3:1', '1:3',
] as const

export const GEMINI_RATIOS = [
  '1:1',
  '3:2', '2:3',
  '4:3', '3:4',
  '5:4', '4:5',
  '16:9', '9:16',
  '21:9',
  '4:1', '1:4',
  '8:1', '1:8',
] as const

/** Literal union of every ratio gpt-image-2 accepts. */
export type OpenAiRatio = (typeof OPENAI_RATIOS)[number]
/** Literal union of every ratio Gemini accepts. */
export type GeminiRatio = (typeof GEMINI_RATIOS)[number]

export const PROVIDER_RATIOS: Readonly<Record<string, ReadonlySet<string>>> = {
  openai: new Set<string>(OPENAI_RATIOS),
  gemini: new Set<string>(GEMINI_RATIOS),
}

export function isRatioSupported(provider: string, ratio: string): boolean {
  return PROVIDER_RATIOS[provider]?.has(ratio) ?? true
}
