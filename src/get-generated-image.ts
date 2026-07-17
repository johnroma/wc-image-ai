import type { MediaPrompt } from '@tanstack/ai'

export const spinner = `<svg width="32" height="16" viewBox="0 0 32 16" xmlns="http://www.w3.org/2000/svg"><style>.d{fill:#777;transform-origin:center;animation:think 1.05s cubic-bezier(.4,0,.2,1) infinite}.b{animation-delay:.14s}.c{animation-delay:.28s}@keyframes think{0%,60%,100%{opacity:.28;transform:translateY(0) scale(.72)}30%{opacity:1;transform:translateY(-2px) scale(1)}}</style><circle class="d" cx="8" cy="9" r="1.8"/><circle class="d b" cx="16" cy="9" r="1.8"/><circle class="d c" cx="24" cy="9" r="1.8"/></svg>`

/** Image-transfer glyph: a framed landscape with a scanning highlight. */
export const imageLoader = `<svg width="32" height="24" viewBox="0 0 32 24" xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="f"><rect x="4" y="3" width="24" height="18" rx="3"/></clipPath><linearGradient id="s" x1="0" x2="1"><stop stop-color="#888" stop-opacity="0"/><stop offset=".5" stop-color="#888" stop-opacity=".55"/><stop offset="1" stop-color="#888" stop-opacity="0"/></linearGradient></defs><g fill="none" stroke="#888" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="24" height="18" rx="3" opacity=".65"/><circle cx="21.5" cy="8.5" r="1.5" opacity=".65"/><path d="m7 18 6-6 4 4 2-2 6 4" opacity=".65"/></g><g clip-path="url(#f)"><rect class="scan" x="-12" y="3" width="12" height="18" fill="url(#s)" transform="skewX(-12)"/></g><style>.scan{animation:scan 1.35s cubic-bezier(.4,0,.2,1) infinite}@keyframes scan{0%{transform:translateX(-8px) skewX(-12deg)}70%,100%{transform:translateX(52px) skewX(-12deg)}}</style></svg>`

// A neutral grey 1×1 SVG. Used as the initial imgsrc and the final dead-end
// fallback when nothing else resolves: the <img> loads cleanly (no broken icon,
// no network) while the host box still honours width/height.
export const TRANSPARENT_PIXEL =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="#ccc"/></svg>',
  )

export interface ResolveImageRequest {
  prompt?: MediaPrompt
  imageId?: string
  width?: number
  height?: number
  /** Provider/model hint forwarded to the endpoint (e.g. "gemini", "openai"). */
  llm?: string
  /** Exact image model hint forwarded to endpoints that support model selection. */
  model?: string
  /** Aspect ratio forwarded to the endpoint (e.g. "16:9", "4:1"). */
  ratio?: string
  /** Prefer a faster/lower-cost model when the selected provider supports it. */
  light?: boolean
  /** Use a locally configured subscription transport instead of API billing. */
  subscription?: boolean
  /** Bypass and replace any cache entry for this generation identity. */
  regenerate?: boolean
}

export interface ResolvedImage {
  id: string
  url: string
  /** Present when the endpoint returned raw image bytes (blob-proxy mode).
   *  The host is responsible for uploading this to a storage endpoint. */
  blob?: Blob
}

export interface PendingImageResponse extends Record<string, unknown> {
  id?: string
  status: 'pending' | 'processing'
  statusUrl?: string
}

export interface FailedImageResponse extends Record<string, unknown> {
  id?: string
  status: 'error'
  error?: string
}

export type ResolveImageStatusEvent =
  | PendingImageResponse
  | FailedImageResponse
  | ({ id?: string; status: 'completed'; url: string } & Partial<ResolvedImage>)

export interface ResolveImageOptions {
  pollIntervalMs?: number
  maxPollAttempts?: number
  onStatus?: (event: ResolveImageStatusEvent & { attempt: number }) => void
}

export class ResolveImageError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'ResolveImageError'
  }
}

const errorMessageFrom = async (response: Response) => {
  try {
    const data = (await response.json()) as {
      error?: { message?: unknown } | string
      message?: unknown
    } | null
    const message =
      typeof data?.error === 'string'
        ? data.error
        : typeof data?.error?.message === 'string'
          ? data.error.message
          : typeof data?.message === 'string'
            ? data.message
            : ''
    if (message) return message
  } catch {
    // The endpoint may return a non-JSON error response.
  }

  return `image request failed with HTTP ${response.status}`
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const readJson = async (response: Response) => {
  try {
    return (await response.json()) as Record<string, unknown> | null
  } catch {
    throw new ResolveImageError(
      'image endpoint returned invalid JSON',
      response.status,
    )
  }
}

const hasUrl = (
  data: Record<string, unknown> | null,
): data is { id?: string; url: string } =>
  !!data && typeof data.url === 'string' && data.url.length > 0

const isPending = (
  data: Record<string, unknown> | null,
): data is PendingImageResponse =>
  !!data &&
  (data.status === 'pending' || data.status === 'processing') &&
  (typeof data.statusUrl === 'undefined' ||
    (typeof data.statusUrl === 'string' && data.statusUrl.length > 0))

const isFailed = (
  data: Record<string, unknown> | null,
): data is FailedImageResponse =>
  !!data &&
  data.status === 'error' &&
  (typeof data.error === 'string' || typeof data.error === 'undefined')

const resolveStatusUrl = (endpoint: string, statusUrl: string) => {
  const endpointBase = (() => {
    try {
      return new URL(
        endpoint,
        globalThis.location?.href ??
          globalThis.document?.baseURI ??
          'http://localhost',
      ).toString()
    } catch {
      return (
        globalThis.location?.href ??
        globalThis.document?.baseURI ??
        'http://localhost'
      )
    }
  })()

  return new URL(statusUrl, endpointBase).toString()
}

const pollPendingImage = async (
  endpoint: string,
  initial: PendingImageResponse,
  options: ResolveImageOptions,
): Promise<ResolvedImage> => {
  const pollIntervalMs = Math.max(250, options.pollIntervalMs ?? 1500)
  const maxPollAttempts = Math.max(1, options.maxPollAttempts ?? 120)
  let pending = initial

  for (let attempt = 1; attempt <= maxPollAttempts; attempt += 1) {
    options.onStatus?.({ ...pending, attempt })

    const statusUrl = pending.statusUrl ?? initial.statusUrl
    if (!statusUrl) {
      throw new ResolveImageError(
        'image endpoint response is missing a status URL',
      )
    }

    const resolvedStatusUrl = resolveStatusUrl(endpoint, statusUrl)
    const response = await fetch(resolvedStatusUrl, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })

    const data = await readJson(response)

    if (!response.ok && !isFailed(data)) {
      throw new ResolveImageError(
        await errorMessageFrom(response),
        response.status,
      )
    }

    if (hasUrl(data)) {
      options.onStatus?.({
        id: typeof data.id === 'string' ? data.id : pending.id,
        status: 'completed',
        url: data.url,
        attempt,
      })
      return {
        id: typeof data.id === 'string' ? data.id : (pending.id ?? ''),
        url: data.url,
      }
    }

    if (isFailed(data)) {
      options.onStatus?.({ ...data, attempt })
      throw new ResolveImageError(
        data.error || 'image generation failed',
        response.status,
      )
    }

    if (!isPending(data)) {
      throw new ResolveImageError(
        'image endpoint response is missing a URL',
        response.status,
      )
    }

    pending = data
    await sleep(Math.min(pollIntervalMs + (attempt - 1) * 250, 5000))
  }

  throw new ResolveImageError(
    `image generation timed out after ${maxPollAttempts} status checks`,
  )
}

/**
 * Sends a single POST to the endpoint and lets the server decide whether to
 * return an already-stored image (looked up by `imageId`) or generate a new
 * one. The component never branches on existence — it just trusts the result.
 *
 * Resolves to `{ id, url }` on success and throws `ResolveImageError` with the
 * endpoint's message/status on failure.
 */
export const resolveImage = async (
  endpoint: string,
  req: ResolveImageRequest,
  options: ResolveImageOptions = {},
): Promise<ResolvedImage> => {
  if (!endpoint) throw new ResolveImageError('ai-img endpoint is required')

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: req.prompt || undefined,
        imageId: req.imageId || undefined,
        width: req.width || undefined,
        height: req.height || undefined,
        llm: req.llm || undefined,
        model: req.model || undefined,
        ratio: req.ratio || undefined,
        light: req.light || undefined,
        subscription: req.subscription || undefined,
        regenerate: req.regenerate || undefined,
      }),
    })
  } catch (error) {
    throw new ResolveImageError(
      error instanceof Error ? error.message : 'image request failed',
    )
  }

  if (!response.ok) {
    throw new ResolveImageError(
      await errorMessageFrom(response),
      response.status,
    )
  }

  // Blob-proxy mode: endpoint owns only generation and returns raw bytes.
  // The host receives the blob via the `ai-image` event and uploads it
  // separately to a storage endpoint.
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.startsWith('image/')) {
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    return { id: '', url, blob }
  }

  const data = await readJson(response)

  if (hasUrl(data)) {
    return {
      id: typeof data.id === 'string' ? data.id : '',
      url: data.url,
    }
  }

  if (isPending(data)) {
    return pollPendingImage(endpoint, data, options)
  }

  if (isFailed(data)) {
    throw new ResolveImageError(
      data.error || 'image generation failed',
      response.status,
    )
  }

  throw new ResolveImageError(
    'image endpoint response is missing a URL',
    response.status,
  )
}
