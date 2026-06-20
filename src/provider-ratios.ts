/**
 * Provider capabilities — single source of truth for both client and server.
 *
 * - The wc validates llm+ratio before making any endpoint call.
 * - The server module uses PROVIDER_CANVAS_CAPABILITIES / generationCanvasForProvider
 *   to map a requested pixel canvas to what each provider actually accepts.
 * - App code imports the typed ratio unions (OpenAiRatio, GeminiRatio) so
 *   TypeScript enforces the same constraints at compile time.
 */

export type HeroProvider = 'openai' | 'gemini'

type PixelCanvasCapabilities = {
  mode: 'pixel-canvas'
  minDimension: number
  minPixelBudget: number
  dimensionStep: number
  maxAspectRatio: number
}

type RatioEnumCapabilities = {
  mode: 'ratio-enum'
  imageSize2KThreshold: number
}

export type ProviderCanvasCapabilities =
  | PixelCanvasCapabilities
  | RatioEnumCapabilities

export const PROVIDER_CANVAS_CAPABILITIES = {
  openai: {
    mode: 'pixel-canvas',
    minDimension: 512,
    // OpenAI does not publish the numeric current minimum. 512x768 is rejected;
    // 1024x1024 is the smallest documented standard GPT Image canvas.
    minPixelBudget: 1024 * 1024,
    dimensionStep: 16,
    maxAspectRatio: 3,
  },
  gemini: {
    mode: 'ratio-enum',
    imageSize2KThreshold: 1024,
  },
} as const satisfies Record<HeroProvider, ProviderCanvasCapabilities>

function roundUp(value: number, step: number): number {
  return Math.ceil(value / step) * step
}

/**
 * Returns the provider-facing generation canvas. Ratio-enum providers ignore
 * pixel dimensions; pixel-canvas providers may need a larger source canvas
 * than the requested final output.
 */
export function generationCanvasForProvider(
  provider: HeroProvider,
  width: number,
  height: number,
): { width: number; height: number } {
  const capabilities = PROVIDER_CANVAS_CAPABILITIES[provider]
  if (capabilities.mode === 'ratio-enum') return { width, height }

  const scale = Math.max(
    1,
    capabilities.minDimension / width,
    capabilities.minDimension / height,
    Math.sqrt(capabilities.minPixelBudget / (width * height)),
  )

  return {
    width: roundUp(width * scale, capabilities.dimensionStep),
    height: roundUp(height * scale, capabilities.dimensionStep),
  }
}

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

// --- Pixel-canvas utilities (pure, usable in browser and server) ---

/** Whether a width×height canvas fits within OpenAI's 3:1 aspect-ratio limit. */
export function withinOpenaiRatio(width: number, height: number): boolean {
  const ratio = width / height
  const { maxAspectRatio } = PROVIDER_CANVAS_CAPABILITIES.openai
  return ratio <= maxAspectRatio && ratio >= 1 / maxAspectRatio
}

/** The `WxH` size string to pass to the OpenAI images API for a given canvas. */
export function openaiGenerationSize(width: number, height: number): string {
  const canvas = generationCanvasForProvider('openai', width, height)
  return `${canvas.width}x${canvas.height}`
}

// GEMINI_RATIOS as numeric pairs for nearest-ratio snapping.
const GEMINI_RATIO_PAIRS = GEMINI_RATIOS.map((r) => {
  const [w, h] = r.split(':').map(Number)
  return [r, w / h] as const
})

/** The nearest Gemini aspect-ratio string for a given pixel canvas. */
export function nearestGeminiRatio(width: number, height: number): string {
  const target = width / height
  let best = '1:1'
  let bestDistance = Infinity
  for (const [label, ratio] of GEMINI_RATIO_PAIRS) {
    const distance = Math.abs(Math.log(ratio / target))
    if (distance < bestDistance) {
      bestDistance = distance
      best = label
    }
  }
  return best
}
