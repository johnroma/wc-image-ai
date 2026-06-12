export const spinner = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><style>.a{animation:b .8s linear infinite;fill:#888}.c{animation-delay:-.65s}.d{animation-delay:-.5s}@keyframes b{93.75%,100%{r:3px}46.875%{r:.2px}}</style><circle class="a" cx="4" cy="12" r="3"/><circle class="a c" cx="12" cy="12" r="3"/><circle class="a d" cx="20" cy="12" r="3"/></svg>`

// A 1x1 fully-transparent PNG. Used as the final dead-end when nothing else
// resolves: the <img> loads cleanly (no broken icon, no network) while the host
// box still honours width/height.
export const TRANSPARENT_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

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
}

/**
 * Sends a single POST to the endpoint and lets the server decide whether to
 * return an already-stored image (looked up by `imageId`) or generate a new
 * one. The component never branches on existence — it just trusts the result.
 *
 * Resolves to `{ id, url }` on success, or `null` when the endpoint is missing,
 * the request fails, or the server reports the image could not be resolved
 * (e.g. 404). A `null` tells the component to fall back.
 */
export const resolveImage = async (
  endpoint: string,
  req: ResolveImageRequest
): Promise<ResolvedImage | null> => {
  if (!endpoint) return null

  try {
    const r = await fetch(endpoint, {
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

    if (!r.ok) return null

    const data = (await r.json()) as Partial<ResolvedImage> | null
    if (!data || typeof data.url !== "string" || data.url.length === 0) {
      return null
    }

    return { id: typeof data.id === "string" ? data.id : "", url: data.url }
  } catch (error) {
    console.error("ai-img: image request failed:", error)
    return null
  }
}
