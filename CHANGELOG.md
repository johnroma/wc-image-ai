# wc-img-ai

## 0.3.0

### Minor Changes

- Add `src`, `llm` and `ratio` attributes.

  - `src`: a ready image URL (or data URL). When set, the component acts as a
    plain `<img>` and never calls the endpoint — for already-known/precomputed
    images. Highest priority in the resolve order.
  - `llm`: provider/model hint forwarded to the endpoint (e.g. `gemini`).
  - `ratio`: aspect ratio forwarded to the endpoint (e.g. `16:9`, `4:1`).

  `llm` and `ratio` are sent in the POST body alongside `prompt`/`imageId`/
  `width`/`height`.

  The grey generating-placeholder is now shown only when the component is
  actually calling the endpoint. `src` (and the initial state) start from a
  transparent pixel, so a ready/stored image loads straight into its box like a
  plain `<img>` with no grey flash.

  Sizing now matches a native `<img>`: `width`/`height` are set as the inner
  image's content attributes (browser reserves the aspect-ratio box, no layout
  shift) and there's no fixed `:host` pixel sizing — style with `class`/CSS
  (`class="block w-full rounded-xl"`) instead of inline `style`. Visual props
  (`border-radius`, `object-fit`, `box-shadow`, …) bridge the shadow boundary via
  `inherit`.

- v2: server-owned, id-addressable images.

  - Rename `src` attribute to `endpoint`.
  - The component now sends a single POST `{ prompt, imageId?, width, height }`
    and lets the server decide between returning a stored image or generating a
    new one. Server responds with `{ id, url }`.
  - New reflected `image-id` attribute: pass a known id to fetch a stored image
    (no AI call); the minted id is reflected back when a new image is generated.
  - New `ai-image` CustomEvent (`{ id, url, prompt }`) for persisting ids to a
    database.
  - Final dead-end is now a 1×1 transparent PNG instead of a "fail" div.
  - If the resolved image url fails to load, retry once then use the fallback
    chain (previously a broken url showed a broken image and bypassed fallback).
  - Added a reference demo server (`demo/server.mjs`, `pnpm demo`) using OpenAI
    gpt-image-1, nanoid and filesystem storage.

## 0.2.2

### Patch Changes

- reset w and h for placeholder

## 0.2.1

### Patch Changes

- changeset problem

## 0.2.0

### Minor Changes

- spinner while waiting for api
