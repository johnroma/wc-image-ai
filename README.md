# wc-img-ai

AI-generated images as a web component, with a matching server module that owns
all provider logic. Drop an `<ai-img>` anywhere, point it at your endpoint, and
generation happens server-side — API keys never leave the server.

```html
<ai-img
  endpoint="/api/img"
  width="1536"
  ratio="16:9"
  prompt="a wide panoramic vintage travel poster of Lisbon"
  class="block w-full rounded-xl"
></ai-img>
```

## Packages

| Import | Environment | What it does |
|---|---|---|
| `wc-img-ai` | browser | `<ai-img>` web component |
| `wc-img-ai/provider-ratios` | browser + server | Provider ratio lists, canvas capabilities, type utilities |
| `wc-img-ai/server` | Node.js server | `generateImageBuffer` — full multi-provider generation brain |

---

## `<ai-img>` web component

```bash
pnpm add wc-img-ai
```

```html
<script type="module">
  import "wc-img-ai"
</script>
```

### Attributes

| Attribute   | Reflected | Description |
| ----------- | --------- | ----------- |
| `src`       | —         | A ready image URL. When set the component acts as a plain `<img>` and skips the endpoint entirely. Highest priority. |
| `endpoint`  | —         | Your server route. Receives the POST described below. |
| `prompt`    | —         | Description used to generate the image. |
| `image-id`  | on mint   | Storage handle. Provide a known id to skip generation; the server reflects the minted id back on new images. |
| `llm`       | —         | Provider hint forwarded to the endpoint (`openai`, `gemini`). |
| `ratio`     | —         | Aspect ratio forwarded to the endpoint (`16:9`, `4:1`, …). With `width`, derives the effective height. |
| `light`     | —         | Boolean hint forwarded for `llm="gemini"`; selects Gemini Flash Lite instead of regular Flash. |
| `subscription` | —      | Requests the endpoint's subscription-backed transport instead of API billing. |
| `regenerate` | —        | Bypasses and replaces the endpoint cache for this generation identity. |
| `fallback`  | —         | URL shown if nothing resolves. Defaults to a 1×1 transparent PNG. |
| `width`     | ✅        | Intrinsic width — used for box aspect-ratio and sent to the endpoint. |
| `height`    | —         | Optional intrinsic height; derived when omitted and `width`/`ratio` are set. |
| `alt`       | ✅        | Alt text for the inner `<img>`. |

### How it resolves

```
src set                    → plain <img>, no endpoint call
no prompt, no image-id     → fallback → 1×1 transparent PNG
otherwise → POST endpoint  { prompt, imageId, width, height, llm, ratio, light? }
  200 { id, url }  → render, reflect image-id, fire ai-image event
  error            → fire ai-image-error → fallback → 1×1 transparent PNG
```

If the returned URL fails to load in the browser, the component retries once
(cache-busted) then falls to the fallback chain.

### Events

**`ai-image`** — fired after a successful resolve:
```js
el.addEventListener("ai-image", (e) => {
  // e.detail = { id, url, prompt, blob? }
  db.save({ id: e.detail.id, url: e.detail.url })
})
```

**`ai-image-error`** — fired before settling on the fallback:
```js
el.addEventListener("ai-image-error", (e) => {
  console.error(e.detail.message, e.detail.status)
})
```

### Sizing & styling

Set `width` + `ratio` (or `width` + `height`) and style with CSS. The component
reserves the layout box at the correct aspect ratio (no layout shift) while CSS
controls the displayed size. Visual properties (`border-radius`, `object-fit`,
etc.) bridge the shadow boundary via `inherit`:

```html
<ai-img endpoint="/api/img" prompt="…"
        width="1536" ratio="16:9"
        class="block w-full rounded-xl object-cover"></ai-img>
```

---

## `wc-img-ai/server` — generation brain

The server module handles provider selection, fallback chain, ratio snapping
and timeout budgeting. It returns raw bytes — storing and serving is the
caller's concern.

```bash
# It's a Node.js module — import only in server code
import { generateImageBuffer } from 'wc-img-ai/server'
```

### `generateImageBuffer(prompt, width, height, options?)`

```ts
const { buffer, mimeType } = await generateImageBuffer(
  "a vintage travel poster of Lisbon",
  1536,
  864,
  { provider: 'gemini', aspectRatio: '16:9' }   // options optional
)
// buffer: Buffer, mimeType: 'image/png' | 'image/jpeg'
```

With no `provider` specified, defaults to `openai`. The module calls exactly
one provider and throws on failure — provider fallback and retry strategy are
the caller's responsibility.

### Multimodal prompts (reference images)

`prompt` accepts TanStack AI's `MediaPrompt`: either a string or an ordered
array of text and image parts. Put the instructions and references in the same
prompt so their relationship is explicit:

```ts
import {
  generateImageBuffer,
  type MediaPrompt,
} from 'wc-img-ai/server'

const referenceData = Buffer.from(
  await referenceImage.arrayBuffer(),
).toString('base64')

const prompt: MediaPrompt = [
  { type: 'text', content: 'Use image 1 as the composition reference.' },
  {
    type: 'image',
    source: {
      type: 'data',
      value: referenceData,
      mimeType: referenceImage.type,
    },
  },
  { type: 'text', content: 'Render it as a clean architectural blueprint.' },
]

const image = await generateImageBuffer(prompt, 1536, 1024, {
  provider: 'openai',
})
```

For OpenAI, text parts are joined and image parts are sent in the same
multipart `/images/edits` request. For Gemini, the ordered parts are sent as
text and `inlineData` in the same `generateContent` request. Multiple image
parts are supported. Image sources must currently be base64 `data` sources;
server-side URL fetching is intentionally disabled.

### Opt-in custom transport

A server application can supply its own generator. This is never selected by
default and cannot be serialized through the web component; the endpoint owns
its authentication and transport:

```ts
const image = await generateImageBuffer(prompt, width, height, {
  provider: 'custom',
  generate: async ({ prompt, width, height, signal }) => {
    const response = await fetch('http://127.0.0.1:8188/generate', {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, width, height }),
    })
    if (!response.ok) throw new Error(`local generator failed: ${response.status}`)
    return {
      buffer: new Uint8Array(await response.arrayBuffer()),
      mimeType: 'image/png',
    }
  },
})
```

The callback must return non-empty image bytes and an `image/*` MIME type. It
receives an abort signal enforcing the configured `timeoutMs`.

### Provider routing utilities

For implementing your own fallback strategy:

```ts
import { withinOpenaiRatio, openaiGenerationSize, nearestGeminiRatio } from 'wc-img-ai/server'

async function generateWithFallback(prompt, width, height) {
  if (withinOpenaiRatio(width, height)) {
    try { return await generateImageBuffer(prompt, width, height, { provider: 'openai' }) }
    catch { /* try next */ }
  }
  return generateImageBuffer(prompt, width, height, {
    provider: 'gemini',
    aspectRatio: nearestGeminiRatio(width, height),
  })
}
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | — | Required for OpenAI provider |
| `GEMINI_API_KEY` | — | Required for Gemini provider |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2` | Override OpenAI model |
| `GEMINI_IMAGE_MODEL` | `gemini-3.1-flash-image` | Override the regular Gemini model; `light` explicitly selects Flash Lite |

### Minimal server example

```js
import { generateImageBuffer } from 'wc-img-ai/server'
import { nanoid } from 'nanoid'
import fs from 'node:fs'

// POST /api/img  { prompt, imageId?, width, height, llm?, ratio? }
async function handleImagePost(body) {
  const { prompt, imageId, width, height, llm, ratio } = body

  // Return stored image if we already have it
  if (imageId && fs.existsSync(`images/${imageId}.png`)) {
    return { id: imageId, url: `/images/${imageId}.png` }
  }

  if (!prompt) throw new Error('prompt required')

  const { buffer, mimeType } = await generateImageBuffer(
    prompt, width ?? 0, height ?? 0,
    { provider: llm, aspectRatio: ratio }
  )

  const id = nanoid()
  const ext = mimeType === 'image/jpeg' ? 'jpg' : 'png'
  fs.writeFileSync(`images/${id}.${ext}`, buffer)
  return { id, url: `/images/${id}.${ext}` }
}
```

See `demo/server.mjs` for a complete runnable HTTP server using this pattern.

---

## `wc-img-ai/provider-ratios` — provider capabilities

Shared between browser and server — the single source of truth for which
ratios and canvas constraints each provider supports.

```ts
import {
  OPENAI_RATIOS, GEMINI_RATIOS,
  PROVIDER_CANVAS_CAPABILITIES,
  generationCanvasForProvider,
  isRatioSupported,
  GEMINI_MODEL_CAPABILITIES,
  assertGeminiGenerationSupported,
  type HeroProvider, type OpenAiRatio, type GeminiRatio,
  type GeminiImageModel, type GeminiImageSize,
  type GeminiFlashImageSize, type GeminiFlashLiteImageSize,
} from 'wc-img-ai/provider-ratios'
```

Capabilities are model-specific. In particular, `gemini-3.1-flash-image`
supports `512`, `1K`, `2K`, and `4K`, while
`gemini-3.1-flash-lite-image` supports `1K`, `2K`, and `4K`. The exported
`GenerateOptions` type rejects `light: true` + `512`, and the server validates
model capabilities before making an API request.

```html
<ai-img llm="gemini" light endpoint="/api/img" prompt="…"></ai-img>
```

`light` is currently ignored for other providers. OpenAI has both mini models
and quality controls, but those represent different trade-offs and are not yet
silently mapped to this hint.

The `<ai-img>` component validates `llm` + `ratio` against this module before
making any endpoint call.

---

## Server endpoint contract

One POST, server decides everything:

```
POST {endpoint}  { prompt, imageId?, width, height, llm?, ratio?, light? }

  imageId given & stored   → 200 { id, url }       no AI call
  imageId missing + prompt → 200 { id, url }       generate (new id)
  prompt only              → 200 { id, url }       generate
  nothing to do            → 404
```

The server can also return raw image bytes (blob-proxy mode) — the component
detects the `Content-Type: image/*` response and fires the `ai-image` event
with a `blob` field so the host can upload to its own storage.

## Testing provider integrations without API charges

The test harness has one mock-mode switch: `MSW=true`. It is intentionally not
split into server and browser variables: Node tests use it to start MSW's
`setupServer`, and any browser test harness should use that same switch to start
MSW's `setupWorker`. The Vite and Vitest configs expose this one test-only value
as both `process.env.MSW` and `import.meta.env.MSW`; it must never contain a
secret.

The current end-to-end suite runs the demo HTTP flow in Node and intercepts the
provider requests with `setupServer`. The handlers cover OpenAI image
generations, OpenAI image edits, and Gemini `generateContent`, returning a tiny
deterministic PNG fixture. Unhandled non-local HTTP requests fail the test, so a
changed provider URL cannot silently spend API tokens.

```sh
pnpm test      # build, unit tests, and the mocked HTTP end-to-end flow
pnpm test:e2e  # build and run only the mocked HTTP end-to-end flow
```

`MSW` is test-only. The demo and published package do not enable mocks, and the
mock server is never included in runtime code.

## License

MIT
