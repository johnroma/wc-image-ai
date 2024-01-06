import { LitElement, html, css } from "lit"
import { customElement, property } from "lit/decorators.js"
import { spread } from "@open-wc/lit-helpers"
import { getGeneratedImage } from "./get-generated-image"

@customElement("ai-img")
export class AiImg extends LitElement {
  @property({ type: String }) fallback = ""
  @property({ type: String, reflect: true }) width = ""
  @property({ type: String, reflect: true }) height = ""
  @property({ type: String, reflect: true }) src = ""
  @property({ type: String, reflect: true }) alt = ""
  @property({ type: String, reflect: false })
  imgsrc = ""
  @property({ type: String, reflect: true })
  prompt = ""

  imgAttributes: { [key: string]: string } = {}

  connectedCallback() {
    super.connectedCallback()
    Array.from(this.attributes).forEach((attr) => {
      if (
        ![
          "loading",
          "decoding",
          "src",
          "fallback",
          "prompt",
          "style",
          "width",
          "height",
        ].includes(attr.name)
      ) {
        this.imgAttributes[attr.name] = attr.value
      }

      if (attr.name === "width") {
        this.width = attr.value
      }
      if (attr.name === "height") {
        this.height = attr.value
      }
    })
  }

  // Override createRenderRoot to render in the light DOM
  // createRenderRoot() {
  //   return this
  // }

  protected constructor() {
    super()
    setTimeout(async () => {
      if (!this.prompt) {
        this.imgsrc = this.fallback
        return
      }

      try {
        const openAiResponse = await getGeneratedImage(
          this.src,
          this.prompt,
          Number(this.width),
          Number(this.height)
        )
        this.imgsrc = openAiResponse || this.fallback
      } catch (error) {
        console.error("Error fetching AI image:", error)
        this.imgsrc = this.fallback
      }

      // this.imgsrc = "https://picsum.photos/200/300"
    }, 1000)
  }

  protected render() {
    const hostStyles = {
      width: `${this.width}px`,
      height: `${this.height}px`,
    }

    return html`
      <style>
        :host {
          width: ${hostStyles.width};
          height: ${hostStyles.height};
        }
      </style>

      ${this.imgsrc.length > 0
        ? html`
            <img
              src=${this.imgsrc}
              decoding="async"
              loading="lazy"
              ${spread(this.imgAttributes)}
            />
          `
        : ""}
    `
  }

  static styles = css`
    :host {
      display: inline-block;
    }

    img {
      display: block;
      -webkit-user-select: none;
      width: 100%;
      height: 100%;
      object-fit: inherit;
      object-position: inherit;
      filter: inherit;
      transform: inherit;
      transition: inherit;
      border-radius: inherit;
      box-shadow: inherit;
      clip-path: inherit;
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    "ai-img": AiImg
  }
}
