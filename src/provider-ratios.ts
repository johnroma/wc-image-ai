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

export const OPENAI_IMAGE_MODELS = ['gpt-image-2', 'gpt-image-1'] as const
export type OpenAiImageModel = (typeof OPENAI_IMAGE_MODELS)[number]

export const GEMINI_FLASH_IMAGE_MODEL = 'gemini-3.1-flash-image' as const
export const GEMINI_FLASH_LITE_IMAGE_MODEL =
  'gemini-3.1-flash-lite-image' as const
export const GEMINI_IMAGE_MODELS = [
  GEMINI_FLASH_IMAGE_MODEL,
  GEMINI_FLASH_LITE_IMAGE_MODEL,
] as const
export type GeminiImageModel = (typeof GEMINI_IMAGE_MODELS)[number]

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
  '3:2',
  '2:3',
  '4:3',
  '3:4',
  '5:4',
  '4:5',
  '16:9',
  '9:16',
  '21:9',
  '9:21',
  '3:1',
  '1:3',
] as const

export const GEMINI_RATIOS = [
  '1:1',
  '3:2',
  '2:3',
  '4:3',
  '3:4',
  '5:4',
  '4:5',
  '16:9',
  '9:16',
  '21:9',
  '4:1',
  '1:4',
  '8:1',
  '1:8',
] as const

// Flash Lite supports only the standard 10 ratios documented on its model
// capability page; the extreme 4:1/1:4/8:1/1:8 ratios are Flash-only.
export const GEMINI_FLASH_LITE_RATIOS = [
  '1:1',
  '3:2',
  '2:3',
  '4:3',
  '3:4',
  '5:4',
  '4:5',
  '16:9',
  '9:16',
  '21:9',
] as const satisfies readonly GeminiRatio[]

/** Literal union of every ratio gpt-image-2 accepts. */
export type OpenAiRatio = (typeof OPENAI_RATIOS)[number]
/** Literal union of every ratio supported by a known Gemini image model. */
export type GeminiRatio = (typeof GEMINI_RATIOS)[number]

export const GEMINI_FLASH_IMAGE_SIZES = ['512', '1K', '2K', '4K'] as const
export const GEMINI_FLASH_LITE_IMAGE_SIZES = ['1K'] as const
export type GeminiFlashImageSize = (typeof GEMINI_FLASH_IMAGE_SIZES)[number]
export type GeminiFlashLiteImageSize =
  (typeof GEMINI_FLASH_LITE_IMAGE_SIZES)[number]
export type GeminiImageSize = GeminiFlashImageSize | GeminiFlashLiteImageSize

export type GeminiModelCapabilities = {
  readonly ratios: readonly GeminiRatio[]
  readonly imageSizes: readonly GeminiImageSize[]
  readonly defaultImageSize: GeminiImageSize
}

/**
 * Model-specific Gemini request capabilities. Keep API constraints here rather
 * than scattering model-name checks through server and application code.
 */
export const GEMINI_MODEL_CAPABILITIES = {
  [GEMINI_FLASH_IMAGE_MODEL]: {
    ratios: GEMINI_RATIOS,
    imageSizes: GEMINI_FLASH_IMAGE_SIZES,
    defaultImageSize: '1K',
  },
  [GEMINI_FLASH_LITE_IMAGE_MODEL]: {
    ratios: GEMINI_FLASH_LITE_RATIOS,
    imageSizes: GEMINI_FLASH_LITE_IMAGE_SIZES,
    defaultImageSize: '1K',
  },
} as const satisfies Record<GeminiImageModel, GeminiModelCapabilities>

export function geminiModelCapabilities(
  model: string,
): GeminiModelCapabilities | undefined {
  return GEMINI_MODEL_CAPABILITIES[model as GeminiImageModel]
}

export function isGeminiRatioSupported(
  model: string,
  ratio: string,
): ratio is GeminiRatio {
  return (
    geminiModelCapabilities(model)?.ratios.includes(ratio as GeminiRatio) ??
    false
  )
}

export function isGeminiImageSizeSupported(
  model: string,
  imageSize: string,
): imageSize is GeminiImageSize {
  return (
    geminiModelCapabilities(model)?.imageSizes.includes(
      imageSize as GeminiImageSize,
    ) ?? false
  )
}

export function assertGeminiGenerationSupported(
  model: string,
  ratio: string,
  imageSize?: string,
): asserts imageSize is GeminiImageSize | undefined {
  const capabilities = geminiModelCapabilities(model)
  if (!capabilities) {
    throw new Error(
      `Unknown Gemini image model ${model}; supported models: ${GEMINI_IMAGE_MODELS.join(', ')}`,
    )
  }
  if (!isGeminiRatioSupported(model, ratio)) {
    throw new Error(
      `Aspect ratio ${ratio} is not supported by ${model}; supported ratios: ${capabilities.ratios.join(', ')}`,
    )
  }
  if (imageSize && !isGeminiImageSizeSupported(model, imageSize)) {
    throw new Error(
      `Image size ${imageSize} is not supported by ${model}; supported sizes: ${capabilities.imageSizes.join(', ')}`,
    )
  }
}

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
export function nearestGeminiRatio(
  width: number,
  height: number,
  model?: GeminiImageModel,
): GeminiRatio {
  const target = width / height
  let best: GeminiRatio = '1:1'
  let bestDistance = Infinity
  const supportedRatios: readonly GeminiRatio[] = model
    ? GEMINI_MODEL_CAPABILITIES[model].ratios
    : GEMINI_RATIOS
  for (const [label, ratio] of GEMINI_RATIO_PAIRS) {
    if (!supportedRatios.includes(label)) continue
    const distance = Math.abs(Math.log(ratio / target))
    if (distance < bestDistance) {
      bestDistance = distance
      best = label
    }
  }
  return best
}
