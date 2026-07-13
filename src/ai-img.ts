import { spread } from '@open-wc/lit-helpers'
import { css, html, LitElement, nothing, type PropertyValues } from 'lit'
import { property, state } from 'lit/decorators.js'
import {
  ResolveImageError,
  type ResolveImageStatusEvent,
  resolveImage,
  TRANSPARENT_PIXEL,
} from './get-generated-image'
import {
  GEMINI_FLASH_IMAGE_MODEL,
  GEMINI_FLASH_LITE_IMAGE_MODEL,
  isGeminiRatioSupported,
  isRatioSupported,
} from './provider-ratios'

// Attributes the component owns — everything else is passed through to <img>.
const RESERVED_ATTRS = new Set([
  'endpoint',
  'prompt',
  'image-id',
  'fallback',
  'width',
  'height',
  'llm',
  'ratio',
  'light',
  'subscription',
  'regenerate',
  'class',
  'style',
  'loading',
  'decoding',
  'src',
])

const placeholder = (width: string, height: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#ddd"/></svg>`,
  )

const dimensionsFor = (width: string, height: string, ratio: string) => {
  const ratioMatch = ratio.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/)
  const ratioWidth = Number(ratioMatch?.[1])
  const ratioHeight = Number(ratioMatch?.[2])
  const numericWidth = Number(width)

  if (
    !height &&
    Number.isFinite(numericWidth) &&
    numericWidth > 0 &&
    Number.isFinite(ratioWidth) &&
    ratioWidth > 0 &&
    Number.isFinite(ratioHeight) &&
    ratioHeight > 0
  ) {
    return {
      width,
      height: String(Math.round(numericWidth * (ratioHeight / ratioWidth))),
    }
  }

  return { width, height }
}

export class AiImg extends LitElement {
  /**
   * A ready image URL (or data URL). When set, the component acts as a plain
   * <img> and never calls the AI endpoint — use it when you already have the
   * image (e.g. a precomputed/returning one). Highest priority.
   */
  @property({ type: String }) src = ''
  /** Server route that owns the API key, generation, storage and lookup. */
  @property({ type: String }) endpoint = ''
  /** Description used to generate the image (omit when fetching a known id). */
  @property({ type: String }) prompt = ''
  /** Storage handle. Reflected after the server mints a new image. */
  @property({ type: String, attribute: 'image-id' }) imageId = ''
  /** Provider/model hint forwarded to the endpoint (e.g. "gemini", "openai"). */
  @property({ type: String }) llm = ''
  /** Aspect ratio forwarded to the endpoint and used to derive an omitted height. */
  @property({ type: String }) ratio = ''
  /** Prefer a faster/lower-cost model when the selected provider supports it. */
  @property({ type: Boolean }) light = false
  /** Use the endpoint's subscription-backed transport for this provider. */
  @property({ type: Boolean }) subscription = false
  /** Bypass and replace the endpoint's cached generation. */
  @property({ type: Boolean }) regenerate = false
  /** Shown when the image cannot be resolved (otherwise a 1x1 transparent PNG). */
  @property({ type: String }) fallback = ''
  @property({ type: String, reflect: true }) width = ''
  @property({ type: String }) height = ''
  @property({ type: String, reflect: true }) alt = ''
  /** Durable request state for hosts that attach event listeners after upgrade. */
  @property({ attribute: false }) status:
    | 'idle'
    | 'loading'
    | 'loaded'
    | 'error' = 'idle'
  /** Durable endpoint/load error message; also emitted via `ai-image-error`. */
  @property({ attribute: false }) errorMessage = ''
  /** Durable HTTP status when the endpoint returned a non-success response. */
  @property({ attribute: false }) errorStatus: number | undefined

  // Start transparent (sized by :host, but invisible) so a `src`/stored image
  // never flashes the grey generating-placeholder. The grey placeholder is
  // shown only once we know we're actually generating (see start()).
  @state() private imgsrc = TRANSPARENT_PIXEL
  @state() private loadingKind: 'generation' | 'image' | null = null

  private imgAttributes: Record<string, string> = {}
  // Once we've shown the fallback/transparent pixel there's nothing left to
  // retry, so further <img> errors are ignored to avoid loops.
  private onFallback = false
  private retried = false
  private resolvedUrl = ''
  private blobUrl = ''
  private activeResolveToken = 0

  connectedCallback() {
    super.connectedCallback()
    console.log('[ai-img] connectedCallback — status was:', this.status)
    // Defer so a framework host (e.g. React) has finished applying every
    // prop/attribute for this commit — `src`/`prompt` can land just after
    // connectedCallback. A microtask runs after the synchronous commit.
    queueMicrotask(() => this.start())
  }

  protected updated(changed: PropertyValues<this>) {
    const shouldRestart =
      changed.has('src') ||
      changed.has('endpoint') ||
      changed.has('prompt') ||
      (!this.prompt && changed.has('imageId')) ||
      changed.has('llm') ||
      changed.has('ratio') ||
      changed.has('light') ||
      changed.has('subscription') ||
      changed.has('regenerate') ||
      changed.has('width') ||
      changed.has('height') ||
      changed.has('fallback')

    if (shouldRestart) {
      queueMicrotask(() => this.start())
    }
  }

  refresh() {
    this.start()
  }

  // Debug helper — call from browser console: document.querySelector('ai-img').debugState()
  debugState() {
    return {
      src: this.src,
      prompt: this.prompt,
      imageId: this.imageId,
      status: this.status,
      blobUrl: this.blobUrl,
      imgsrc: this.imgsrc,
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl)
      this.blobUrl = ''
    }
  }

  private start() {
    this.collectPassThroughAttributes()
    const dimensions = dimensionsFor(this.width, this.height, this.ratio)
    const resolveToken = ++this.activeResolveToken
    console.log('[ai-img] start()', {
      src: this.src,
      prompt: this.prompt?.slice(0, 60),
      imageId: this.imageId,
      status: this.status,
    })

    // A ready src bypasses all AI: behave like a plain <img> (the broken-url
    // retry/fallback still applies, but nothing is fetched or generated). No
    // grey placeholder — it loads straight into the (already reserved) box.
    if (this.src) {
      console.log(
        '[ai-img] src provided — skipping generation',
        this.src.slice(0, 80),
      )
      this.resolvedUrl = this.src
      this.status = 'loading'
      this.loadingKind = 'image'
      this.dispatchStatus({ status: 'completed', url: this.src }, 0)
      this.settle(this.src)
      return
    }

    // Nothing to fetch and nothing to generate.
    if (!this.prompt && !this.imageId) {
      console.log('[ai-img] no prompt and no imageId — idle')
      this.status = 'idle'
      this.dispatchStatus({ status: 'idle' }, 0)
      this.settleFallback()
      return
    }

    // Validate provider+ratio before hitting the endpoint.
    const ratioSupported =
      this.llm === 'gemini'
        ? isGeminiRatioSupported(
            this.light
              ? GEMINI_FLASH_LITE_IMAGE_MODEL
              : GEMINI_FLASH_IMAGE_MODEL,
            this.ratio,
          )
        : isRatioSupported(this.llm, this.ratio)
    if (this.llm && this.ratio && !ratioSupported) {
      console.error(
        `[ai-img] ratio ${this.ratio} is not supported by provider ${this.llm}`,
      )
      this.dispatchError(
        `ratio ${this.ratio} is not supported by provider ${this.llm}`,
      )
      this.settleFallback()
      return
    }

    // We're going to call the endpoint — now show the grey placeholder + spinner
    // as progress feedback while it resolves.
    console.log('[ai-img] starting generation via', this.endpoint)
    this.imgsrc = placeholder(dimensions.width || '1', dimensions.height || '1')
    this.resolvedUrl = ''
    this.retried = false
    this.onFallback = false
    this.status = 'loading'
    this.loadingKind = 'generation'
    this.errorMessage = ''
    this.errorStatus = undefined
    this.dispatchStatus({ status: 'requesting' }, 0)
    void this.resolve(resolveToken)
  }

  private collectPassThroughAttributes() {
    const nextAttributes: Record<string, string> = {}
    for (const attr of Array.from(this.attributes)) {
      if (!RESERVED_ATTRS.has(attr.name)) {
        nextAttributes[attr.name] = attr.value
      }
    }
    this.imgAttributes = nextAttributes
  }

  private async resolve(resolveToken: number) {
    const dimensions = dimensionsFor(this.width, this.height, this.ratio)
    let result: Awaited<ReturnType<typeof resolveImage>>
    try {
      result = await resolveImage(
        this.endpoint,
        {
          prompt: this.prompt,
          imageId: this.imageId,
          width: Number(dimensions.width) || undefined,
          height: Number(dimensions.height) || undefined,
          llm: this.llm,
          ratio: this.ratio,
          light: this.llm === 'gemini' ? this.light : undefined,
          subscription: this.subscription || undefined,
          regenerate: this.regenerate || undefined,
        },
        {
          onStatus: (event) => {
            if (resolveToken !== this.activeResolveToken) return
            this.dispatchStatus(event, event.attempt)
          },
        },
      )
    } catch (error) {
      if (resolveToken !== this.activeResolveToken) return
      console.error('[ai-img] resolve error', error)
      this.dispatchError(
        error instanceof Error ? error.message : 'image request failed',
        error instanceof ResolveImageError ? error.status : undefined,
      )
      this.settleFallback()
      return
    }

    if (resolveToken !== this.activeResolveToken) return

    console.log('[ai-img] resolved', {
      id: result.id,
      url: result.url.slice(0, 80),
      hasBlob: !!result.blob,
      blobSize: result.blob?.size,
    })

    // Reflect the server-confirmed/minted id so the DOM stays truthful.
    if (result.id && result.id !== this.imageId) {
      this.imageId = result.id
      this.setAttribute('image-id', result.id)
    }

    if (result.blob) {
      this.blobUrl = result.url
    }

    // Hand the id (and url) to the host so it can persist to a database.
    // In blob-proxy mode, `blob` is included so the host can upload it.
    console.log('[ai-img] dispatching ai-image event', {
      hasBlob: !!result.blob,
    })
    this.dispatchEvent(
      new CustomEvent('ai-image', {
        detail: {
          id: result.id,
          url: result.url,
          prompt: this.prompt,
          blob: result.blob,
        },
        bubbles: true,
        composed: true,
      }),
    )

    this.resolvedUrl = result.url
    this.retried = false
    this.onFallback = false
    this.status = 'loading'
    this.loadingKind = 'image'
    this.dispatchStatus(
      {
        id: result.id,
        status: 'completed',
        url: result.url,
      },
      0,
    )
    this.settle(result.url)
  }

  private settle(src: string) {
    this.imgsrc = src
  }

  private dispatchStatus(
    detail:
      | ResolveImageStatusEvent
      | { status: 'idle' | 'requesting'; url?: string; id?: string },
    attempt: number,
  ) {
    this.dispatchEvent(
      new CustomEvent('ai-image-status', {
        detail: {
          ...detail,
          attempt,
          prompt: this.prompt,
          imageId: this.imageId,
        },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private settleFallback() {
    this.onFallback = true
    this.loadingKind = null
    this.settle(this.fallback || TRANSPARENT_PIXEL)
  }

  private onImgLoad = () => {
    // The generation placeholder is also a data image and emits `load`; only
    // the actual URL-fetch phase should settle the component.
    if (this.loadingKind !== 'image') return
    this.loadingKind = null
    this.status = 'loaded'
  }

  private dispatchError(message: string, status?: number) {
    this.status = 'error'
    this.errorMessage = message
    this.errorStatus = status
    this.dispatchEvent(
      new CustomEvent('ai-image-error', {
        detail: { message, status, prompt: this.prompt },
        bubbles: true,
        composed: true,
      }),
    )
  }

  // The server returned a url, but the browser couldn't load it (transient 404
  // / propagation, a stale or broken url). Retry once with a cache-bust, then
  // fall through to the fallback chain.
  private onImgError = () => {
    if (this.onFallback || !this.resolvedUrl) return

    if (!this.retried) {
      this.retried = true
      const sep = this.resolvedUrl.includes('?') ? '&' : '?'
      const url = `${this.resolvedUrl}${sep}retry=${Date.now()}`
      setTimeout(() => {
        this.imgsrc = url
      }, 800)
      return
    }

    this.resolvedUrl = ''
    this.dispatchError('generated image URL could not be loaded')
    this.settleFallback()
  }

  protected render() {
    const dimensions = dimensionsFor(this.width, this.height, this.ratio)
    // `width`/`height` go on the <img> as content attributes, exactly like a
    // native <img>: the browser derives the aspect-ratio and reserves the box
    // (no layout shift) while CSS controls the displayed size.
    return html`
      <img
        src=${this.imgsrc}
        alt=${this.alt}
        width=${dimensions.width || nothing}
        height=${dimensions.height || nothing}
        style=${
          dimensions.width && dimensions.height
            ? `aspect-ratio: ${dimensions.width} / ${dimensions.height}`
            : nothing
        }
        decoding="async"
        @load=${this.onImgLoad}
        @error=${this.onImgError}
        ${spread(this.imgAttributes)}
      />
      ${
        this.loadingKind === 'generation'
          ? html`<span class="loader generation-loader" role="status" aria-label="Generating image"><i></i><i></i><i></i></span>`
          : this.loadingKind === 'image'
            ? html`<span class="loader image-loader" role="status" aria-label="Loading image"></span>`
            : nothing
      }
    `
  }

  // Sizing/visuals work like a native <img>: set `width`/`height` and style with
  // `class`/CSS on the element. No fixed px on :host, so it scales responsively.
  // Visual properties bridge the shadow boundary via `inherit`, so a class like
  // `rounded-xl object-cover` on <ai-img> styles the inner image.
  static styles = css`
    :host {
      display: inline-block;
      position: relative;
      line-height: 0;
    }

    img {
      display: block;
      width: 100%;
      height: auto;
      -webkit-user-select: none;
      object-fit: inherit;
      object-position: inherit;
      aspect-ratio: inherit;
      filter: inherit;
      transform: inherit;
      transition: inherit;
      border-radius: inherit;
      box-shadow: inherit;
      clip-path: inherit;
    }

    .loader {
      position: absolute;
      inset: 0;
      margin: auto;
      pointer-events: none;
    }

    /* AI generation: three full-size thinking orbs that rise and soften in
       sequence. Deliberately organic rather than the mechanical fetch cycle. */
    .generation-loader {
      width: 55px;
      height: 19px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .generation-loader i {
      width: 15px;
      aspect-ratio: 1;
      border-radius: 50%;
      background: #000;
      animation: ai-think 1.2s cubic-bezier(.45, 0, .55, 1) infinite;
    }

    .generation-loader i:nth-child(2) {
      animation-delay: .16s;
    }

    .generation-loader i:nth-child(3) {
      animation-delay: .32s;
    }

    @keyframes ai-think {
      0%, 55%, 100% {
        opacity: .14;
        transform: translateY(2px) scale(.82);
      }
      25% {
        opacity: 1;
        transform: translateY(-3px) scale(1);
      }
    }

    /* Plain image/CDN fetch: three fixed 15px dots handing the active state
       from left to right. Based directly on the requested l5 loader. */
    .image-loader {
      width: 15px;
      height: 15px;
      aspect-ratio: 1;
      border-radius: 50%;
      animation: image-fetch 1s infinite linear alternate;
    }

    @keyframes image-fetch {
      0% {
        box-shadow: 20px 0 #000, -20px 0 #0002;
        background: #000;
      }
      33% {
        box-shadow: 20px 0 #000, -20px 0 #0002;
        background: #0002;
      }
      66% {
        box-shadow: 20px 0 #0002, -20px 0 #000;
        background: #0002;
      }
      100% {
        box-shadow: 20px 0 #0002, -20px 0 #000;
        background: #000;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .generation-loader i,
      .image-loader {
        animation: none;
      }
    }
  `
}

// Register manually (instead of @customElement) so importing this module is
// safe in any environment — in particular it does NOT touch `customElements`
// during SSR (Node), where that global doesn't exist. This lets consumers
// import the package EAGERLY (e.g. in a client entry or a server-rendered
// module) rather than lazily after hydration, so `<ai-img>` is defined before
// it first renders and a `src` paints with no extra chunk-load delay.
if (typeof customElements !== 'undefined' && !customElements.get('ai-img')) {
  customElements.define('ai-img', AiImg)
}

declare global {
  interface HTMLElementTagNameMap {
    'ai-img': AiImg
  }
}
