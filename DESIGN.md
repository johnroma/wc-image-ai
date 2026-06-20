# wc-img-ai — design

Captures the decisions behind the current architecture so future changes don't
relitigate them.

## Goal

A reusable, full-stack package for AI-generated images:

1. API tokens stay server-side — the component never holds a key.
2. Every generated image is uniquely addressable by a nanoid so it can be
   stored in a database.
3. A subsequent render can fetch a stored image by id without re-running AI.
4. The package provides both the browser rendering layer and the server
   generation brain — hosts only wire up storage and serving.

## Architecture: three layers

```
┌─────────────────────────────────────────────┐
│  wc-img-ai          (browser)               │
│  <ai-img> web component                     │
│  ↓ POST { prompt, imageId, width, … }       │
├─────────────────────────────────────────────┤
│  host server endpoint  (per-project)        │
│  validates input, calls generateImageBuffer │
│  stores bytes + serves URL                  │
├─────────────────────────────────────────────┤
│  wc-img-ai/server   (Node.js)               │
│  generateImageBuffer → { buffer, mimeType } │
│  provider chain: OpenAI → Gemini → fallback │
└─────────────────────────────────────────────┘

       wc-img-ai/provider-ratios  (shared)
       ratio lists, canvas capabilities, types
```

The component is deliberately dumb. It POSTs to a user-hosted endpoint; the
server holds the key, calls the AI, mints the nanoid, stores the image and
handles lookup. The server module owns the provider brain so every project gets
the same fallback chain and timeout budget without reimplementing it.

## Server module design

`generateImageBuffer(prompt, width, height, options?)` is the single entry
point. It calls the specified provider (default: `openai`) and returns
`{ buffer, mimeType, width, height }` — no side effects, no fallback between
providers.

The module is deliberately low-level, following the same philosophy as the WC:
the consumer decides which provider to use and what to do when it fails.
Provider fallback, retry strategy, and timeout budgeting are application-level
concerns. The module exposes utility functions (`withinOpenaiRatio`,
`openaiGenerationSize`, `nearestGeminiRatio`) so callers can implement their
own routing logic without reimplementing provider constraints.

A caller that wants a fallback chain catches errors from `generateImageBuffer`
and calls it again with a different provider — the module stays out of that
decision.

## Provider ratios as shared contract

`wc-img-ai/provider-ratios` is imported by both the browser component (for
preflight validation) and the server module (for canvas calculations). It is
the single source of truth for:

- Which ratio strings each provider accepts (`OPENAI_RATIOS`, `GEMINI_RATIOS`)
- Canvas capability constraints (`PROVIDER_CANVAS_CAPABILITIES`)
- Canvas size calculation (`generationCanvasForProvider`)

App code that needs to display or validate provider options imports from this
module rather than duplicating the constraints.

## Id semantics

The id is a **storage handle** — it uniquely addresses an image so it can be
stored and looked up. It does not seed generation. Carried on a reflected
`image-id` attribute (not the native `id`, which collides when many `<ai-img>`s
share a page).

## Single smart POST (server decides)

The server — not the client — decides between fetch and generate. One request:

```
POST { prompt, imageId?, width, height, llm?, ratio? }
  imageId stored                → 200 { id, url }   no AI
  imageId missing, prompt given → 200 { id, url }   generate (new id)
  prompt only                   → 200 { id, url }   generate
  otherwise                     → 404
```

The client never branches on existence. This collapsed an earlier
GET-`:id`-then-POST design.

## Blob-proxy mode

If the server returns `Content-Type: image/*` instead of JSON, the component
treats the response as raw bytes, creates a local object URL, and includes the
`Blob` in the `ai-image` event. The host is responsible for uploading to
permanent storage. This mode works for stateless endpoints that don't handle
storage themselves.

## Notes / future

- For exact pixel sizes a server-side resize (e.g. sharp) would be needed.
- The DB/store is the host's concern; the component only surfaces `{ id, url }`.
