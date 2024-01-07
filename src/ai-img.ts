import { LitElement, html, css } from "lit"
import { customElement, property } from "lit/decorators.js"
import { spread } from "@open-wc/lit-helpers"
import { getGeneratedImage, spinner } from "./get-generated-image"
@customElement("ai-img")
export class AiImg extends LitElement {
  @property({ type: String }) fallback = ""
  @property({ type: String, reflect: true }) width = ""
  @property({ type: String, reflect: true }) height = ""
  @property({ type: String, reflect: true }) src = ""
  @property({ type: String, reflect: true }) alt = ""
  @property({ type: String, reflect: false }) imgsrc = ""
  @property({ type: String, reflect: true }) prompt = ""

  imgAttributes: { [key: string]: string } = {}

  connectedCallback() {
    super.connectedCallback()
    this.initAttributes()
    this.fetchImage()
  }

  async fetchImage() {
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
      this.classList.remove("spin")
    } catch (error) {
      console.error("Error fetching AI image:", error)
      this.imgsrc = this.fallback
      this.classList.remove("spin")
    }
  }

  initAttributes() {
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

    this.imgsrc =
      "data:image/svg+xml;utf8," +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.width} ${this.height}"><rect width="${this.width}" height="${this.height}" fill="#ddd"/></svg>`
      )

    this.classList.add("spin")
  }

  protected render() {
    return html`
      <style>
        :host(.spin) {
          position: relative;
        }

        :host(.spin):before {
          content: "";
          position: absolute;
          margin: auto 0;
          width: 100%;
          height: 100%;
          display: inline-flex;
          justify-content: center;
          align-items: center;
          color: red;
          background-image: url("data:image/svg+xml;utf8,${encodeURIComponent(
            spinner
          )}");
          background-repeat: no-repeat;
          background-position: center;
          background-size: 25%;
        }
      </style>

      ${this.imgsrc.length > 0
        ? html`
            <img
              src=${this.imgsrc}
              decoding="async"
              loading="eager"
              ${spread(this.imgAttributes)}
            />
          `
        : html`<div>fail</div>`}
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
