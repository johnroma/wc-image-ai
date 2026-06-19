export const spinner = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><style>.a{animation:b .8s linear infinite;fill:#888}.c{animation-delay:-.65s}.d{animation-delay:-.5s}@keyframes b{93.75%,100%{r:3px}46.875%{r:.2px}}</style><circle class="a" cx="4" cy="12" r="3"/><circle class="a c" cx="12" cy="12" r="3"/><circle class="a d" cx="20" cy="12" r="3"/></svg>`

// A neutral grey 1×1 SVG. Used as the initial imgsrc and the final dead-end
// fallback when nothing else resolves: the <img> loads cleanly (no broken icon,
// no network) while the host box still honours width/height.
export const TRANSPARENT_PIXEL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="#ccc"/></svg>'
  )

export interface ResolveImageRequest {
  prompt?: string
  imageId?: string
  width?: number
  height?: number
  /** Provider/model hint forwarded to the endpoint (e.g. "gemini", "openai"). */
  llm?: string
  /** Aspect ratio forwarded to the endpoint (e.g. "16:9", "4:1"). */
  ratio?: string
}

export interface ResolvedImage {
  id: string
  url: string
  /** Present when the endpoint returned raw image bytes (blob-proxy mode).
   *  The host is responsible for uploading this to a storage endpoint. */
  blob?: Blob
}

export class ResolveImageError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message)
    this.name = "ResolveImageError"
  }
}

const errorMessageFrom = async (response: Response) => {
  try {
    const data = (await response.json()) as
      | { error?: { message?: unknown } | string; message?: unknown }
      | null
    const message =
      typeof data?.error === "string"
        ? data.error
        : typeof data?.error?.message === "string"
          ? data.error.message
          : typeof data?.message === "string"
            ? data.message
            : ""
    if (message) return message
  } catch {
    // The endpoint may return a non-JSON error response.
  }

  return `image request failed with HTTP ${response.status}`
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
  req: ResolveImageRequest
): Promise<ResolvedImage> => {
  if (!endpoint) throw new ResolveImageError("ai-img endpoint is required")

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: req.prompt || undefined,
        imageId: req.imageId || undefined,
        width: req.width || undefined,
        height: req.height || undefined,
        llm: req.llm || undefined,
        ratio: req.ratio || undefined,
      }),
    })
  } catch (error) {
    throw new ResolveImageError(
      error instanceof Error ? error.message : "image request failed"
    )
  }

  if (!response.ok) {
    throw new ResolveImageError(
      await errorMessageFrom(response),
      response.status
    )
  }

  // Blob-proxy mode: endpoint owns only generation and returns raw bytes.
  // The host receives the blob via the `ai-image` event and uploads it
  // separately to a storage endpoint.
  const contentType = response.headers.get("content-type") ?? ""
  if (contentType.startsWith("image/")) {
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    return { id: "", url, blob }
  }

  let data: Partial<ResolvedImage> | null
  try {
    data = (await response.json()) as Partial<ResolvedImage> | null
  } catch {
    throw new ResolveImageError("image endpoint returned invalid JSON", response.status)
  }

  if (!data || typeof data.url !== "string" || data.url.length === 0) {
    throw new ResolveImageError(
      "image endpoint response is missing a URL",
      response.status
    )
  }

  return { id: typeof data.id === "string" ? data.id : "", url: data.url }
}
