import { LitElement, html, css, nothing, unsafeCSS } from "lit"
import { property, state } from "lit/decorators.js"
import { spread } from "@open-wc/lit-helpers"
import {
  resolveImage,
  spinner,
  TRANSPARENT_PIXEL,
} from "./get-generated-image"

const SPINNER_BG = unsafeCSS(encodeURIComponent(spinner))

// Attributes the component owns — everything else is passed through to <img>.
const RESERVED_ATTRS = new Set([
  "endpoint",
  "prompt",
  "image-id",
  "fallback",
  "width",
  "height",
  "llm",
  "ratio",
  "class",
  "style",
  "loading",
  "decoding",
  "src",
])

const placeholder = (width: string, height: string) =>
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#ddd"/></svg>`
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
  @property({ type: String }) src = ""
  /** Server route that owns the API key, generation, storage and lookup. */
  @property({ type: String }) endpoint = ""
  /** Description used to generate the image (omit when fetching a known id). */
  @property({ type: String }) prompt = ""
  /** Storage handle. Reflected after the server mints a new image. */
  @property({ type: String, attribute: "image-id" }) imageId = ""
  /** Provider/model hint forwarded to the endpoint (e.g. "gemini", "openai"). */
  @property({ type: String }) llm = ""
  /** Aspect ratio forwarded to the endpoint and used to derive an omitted height. */
  @property({ type: String }) ratio = ""
  /** Shown when the image cannot be resolved (otherwise a 1x1 transparent PNG). */
  @property({ type: String }) fallback = ""
  @property({ type: String, reflect: true }) width = ""
  @property({ type: String }) height = ""
  @property({ type: String, reflect: true }) alt = ""

  // Start transparent (sized by :host, but invisible) so a `src`/stored image
  // never flashes the grey generating-placeholder. The grey placeholder is
  // shown only once we know we're actually generating (see start()).
  @state() private imgsrc = TRANSPARENT_PIXEL

  private imgAttributes: Record<string, string> = {}
  // Once we've shown the fallback/transparent pixel there's nothing left to
  // retry, so further <img> errors are ignored to avoid loops.
  private onFallback = false
  private retried = false
  private resolvedUrl = ""

  connectedCallback() {
    super.connectedCallback()
    // Defer so a framework host (e.g. React) has finished applying every
    // prop/attribute for this commit — `src`/`prompt` can land just after
    // connectedCallback. A microtask runs after the synchronous commit.
    queueMicrotask(() => this.start())
  }

  private start() {
    this.collectPassThroughAttributes()
    const dimensions = dimensionsFor(this.width, this.height, this.ratio)

    // A ready src bypasses all AI: behave like a plain <img> (the broken-url
    // retry/fallback still applies, but nothing is fetched or generated). No
    // grey placeholder — it loads straight into the (already reserved) box.
    if (this.src) {
      this.resolvedUrl = this.src
      this.settle(this.src)
      return
    }

    // Nothing to fetch and nothing to generate.
    if (!this.prompt && !this.imageId) {
      this.settleFallback()
      return
    }

    // We're going to call the endpoint — now show the grey placeholder + spinner
    // as progress feedback while it resolves.
    this.imgsrc = placeholder(dimensions.width || "1", dimensions.height || "1")
    this.classList.add("spin")
    void this.resolve()
  }

  private collectPassThroughAttributes() {
    for (const attr of Array.from(this.attributes)) {
      if (!RESERVED_ATTRS.has(attr.name)) {
        this.imgAttributes[attr.name] = attr.value
      }
    }
  }

  private async resolve() {
    const dimensions = dimensionsFor(this.width, this.height, this.ratio)
    const result = await resolveImage(this.endpoint, {
      prompt: this.prompt,
      imageId: this.imageId,
      width: Number(dimensions.width) || undefined,
      height: Number(dimensions.height) || undefined,
      llm: this.llm,
      ratio: this.ratio,
    })

    if (!result) {
      this.settleFallback()
      return
    }

    // Reflect the server-confirmed/minted id so the DOM stays truthful.
    if (result.id && result.id !== this.imageId) {
      this.imageId = result.id
      this.setAttribute("image-id", result.id)
    }

    // Hand the id (and url) to the host so it can persist to a database.
    this.dispatchEvent(
      new CustomEvent("ai-image", {
        detail: { id: result.id, url: result.url, prompt: this.prompt },
        bubbles: true,
        composed: true,
      })
    )

    this.resolvedUrl = result.url
    this.retried = false
    this.onFallback = false
    this.settle(result.url)
  }

  private settle(src: string) {
    this.imgsrc = src
    this.classList.remove("spin")
  }

  private settleFallback() {
    this.onFallback = true
    this.settle(this.fallback || TRANSPARENT_PIXEL)
  }

  // The server returned a url, but the browser couldn't load it (transient 404
  // / propagation, a stale or broken url). Retry once with a cache-bust, then
  // fall through to the fallback chain.
  private onImgError = () => {
    if (this.onFallback || !this.resolvedUrl) return

    if (!this.retried) {
      this.retried = true
      const sep = this.resolvedUrl.includes("?") ? "&" : "?"
      const url = `${this.resolvedUrl}${sep}retry=${Date.now()}`
      setTimeout(() => {
        this.imgsrc = url
      }, 800)
      return
    }

    this.resolvedUrl = ""
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
        decoding="async"
        @error=${this.onImgError}
        ${spread(this.imgAttributes)}
      />
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

    :host(.spin)::before {
      content: "";
      position: absolute;
      inset: 0;
      margin: auto;
      background-image: url("data:image/svg+xml;utf8,${SPINNER_BG}");
      background-repeat: no-repeat;
      background-position: center;
      background-size: 25%;
    }
  `
}

// Register manually (instead of @customElement) so importing this module is
// safe in any environment — in particular it does NOT touch `customElements`
// during SSR (Node), where that global doesn't exist. This lets consumers
// import the package EAGERLY (e.g. in a client entry or a server-rendered
// module) rather than lazily after hydration, so `<ai-img>` is defined before
// it first renders and a `src` paints with no extra chunk-load delay.
if (
  typeof customElements !== "undefined" &&
  !customElements.get("ai-img")
) {
  customElements.define("ai-img", AiImg)
}

declare global {
  interface HTMLElementTagNameMap {
    "ai-img": AiImg
  }
}
