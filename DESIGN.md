# wc-img-ai v2 — design

Status: implemented. Captures the decisions behind the v2 rewrite so future
changes don't relitigate them.

## Goal

Modernise `<ai-img>` so that:

1. API tokens stay server-side (the component never holds a key).
2. Every generated image is uniquely addressable by an id (nanoid) so it can be
   stored in a database.
3. A subsequent render can fetch a stored image by id **without** re-running the
   AI.
4. There's a deterministic fallback chain ending in an invisible image.

## Architecture: server endpoint owns everything

The component stays dumb. It POSTs to a single user-hosted endpoint; the server
holds the key, calls the AI, mints the nanoid, stores the image and handles
lookup. (Rejected: the flight-reader "SDK-in-browser + baseURL proxy" trick — it
fits chat/structured-output, but image generation also needs minting + storage +
lookup, which are server concerns anyway.)

## Id semantics

The id is a **storage handle** — it uniquely identifies/addresses an image so it
can be stored and looked up. It does **not** seed generation. Carried on a
dedicated reflected `image-id` attribute (not the native `id`, which is
overloaded and collides when many `<ai-img>`s share a page).

## Single smart POST (server decides)

The server — not the client — decides between fetch and generate. One request:

```
POST {endpoint}  { prompt, imageId?, width, height }
  imageId stored                        -> 200 {id,url}   (no AI)
  imageId missing but prompt present    -> generate -> 200 {id,url}  (new id)
  no imageId, prompt present            -> generate -> 200 {id,url}
  otherwise                             -> 404
```

This collapsed an earlier GET-`:id`-then-POST design: the client no longer
branches on existence. (Rejected: client-side hit/miss resolution + a separate
`GET /:id` route.)

## Client resolution

```
no prompt AND no image-id → fallback → 1×1 transparent PNG
otherwise → POST once
   200 {id,url} → render url; reflect image-id; dispatch ai-image
   404 / error  → fallback → 1×1 transparent PNG
```

- Surfacing the id: a bubbling/composed `ai-image` CustomEvent
  (`{ id, url, prompt }`) **and** reflecting the minted id onto `image-id`.
- Final dead-end: a 1×1 fully-transparent PNG data URL (box keeps width/height;
  no broken-icon, no network).

## Reference server (demo/server.mjs)

OpenAI `gpt-image-1` (returns b64_json) → mint nanoid → write `images/<id>.png`
→ serve statically → return `{ id, url }`. Filesystem-backed so the
"second run skips AI" behaviour survives restarts. gpt-image-1 only emits fixed
sizes, so width/height map to the nearest aspect and the box scales.

## Notes / future

- For exact pixel sizes a server-side resize (e.g. sharp) would be needed.
- The DB/store is the host's concern; the component only surfaces `{ id, url }`.
- A production deployment in saveatrip stores bytes in Postgres (Drizzle) and
  serves them from `/api/img/:id` instead of the filesystem.
