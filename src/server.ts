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
  assertGeminiGenerationSupported,
  GEMINI_FLASH_IMAGE_MODEL,
  GEMINI_FLASH_LITE_IMAGE_MODEL,
  type GeminiFlashImageSize,
  type GeminiFlashLiteImageSize,
  type GeminiImageModel,
  type GeminiImageSize,
  type GeminiRatio,
  geminiModelCapabilities,
  type HeroProvider,
  nearestGeminiRatio,
  type OpenAiImageModel,
  openaiGenerationSize,
  withinOpenaiRatio,
} from './provider-ratios.js'

export type {
  GeminiImageModel,
  GeminiImageSize,
  GeminiRatio,
  OpenAiImageModel,
} from './provider-ratios.js'
export {
  assertGeminiGenerationSupported,
  geminiModelCapabilities,
  nearestGeminiRatio,
  openaiGenerationSize,
  withinOpenaiRatio,
}

const OPENAI_BASE = 'https://api.openai.com/v1'
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const OPENAI_IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
const DEFAULT_OPENAI_MODEL: OpenAiImageModel = 'gpt-image-2'
const DEFAULT_GEMINI_MODEL: GeminiImageModel = GEMINI_FLASH_IMAGE_MODEL
const MAX_OUTPUT_DIMENSION = 4096

type BuiltinGenerateOptionsBase = {
  /** Which provider to call. Defaults to `'openai'`. */
  provider?: HeroProvider
  /** Explicit aspect-ratio string forwarded to Gemini (e.g. `'16:9'`).
   *  When omitted, the nearest supported ratio is derived from width/height. */
  aspectRatio?: GeminiRatio
  /** Override the OpenAI model. Falls back to `OPENAI_IMAGE_MODEL` env var,
   *  then `gpt-image-2`. */
  openaiModel?: OpenAiImageModel
  /** Per-request timeout in milliseconds. Defaults to 90 000 (90 s). */
  timeoutMs?: number
  /** Optional source image Blob. OpenAI routes requests with this value to
   *  the multipart images/edits endpoint. */
  referenceImage?: Blob
}

type GeminiFlashOptions = {
  /** Regular Gemini Flash is selected when light is absent or false. */
  light?: false
  geminiModel?: typeof GEMINI_FLASH_IMAGE_MODEL
  geminiImageSize?: GeminiFlashImageSize
}

type GeminiFlashLiteOptions = {
  /** Select the faster/lower-cost Flash Lite model. */
  light: true
  geminiModel?: typeof GEMINI_FLASH_LITE_IMAGE_MODEL
  geminiImageSize?: GeminiFlashLiteImageSize
}

/**
 * Generation options with model-specific Gemini image-size constraints.
 * The 512 tier cannot be paired with `light: true`, because Flash Lite starts
 * at 1K. Explicit model names remain available for server-side configuration.
 */
export type BuiltinGenerateOptions = BuiltinGenerateOptionsBase &
  (GeminiFlashOptions | GeminiFlashLiteOptions)

export type CustomGenerateRequest = {
  prompt: string
  width: number
  height: number
  /** Aborts when timeoutMs elapses. Custom generators should pass this signal
   *  to fetch, child-process handling, or other cancellable work. */
  signal: AbortSignal
}

export type CustomGenerateResult = {
  buffer: Uint8Array
  mimeType: `image/${string}`
}

export type CustomImageGenerator = (
  request: CustomGenerateRequest,
) => Promise<CustomGenerateResult>

export type CustomGenerateOptions = {
  provider: 'custom'
  generate: CustomImageGenerator
  /** Per-request timeout in milliseconds. Defaults to 90 000 (90 s). */
  timeoutMs?: number
}

/** Built-in provider configuration or an explicitly selected custom transport. */
export type GenerateOptions = BuiltinGenerateOptions | CustomGenerateOptions

export type GeneratedBuffer = {
  buffer: Buffer
  mimeType: string
  width: number | null
  height: number | null
}

function outputDimension(value: unknown): number | undefined {
  const dimension = Number(value)
  if (!Number.isInteger(dimension) || dimension <= 0) return undefined
  if (dimension > MAX_OUTPUT_DIMENSION) {
    throw new Error(`image dimensions cannot exceed ${MAX_OUTPUT_DIMENSION}px`)
  }
  return dimension
}

// --- Provider implementations ---

async function callCustom(
  generate: CustomImageGenerator,
  prompt: string,
  width: number,
  height: number,
  timeoutMs: number,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const signal = AbortSignal.timeout(timeoutMs)
  const aborted = new Promise<never>((_, reject) => {
    signal.addEventListener(
      'abort',
      () =>
        reject(signal.reason ?? new Error('custom image generation timed out')),
      { once: true },
    )
  })
  const result = await Promise.race([
    generate({ prompt, width, height, signal }),
    aborted,
  ])
  if (
    !(result.buffer instanceof Uint8Array) ||
    result.buffer.byteLength === 0
  ) {
    throw new Error(
      'Custom image generator returned an empty or invalid buffer',
    )
  }
  if (!result.mimeType.startsWith('image/')) {
    throw new Error(
      `Custom image generator returned invalid MIME type: ${result.mimeType}`,
    )
  }
  return { buffer: Buffer.from(result.buffer), mimeType: result.mimeType }
}

async function callOpenAIEdition(
  prompt: string,
  referenceImageBlob: Blob,
  size: string,
  model: string,
  timeoutMs: number,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set')

  const formData = new FormData()
  const extension = OPENAI_IMAGE_EXTENSIONS[referenceImageBlob.type]
  const sourceBase =
    typeof File !== 'undefined' && referenceImageBlob instanceof File
      ? referenceImageBlob.name.replace(/\.[^.]*$/, '')
      : 'reference-image'
  const sanitizedBase = sourceBase
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
  const filename = `${sanitizedBase || 'reference-image'}.${extension}`
  formData.append('model', model)
  formData.append('prompt', prompt)
  formData.append('n', '1')
  formData.append('size', size)
  formData.append('image', referenceImageBlob, filename)

  const response = await fetch(`${OPENAI_BASE}/images/edits`, {
    method: 'POST',
    headers: { Authorization: ['Bearer', apiKey].join(' ') },
    body: formData,
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!response.ok) {
    const text = (await response.text()).trim()
    let message = `OpenAI image edition failed (${response.status})`
    try {
      const body = JSON.parse(text) as { error?: { message?: string } }
      if (body.error?.message) message = body.error.message
    } catch {
      message = text.replace(/\s+/g, ' ').slice(0, 300)
    }
    throw new Error(message)
  }

  const data = (await response.json()) as {
    data?: Array<{ b64_json?: string }>
  }
  const base64 = data?.data?.[0]?.b64_json
  if (!base64) throw new Error(`OpenAI ${model} returned no image data`)
  return { buffer: Buffer.from(base64, 'base64'), mimeType: 'image/png' }
}

async function callOpenAI(
  prompt: string,
  size: string,
  model: string,
  timeoutMs: number,
  referenceImage?: Blob,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set')

  if (referenceImage !== undefined) {
    if (!(referenceImage instanceof Blob)) {
      throw new TypeError('Reference image must be a Blob')
    }
    if (referenceImage.size === 0) {
      throw new Error('Reference image is empty')
    }
    if (!(referenceImage.type in OPENAI_IMAGE_EXTENSIONS)) {
      throw new Error(
        `Reference image has unsupported MIME type: ${referenceImage.type || 'unknown'}`,
      )
    }
    return callOpenAIEdition(prompt, referenceImage, size, model, timeoutMs)
  }

  const response = await fetch(`${OPENAI_BASE}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, prompt, n: 1, size }),
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!response.ok) {
    const text = (await response.text()).trim()
    let message = `OpenAI image generation failed (${response.status})`
    try {
      const body = JSON.parse(text) as { error?: { message?: string } }
      if (body.error?.message) message = body.error.message
    } catch {
      message = text.replace(/\s+/g, ' ').slice(0, 300)
    }
    throw new Error(message)
  }

  const data = (await response.json()) as {
    data?: Array<{ b64_json?: string }>
  }
  const base64 = data?.data?.[0]?.b64_json
  if (!base64) throw new Error(`OpenAI ${model} returned no image data`)
  return { buffer: Buffer.from(base64, 'base64'), mimeType: 'image/png' }
}

async function callGemini(
  prompt: string,
  width: number,
  height: number,
  model: string,
  timeoutMs: number,
  explicitRatio?: GeminiRatio,
  explicitImageSize?: GeminiImageSize,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set')

  const capabilities = geminiModelCapabilities(model)
  const ratio = explicitRatio ?? nearestGeminiRatio(width, height)
  const requestedSize =
    explicitImageSize ??
    (Math.max(width, height) > 2048
      ? '4K'
      : Math.max(width, height) > 1024
        ? '2K'
        : capabilities?.defaultImageSize)
  assertGeminiGenerationSupported(model, ratio, requestedSize)

  const response = await fetch(
    `${GEMINI_BASE}/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: {
            aspectRatio: ratio,
            imageSize: requestedSize,
          },
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    },
  )

  if (!response.ok) {
    const text = (await response.text()).trim()
    let message = `Gemini image generation failed (${response.status})`
    try {
      const body = JSON.parse(text) as { error?: { message?: string } }
      if (body.error?.message) message = body.error.message
    } catch {
      message = text.replace(/\s+/g, ' ').slice(0, 300)
    }
    throw new Error(message)
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ inlineData?: { data: string; mimeType?: string } }>
      }
    }>
  }
  const parts = data?.candidates?.[0]?.content?.parts ?? []
  const inline = parts.find((p) => p.inlineData)?.inlineData
  if (!inline) throw new Error(`Gemini ${model} returned no image data`)
  return {
    buffer: Buffer.from(inline.data, 'base64'),
    mimeType: inline.mimeType ?? 'image/jpeg',
  }
}

// --- Public API ---

/**
 * Generate an image and return the raw bytes.
 *
 * Calls the specified provider (default: `openai`) and throws on failure —
 * no automatic fallback between providers.  If you need a fallback strategy,
 * catch the error and call again with a different provider.
 */
export async function generateImageBuffer(
  prompt: string,
  width: number,
  height: number,
  options: GenerateOptions = {},
): Promise<GeneratedBuffer> {
  const requestedWidth = outputDimension(width)
  const requestedHeight = outputDimension(height)
  const w = requestedWidth ?? 1024
  const h = requestedHeight ?? 1024
  const timeoutMs = options.timeoutMs ?? 90_000

  let result: { buffer: Buffer; mimeType: string }

  if (options.provider === 'custom') {
    result = await callCustom(options.generate, prompt, w, h, timeoutMs)
  } else if ((options.provider ?? 'openai') === 'openai') {
    const model =
      options.openaiModel ??
      process.env.OPENAI_IMAGE_MODEL ??
      DEFAULT_OPENAI_MODEL
    if (!withinOpenaiRatio(w, h)) {
      throw new Error(`${w}x${h} exceeds ${model}'s 3:1 aspect-ratio limit`)
    }
    result = await callOpenAI(
      prompt,
      openaiGenerationSize(w, h),
      model,
      timeoutMs,
      options.referenceImage,
    )
  } else if (options.provider === 'gemini') {
    const model =
      options.geminiModel ??
      (options.light
        ? GEMINI_FLASH_LITE_IMAGE_MODEL
        : (process.env.GEMINI_IMAGE_MODEL ?? DEFAULT_GEMINI_MODEL))
    result = await callGemini(
      prompt,
      w,
      h,
      model,
      timeoutMs,
      options.aspectRatio,
      options.geminiImageSize,
    )
  } else {
    throw new Error(`Unknown provider: ${String(options.provider)}`)
  }

  return {
    ...result,
    width: requestedWidth ?? null,
    height: requestedHeight ?? null,
  }
}
