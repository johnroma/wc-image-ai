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
  PROVIDER_CANVAS_CAPABILITIES,
  withinOpenaiRatio,
  openaiGenerationSize,
  nearestGeminiRatio,
  type HeroProvider,
} from './provider-ratios.js'

export { withinOpenaiRatio, openaiGenerationSize, nearestGeminiRatio }

const OPENAI_BASE = 'https://api.openai.com/v1'
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const DEFAULT_OPENAI_MODEL = 'gpt-image-2'
const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-image'
const MAX_OUTPUT_DIMENSION = 4096

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
  /** Per-request timeout in milliseconds. Defaults to 90 000 (90 s). */
  timeoutMs?: number
}

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

async function callOpenAI(
  prompt: string,
  size: string,
  model: string,
  timeoutMs: number,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set')

  const response = await fetch(`${OPENAI_BASE}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, prompt, n: 1, size }),
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, ' ').trim().slice(0, 300)
    throw new Error(`OpenAI ${model} ${response.status}: ${detail}`)
  }

  const data = (await response.json()) as { data?: Array<{ b64_json?: string }> }
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
  explicitRatio?: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set')

  const response = await fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: {
          aspectRatio: explicitRatio ?? nearestGeminiRatio(width, height),
          ...(Math.max(width, height) > PROVIDER_CANVAS_CAPABILITIES.gemini.imageSize2KThreshold
            ? { imageSize: '2K' }
            : {}),
        },
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, ' ').trim().slice(0, 300)
    throw new Error(`Gemini ${model} ${response.status}: ${detail}`)
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ inlineData?: { data: string; mimeType?: string } }> }
    }>
  }
  const parts = data?.candidates?.[0]?.content?.parts ?? []
  const inline = parts.find((p) => p.inlineData)?.inlineData
  if (!inline) throw new Error(`Gemini ${model} returned no image data`)
  return { buffer: Buffer.from(inline.data, 'base64'), mimeType: inline.mimeType ?? 'image/jpeg' }
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
  const provider = options.provider ?? 'openai'

  let result: { buffer: Buffer; mimeType: string }

  if (provider === 'openai') {
    const model = options.openaiModel ?? process.env.OPENAI_IMAGE_MODEL ?? DEFAULT_OPENAI_MODEL
    if (!withinOpenaiRatio(w, h)) {
      throw new Error(`${w}x${h} exceeds ${model}'s 3:1 aspect-ratio limit`)
    }
    result = await callOpenAI(prompt, openaiGenerationSize(w, h), model, timeoutMs)
  } else if (provider === 'gemini') {
    const model = options.geminiModel ?? process.env.GEMINI_IMAGE_MODEL ?? DEFAULT_GEMINI_MODEL
    result = await callGemini(prompt, w, h, model, timeoutMs, options.aspectRatio)
  } else {
    throw new Error(`Unknown provider: ${provider satisfies never}`)
  }

  return { ...result, width: requestedWidth ?? null, height: requestedHeight ?? null }
}
