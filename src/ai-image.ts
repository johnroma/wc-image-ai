import { getGeneratedImage } from "./get-generated-image"
export class AIImage extends HTMLImageElement {
  static get observedAttributes() {
    return ["data-fallback"]
  }
  private _fallbackSrc: string | null = null
  private _prompt: string | null = null
  private _originalSrc: string | null = null
  private svgPlaceholder: string | null = null
  private _endpoint: string | null = null
  private ph_w: number = 256
  private ph_h: number = 256

  constructor() {
    super()
    this.ph_w = Number(super.getAttribute("width")) || 256
    this.ph_h = Number(super.getAttribute("height")) || 256
    this.svgPlaceholder = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.ph_w} ${this.ph_h}"><rect width="${this.ph_w}" height="${this.ph_h}" fill="#ddd"/></svg>`

    this._originalSrc = this.getAttribute("currentSrc")
    this._prompt = this.getAttribute("alt")

    this._endpoint = super.getAttribute("src")?.toString() || null
    this.addEventListener("error", (_event) => {
      super.src =
        "data:image/svg+xml;utf8," +
        encodeURIComponent(this.svgPlaceholder as string)
    })
    super.src =
      "data:image/svg+xml;utf8," +
      encodeURIComponent(this.svgPlaceholder as string)

    setTimeout(async () => {
      if (!this._prompt) {
        return
      }
      const openAiResponse = await this.getGeneratedImage(
        this._endpoint as string,
        this._prompt as string,
        this.ph_w as number,
        this.ph_h as number
      )
      super.src = openAiResponse || this._fallbackSrc || ""
    }, 1)
  }

  get src(): string {
    return this._originalSrc || ""
  }

  set src(value: string) {
    if (this._originalSrc !== value && this.src !== undefined) {
      super.src = value
    }
  }

  set fallbackSrc(value: string | null) {
    this._fallbackSrc = value
  }

  attributeChangedCallback(name: string, _oldValue: string, newValue: string) {
    if (name === "data-fallback") {
      this.fallbackSrc = newValue
    }
  }

  protected getGeneratedImage = getGeneratedImage
}

customElements.define("ai-image", AIImage, { extends: "img" })

declare global {
  interface AIImage extends HTMLImageElement {
    "data-fallback"?: string
  }

  interface HTMLElementTagNameMap {
    "ai-image": AIImage
  }
}
