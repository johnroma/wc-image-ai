# wc-img-ai

AI-generated images as a web component. Drop an `<ai-img>` anywhere, give it a
`prompt` and the URL of your own server endpoint, and it renders an
AI-generated image — while the API key, image generation and storage all stay
on the server.

```html
<ai-img
  endpoint="/api/img"
  width="256"
  height="256"
  prompt="a funny dolphin up to no good"
  fallback="https://placehold.co/256x256"
></ai-img>
```

## Why a server endpoint?

The component is deliberately dumb: it never holds an API key, never picks a
provider, and never talks to OpenAI/Gemini directly. It sends a single POST to
**your** endpoint, and your server decides what to do. That keeps tokens
server-side and lets you store, cache and bill generation however you like.

## Install

```bash
pnpm add wc-img-ai
```

```html
<script type="module">
  import "wc-img-ai"
</script>
```

## Attributes

| Attribute   | Reflected | Description                                                                 |
| ----------- | --------- | --------------------------------------------------------------------------- |
| `src`       | —         | A ready image URL (or data URL). When set, the component acts as a plain `<img>` and never calls the endpoint. Use it when you already have the image. Highest priority. |
| `endpoint`  | —         | Your server route. Receives the POST below.                                 |
| `prompt`    | —         | Description used to generate the image.                                     |
| `image-id`  | ✅ yes    | Storage handle. Provide a known id to fetch a stored image; the server sets it on the element when a new image is minted. |
| `llm`       | —         | Provider/model hint forwarded to the endpoint (e.g. `gemini`, `openai`).    |
| `ratio`     | —         | Aspect ratio forwarded to the endpoint (e.g. `16:9`, `4:1`).                |
| `fallback`  | —         | Image URL shown if nothing resolves. If omitted, a 1×1 transparent PNG is used. |
| `width`     | ✅ yes    | Intrinsic width (like `<img width>`) — used for the box aspect-ratio and sent to the endpoint. |
| `height`    | ✅ yes    | Intrinsic height (like `<img height>`).                                     |
| `alt`       | ✅ yes    | Alt text, passed to the inner `<img>`.                                       |

### Sizing & styling — just like a native `<img>`

Set `width`/`height` and style with `class`/CSS; you rarely need inline
`style`. `width`/`height` become the inner image's content attributes, so the
browser reserves the box from their aspect-ratio (no layout shift) while CSS
controls the displayed size:

```html
<!-- full-width 3:1 banner, rounded, no layout shift -->
<ai-img endpoint="/api/img" prompt="…" width="1536" height="512"
        class="block w-full rounded-xl"></ai-img>
```

Visual properties bridge the shadow boundary via `inherit`, so utility classes
like `rounded-xl`, `object-cover`, `shadow-lg` on `<ai-img>` style the image.
Any other attribute (e.g. `loading`) is passed through to the inner `<img>`.

## How it resolves

```
src set                   → render it as a plain <img>      (no endpoint call)
else no prompt, no image-id → fallback → 1×1 transparent PNG (nothing to ask)
else → POST endpoint once  { prompt, imageId, width, height, llm, ratio }
   200 {id,url} → render url, reflect image-id, fire `ai-image` event
   404 / error  → fallback → 1×1 transparent PNG
```

`src` is the cheapest path: if you already have the image (a precomputed or
returning one), set `src` and the component skips the AI entirely. Only when
`src` is empty does it fall back to the `prompt`/`image-id` flow.

> **Performance note.** For an image you _already have the URL for_, a plain
> `<img src>` will paint faster than `<ai-img src>` — the web component can't
> render until its own script has loaded and defined the element, whereas a
> native `<img>` loads with the document. Use `src` for a single unified tag;
> reach for a native `<img>` (and load `<ai-img>` only when you need to
> generate) when first paint of a known image is critical.

The component never branches on whether an image exists — the **server** owns
that decision (see the contract below). If the returned `url` itself fails to
load in the `<img>` (a transient 404, slow propagation, a stale url), the
component retries once and then drops to the fallback chain.

## The `ai-image` event

Fired after a successful resolve. Use it to persist the id (and url) to a
database so you can render the same image again later without re-generating.

```js
el.addEventListener("ai-image", (e) => {
  // e.detail = { id, url, prompt }
  db.save(e.detail)
})
```

The minted id is also reflected onto the `image-id` attribute.

## Server contract

The component talks to a single endpoint with one POST. Your server is the
"smart" side that decides between fetching a stored image and generating a new
one.

### `POST {endpoint}`

Request body:

```json
{ "prompt": "a funny dolphin", "imageId": "V1StGXR8_Z5", "width": 256, "height": 256, "llm": "gemini", "ratio": "16:9" }
```

`imageId`, `width`, `height`, `llm` and `ratio` are optional. Use `llm`/`ratio`
to let the server pick a provider and aspect ratio. Expected server behaviour:

| Condition                                   | Response          |
| ------------------------------------------- | ----------------- |
| `imageId` given and stored                  | `200 {id,url}` — return it, no AI |
| `imageId` given but missing, `prompt` given | `200 {id,url}` — generate (mint a new id) |
| no `imageId`, `prompt` given                | `200 {id,url}` — generate |
| nothing to do                               | `404`             |

Response body on success:

```json
{ "id": "V1StGXR8_Z5", "url": "/images/V1StGXR8_Z5.png" }
```

`url` can be anything the browser can load (a hosted/CDN URL, a route on your
server, or a data URL).

## Reference demo server

`demo/server.mjs` is a complete, dependency-light reference implementation:
OpenAI `gpt-image-2`, nanoid ids, filesystem storage under `images/`, served
back as stable URLs.

```bash
cp .env.example .env   # add OPENAI_API_KEY
pnpm install
pnpm build
pnpm demo              # http://localhost:3000
```

## License

MIT
