# Reference Image Support — Implementation Plan

**Status:** OpenAI server-adapter prototype complete; component/Gemini layers remain planned
**Date:** 2026-07-16
**Component:** `wc-img-ai` Web Component
**Goal:** Add optional reference image input for text-and-image-to-image generation while maintaining backwards compatibility

**Development guardrail:** Until the prototype is explicitly approved for live
testing, provider calls must be exercised only through mocked `fetch` responses.
Tests must use dummy credentials and must never consume OpenAI or Gemini tokens.

**Current prototype slice:** Start at the OpenAI server adapter. Preserve the
existing `images/generations` JSON request when no reference-image `Blob` is
available; switch to multipart `images/edits` only when the optional reference
image is supplied as a `Blob`. This routing is covered by unit tests before the
component and Gemini layers are changed.

---

## Executive Summary

Adding reference image support requires **minimal architectural changes** because the existing three-layer data flow is already designed for extensibility. The extension points are:

1. **Component attributes** (`src/ai-img.ts`) — Add optional `input-image` property
2. **Endpoint request contract** (`src/get-generated-image.ts`) — Add optional `referenceImage` field
3. **Server options** (`src/server.ts`) — Add optional field to `BuiltinGenerateOptionsBase`
4. **Provider adapters** — Translate to provider-specific formats (Gemini `inlineData`, OpenAI multipart)

All changes use **optional fields** (`?:` in TypeScript), ensuring existing users see no behavior change.

---

## Provider Capability Research

### Gemini (✅ Supported)

**Implementation:** The existing `callGemini` adapter in `src/server.ts` already constructs the `generateContent` API payload:

```typescript
{
  contents: [{ parts: [{ text: prompt }] }],
  generationConfig: {
    responseModalities: ['TEXT', 'IMAGE'],
    imageConfig: { aspectRatio: ratio, imageSize: requestedSize },
  },
}
```

**Extension:** When `referenceImage` is provided, add an `inlineData` part:

```typescript
const parts = [{ text: prompt }];

if (referenceImage) {
  const { mimeType, data } = await toInlineData(referenceImage);
  parts.push({
    inlineData: { mimeType, data }, // Base64-encoded image
  });
}

{
  contents: [{ parts }],
  generationConfig: { ... },
}
```

**Validation:** No new validation needed — Gemini accepts arbitrary `inlineData` objects. The model itself determines whether it can use the reference.

---

### OpenAI (⚠️ Multipart, `images/edits` Endpoint)

**Current Implementation:** `callOpenAI` uses the `images/generations` endpoint (text-to-image only):

```typescript
const response = await fetch(`${OPENAI_BASE}/images/generations`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: ... },
  body: JSON.stringify({ model, prompt, n: 1, size }),
});
```

**Extension Required:** Switch to the `images/edits` endpoint for image-to-image:

```typescript
const formData = new FormData();
formData.append('model', model);
formData.append('prompt', prompt);
formData.append('image', referenceImageBlob); // File or Blob
formData.append('n', '1');

const response = await fetch(`${OPENAI_BASE}/images/edits`, {
  method: 'POST',
  headers: { Authorization: ... }, // No Content-Type for FormData
  body: formData,
});
```

**Constraints:**
- `images/edits` uses **multipart/form-data**, not JSON
- Requires the image as a **File or Blob** (not a URL or base64 string)
- Response format is the same as `images/generations` (base64 JSON)
- Model support: **gpt-image-1** and **gpt-image-2** both support edits (confirmed via API docs and third-party guides)

**Conditional Logic:** `images/generations` remains the default. The adapter
switches to `images/edits` only after the optional reference image has resolved
to a `Blob`; OpenAI's generations endpoint does not accept image uploads.
```typescript
const referenceImageBlob = referenceImage
  ? await toBlob(referenceImage)
  : undefined;

if (referenceImageBlob) {
  // Use images/edits endpoint with multipart
  return await callOpenAIEdition(prompt, referenceImageBlob, model, size, timeoutMs);
} else {
  // Use existing images/generations endpoint
  return await callOpenAI(prompt, model, size, timeoutMs);
}
```

---

### Custom Generators (✅ Flexible)

**Current Implementation:** `callCustom` passes `CustomGenerateRequest` to user-supplied generators:

```typescript
type CustomGenerateRequest = {
  prompt: string;
  width: number;
  height: number;
  signal: AbortSignal;
};
```

**Extension:** Add optional `referenceImage` field:

```typescript
type CustomGenerateRequest = {
  prompt: string;
  width: number;
  height: number;
  signal: AbortSignal;
  referenceImage?: string; // Optional reference URL
};
```

**Implementation Responsibility:** Custom generators decide whether to use the reference image. The package simply forwards it if provided.

---

## Detailed Implementation Plan

### 1. Component Layer (`src/ai-img.ts`)

**Changes:**
```typescript
export class AiImg extends LitElement {
  // ... existing properties ...

  /**
   * Reference image URL for image-to-image generation.
   * Optional: when omitted, the component behaves exactly as before (text-only).
   */
  @property({ type: String, attribute: 'input-image' })
  inputImage?: string;

  // ... existing code ...

  private async resolve(resolveToken: number) {
    const dimensions = dimensionsFor(this.width, this.height, this.ratio);
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
          referenceImage: this.inputImage, // Optional extension
        },
        // ...
      );
    } catch (error) {
      // ...
    }
  }

  // Update changed properties check
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
      changed.has('fallback') ||
      changed.has('input-image'); // New field

    if (shouldRestart) {
      queueMicrotask(() => this.start());
    }
  }
}
```

**Testing:**
- Verify that omitting `input-image` produces identical requests to current behavior
- Verify that providing `input-image` includes the field in the POST body

---

### 2. Endpoint Client Layer (`src/get-generated-image.ts`)

**Changes:**
```typescript
export interface ResolveImageRequest {
  prompt?: string;
  imageId?: string;
  referenceImage?: string; // Optional extension
  width?: number;
  height?: number;
  llm?: string;
  ratio?: string;
  light?: boolean;
  subscription?: boolean;
  regenerate?: boolean;
}
```

**Behavior:**
- `JSON.stringify()` automatically omits `undefined` fields, so existing hosts receive no extra data
- The component passes `referenceImage` directly; no transformation needed

**Testing:**
- Verify that `resolveImage(endpoint, { prompt: 'test' })` produces `{ "prompt": "test" }`
- Verify that `resolveImage(endpoint, { prompt: 'test', referenceImage: 'url' })` produces `{ "prompt": "test", "referenceImage": "url" }`

---

### 3. Server Module Layer (`src/server.ts`)

**Changes to Type Definitions:**
```typescript
type BuiltinGenerateOptionsBase = {
  provider?: HeroProvider;
  aspectRatio?: GeminiRatio;
  openaiModel?: OpenAiImageModel;
  timeoutMs?: number;
  referenceImage?: Blob; // Optional extension; avoids server-side URL fetching
};

// ... rest unchanged ...

type CustomGenerateRequest = {
  prompt: string;
  width: number;
  height: number;
  signal: AbortSignal;
  referenceImage?: string; // Optional extension
};
```

**Changes to `generateImageBuffer`:**
```typescript
export async function generateImageBuffer(
  prompt: string,
  width: number,
  height: number,
  options: GenerateOptions = {},
): Promise<GeneratedBuffer> {
  const requestedWidth = outputDimension(width);
  const requestedHeight = outputDimension(height);
  const w = requestedWidth ?? 1024;
  const h = requestedHeight ?? 1024;
  const timeoutMs = options.timeoutMs ?? 90_000;

  let result: { buffer: Buffer; mimeType: string };

  if (options.provider === 'custom') {
    result = await callCustom(options.generate, prompt, w, h, timeoutMs, options.referenceImage);
  } else if ((options.provider ?? 'openai') === 'openai') {
    const model = options.openaiModel ?? process.env.OPENAI_IMAGE_MODEL ?? DEFAULT_OPENAI_MODEL;
    if (!withinOpenaiRatio(w, h)) {
      throw new Error(`${w}x${h} exceeds ${model}'s 3:1 aspect-ratio limit`);
    }
    result = await callOpenAI(prompt, openaiGenerationSize(w, h), model, timeoutMs, options.referenceImage);
  } else if (options.provider === 'gemini') {
    const model = options.geminiModel ?? (options.light ? GEMINI_FLASH_LITE_IMAGE_MODEL : (process.env.GEMINI_IMAGE_MODEL ?? DEFAULT_GEMINI_MODEL));
    result = await callGemini(prompt, w, h, model, timeoutMs, options.aspectRatio, options.geminiImageSize, options.referenceImage);
  } else {
    throw new Error(`Unknown provider: ${String(options.provider)}`);
  }

  return {
    ...result,
    width: requestedWidth ?? null,
    height: requestedHeight ?? null,
  };
}
```

---

### 4. Provider Adapter Layer (`src/server.ts`)

#### 4.1 Gemini Adapter Extension

**New Helper Function:**
```typescript
/**
 * Fetch an image URL and convert to Gemini's inlineData format.
 */
async function toInlineData(url: string): Promise<{ mimeType: string; data: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch reference image: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  const mimeType = response.headers.get('Content-Type') || 'image/jpeg';
  return { mimeType, data: base64 };
}
```

**Extended `callGemini`:**
```typescript
async function callGemini(
  prompt: string,
  width: number,
  height: number,
  model: string,
  timeoutMs: number,
  explicitRatio?: GeminiRatio,
  explicitImageSize?: GeminiImageSize,
  referenceImage?: string, // New parameter
): Promise<{ buffer: Buffer; mimeType: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const capabilities = geminiModelCapabilities(model);
  const ratio = explicitRatio ?? nearestGeminiRatio(width, height);
  const requestedSize =
    explicitImageSize ??
    (Math.max(width, height) > 2048
      ? '4K'
      : Math.max(width, height) > 1024
        ? '2K'
        : capabilities?.defaultImageSize);
  assertGeminiGenerationSupported(model, ratio, requestedSize);

  // Build parts array
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: prompt },
  ];

  if (referenceImage) {
    const inlineData = await toInlineData(referenceImage);
    parts.push({ inlineData });
  }

  const response = await fetch(
    `${GEMINI_BASE}/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: {
            aspectRatio: ratio,
            imageSize: requestedSize,
          },
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    },
  );

  if (!response.ok) {
    const text = (await response.text()).trim();
    let message = `Gemini image generation failed (${response.status})`;
    try {
      const body = JSON.parse(text) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      message = text.replace(/\s+/g, ' ').slice(0, 300);
    }
    throw new Error(message);
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ inlineData?: { data: string; mimeType?: string } }>;
      };
    }>;
  };
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const inline = parts.find((p) => p.inlineData)?.inlineData;
  if (!inline) throw new Error(`Gemini ${model} returned no image data`);
  return {
    buffer: Buffer.from(inline.data, 'base64'),
    mimeType: inline.mimeType ?? 'image/jpeg',
  };
}
```

#### 4.2 OpenAI Adapter Extension

**New Helper Function:**
```typescript
/**
 * Fetch an image URL as a Blob for OpenAI's multipart form upload.
 */
async function toBlob(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch reference image: ${response.status}`);
  }
  return await response.blob();
}
```

**New `callOpenAIEdition` Function:**
```typescript
async function callOpenAIEdition(
  prompt: string,
  referenceImage: string,
  model: string,
  size: string,
  timeoutMs: number,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const formData = new FormData();
  formData.append('model', model);
  formData.append('prompt', prompt);
  formData.append('n', '1');
  formData.append('size', size);
  formData.append('image', await toBlob(referenceImage)); // Blob upload

  const response = await fetch(`${OPENAI_BASE}/images/edits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` }, // No Content-Type for FormData
    body: formData,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const text = (await response.text()).trim();
    let message = `OpenAI image edition failed (${response.status})`;
    try {
      const body = JSON.parse(text) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      message = text.replace(/\s+/g, ' ').slice(0, 300);
    }
    throw new Error(message);
  }

  const data = (await response.json()) as {
    data?: Array<{ b64_json?: string }>;
  };
  const base64 = data?.data?.[0]?.b64_json;
  if (!base64) throw new Error(`OpenAI ${model} returned no image data`);
  return { buffer: Buffer.from(base64, 'base64'), mimeType: 'image/png' };
}
```

**Modified `callOpenAI` Wrapper:**
```typescript
async function callOpenAI(
  prompt: string,
  size: string,
  model: string,
  timeoutMs: number,
  referenceImage?: string, // New parameter
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (referenceImage) {
    // Use the edits endpoint for image-to-image
    return await callOpenAIEdition(prompt, referenceImage, model, size, timeoutMs);
  }

  // Original text-to-image logic
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const response = await fetch(`${OPENAI_BASE}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, prompt, n: 1, size }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const text = (await response.text()).trim();
    let message = `OpenAI image generation failed (${response.status})`;
    try {
      const body = JSON.parse(text) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      message = text.replace(/\s+/g, ' ').slice(0, 300);
    }
    throw new Error(message);
  }

  const data = (await response.json()) as {
    data?: Array<{ b64_json?: string }>;
  };
  const base64 = data?.data?.[0]?.b64_json;
  if (!base64) throw new Error(`OpenAI ${model} returned no image data`);
  return { buffer: Buffer.from(base64, 'base64'), mimeType: 'image/png' };
}
```

#### 4.3 Custom Generator Extension

**Modified `callCustom`:**
```typescript
async function callCustom(
  generate: CustomImageGenerator,
  prompt: string,
  width: number,
  height: number,
  timeoutMs: number,
  referenceImage?: string, // New parameter
): Promise<{ buffer: Buffer; mimeType: string }> {
  const signal = AbortSignal.timeout(timeoutMs);
  const aborted = new Promise<never>((_, reject) => {
    signal.addEventListener(
      'abort',
      () => reject(signal.reason ?? new Error('custom image generation timed out')),
      { once: true },
    );
  });
  const result = await Promise.race([
    generate({ prompt, width, height, signal, referenceImage }),
    aborted,
  ]);
  if (!(result.buffer instanceof Uint8Array) || result.buffer.byteLength === 0) {
    throw new Error('Custom image generator returned an empty or invalid buffer');
  }
  if (!result.mimeType.startsWith('image/')) {
    throw new Error(`Custom image generator returned invalid MIME type: ${result.mimeType}`);
  }
  return { buffer: Buffer.from(result.buffer), mimeType: result.mimeType };
}
```

---

### 5. Provider Validation Layer (`src/provider-ratios.ts`)

**Optional Enhancement:** Add a capability check for reference image support.

```typescript
export const PROVIDER_REFERENCE_IMAGE_CAPABILITY = {
  openai: true,  // Supports via images/edits endpoint
  gemini: true,  // Supports via inlineData
  custom: 'variable', // Depends on user implementation
} as const satisfies Record<HeroProvider | 'custom', boolean | 'variable'>;

export function isReferenceImageSupported(provider: string): boolean {
  const capability = PROVIDER_REFERENCE_IMAGE_CAPABILITY[provider as keyof typeof PROVIDER_REFERENCE_IMAGE_CAPABILITY];
  return capability === true;
}
```

**Usage in Component (Optional):**
```typescript
// In start() method, after existing validation
if (this.inputImage && !isReferenceImageSupported(this.llm)) {
  this.dispatchError(`Reference images are not supported by provider ${this.llm}`);
  this.settleFallback();
  return;
}
```

**Note:** This is optional because:
- Gemini always accepts `inlineData` (the model may ignore it)
- OpenAI endpoint switching happens automatically in `callOpenAI`
- Custom generators are user-controlled

---

## Type Declarations Update

The generated TypeScript declarations will automatically include the new optional fields after rebuilding:

**`types/ai-img.d.ts` (auto-generated):**
```typescript
export declare class AiImg extends LitElement {
  src: string;
  endpoint: string;
  prompt: string;
  imageId: string;
  llm: string;
  ratio: string;
  light: boolean;
  subscription: boolean;
  regenerate: boolean;
  fallback: string;
  width: string;
  height: string;
  alt: string;
  inputImage?: string; // New optional field
  status: 'idle' | 'loading' | 'loaded' | 'error';
  errorMessage: string;
  errorStatus: number | undefined;
  // ... rest unchanged
}
```

**`types/get-generated-image.d.ts` (auto-generated):**
```typescript
export interface ResolveImageRequest {
  prompt?: string;
  imageId?: string;
  referenceImage?: string; // New optional field
  width?: number;
  height?: number;
  llm?: string;
  ratio?: string;
  light?: boolean;
  subscription?: boolean;
  regenerate?: boolean;
}
```

**`types/server.d.ts` (auto-generated):**
```typescript
export type BuiltinGenerateOptionsBase = {
  provider?: HeroProvider;
  aspectRatio?: GeminiRatio;
  openaiModel?: OpenAiImageModel;
  timeoutMs?: number;
  referenceImage?: string; // New optional field
};

export type CustomGenerateRequest = {
  prompt: string;
  width: number;
  height: number;
  signal: AbortSignal;
  referenceImage?: string; // New optional field
};
```

---

## Host Endpoint Changes

Host endpoints (like `demo/server.mjs`) must accept and forward the new field:

**Changes to `demo/server.mjs`:**
```javascript
// In the POST handler
const { prompt, imageId, inputImage, width, height, llm, ratio, light, subscription, regenerate } = await req.json();

// Forward to server module
const result = await generateImageBuffer(
  prompt || 'no prompt',
  Number(width) || undefined,
  Number(height) || undefined,
  {
    provider: llm || 'openai',
    aspectRatio: ratio,
    light,
    subscription,
    regenerate,
    referenceImage: inputImage, // Optional extension
  },
);
```

**Testing:**
- Verify that omitting `inputImage` produces the same response as before
- Verify that providing `inputImage` results in image-to-image behavior with compatible providers

---

## Backwards Compatibility Guarantees

| Change | Backwards Compatible? | Reason |
|--------|----------------------|--------|
| Component `input-image` attribute | ✅ Yes | Optional property; defaults to `undefined` |
| `ResolveImageRequest.referenceImage` | ✅ Yes | Optional field; JSON omits `undefined` values |
| `BuiltinGenerateOptionsBase.referenceImage` | ✅ Yes | Optional field; adapters check before use |
| `CustomGenerateRequest.referenceImage` | ✅ Yes | Optional field; custom generators decide usage |
| Host endpoint payload | ✅ Yes | Old hosts ignore unknown fields; no error |
| OpenAI endpoint switching | ✅ Yes | `referenceImage` absent → `images/generations`; present → `images/edits` |
| Gemini `inlineData` addition | ✅ Yes | Gemini accepts arbitrary parts; model determines relevance |

**No Breaking Changes:**
- All existing code paths continue to work exactly as before
- New fields are opt-in via explicit attribute/property
- Type signatures remain compatible (adding optional fields is safe)

---

## Open Questions & Future Considerations

### 1. Image Format Constraints
**Question:** Should we validate that the reference image is a supported format (PNG, JPEG, WebP)?

**Options:**
- **No validation:** Let providers handle it (Gemini accepts any `mimeType`, OpenAI's multipart accepts any Blob)
- **Browser-side validation:** Check `mimeType` before forwarding
- **Server-side validation:** After fetching, validate format before sending to provider

**Recommendation:** Start with **no validation**; providers have their own format checks. Add validation if users report errors.

---

### 2. Image Size Constraints
**Question:** Should we enforce size limits on reference images?

**Constraints:**
- **OpenAI:** Images must be **< 4MB** and **same format as mask** (if using mask)
- **Gemini:** No documented size limits for `inlineData`
- **Custom generators:** User-defined

**Recommendation:** Enforce OpenAI's **4MB limit** only for OpenAI requests:

```typescript
async function toBlob(url: string, maxSizeBytes = 4 * 1024 * 1024): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch reference image: ${response.status}`);
  const blob = await response.blob();
  if (blob.size > maxSizeBytes) {
    throw new Error(`Reference image exceeds ${maxSizeBytes / 1024 / 1024}MB limit`);
  }
  return blob;
}
```

---

### 3. Mask Support (OpenAI)
**Question:** Should we support optional `mask` images for OpenAI's in-painting?

**Current Plan:** Focus on **image-to-image** (reference image only). Mask support can be added later as a separate feature:

```typescript
// Future extension (not implemented now)
export interface ResolveImageRequest {
  // ... existing fields ...
  referenceImage?: string;
  maskImage?: string; // For OpenAI in-painting
}
```

**Rationale:** Mask is OpenAI-specific and requires additional UI (mask selection, editing). Start with simpler reference image use case.

---

### 4. Cross-Origin Resource Sharing (CORS)
**Question:** What if the reference image URL is on a different domain?

**Current Behavior:** `fetch(url)` will fail if CORS headers are not present.

**Options:**
- **Let it fail:** Clear error message, user must provide CORS-enabled URL
- **Proxy through host:** Host endpoint fetches the image, buffers it, forwards to provider
- **Data URL support:** Accept base64 data URIs directly (no CORS)

**Recommendation:** Start with **let it fail + data URL support**:

```typescript
async function toInlineData(input: string): Promise<{ mimeType: string; data: string }> {
  // Support data URIs (no CORS)
  if (input.startsWith('data:')) {
    const match = input.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error('Invalid data URI format');
    return { mimeType: match[1], data: match[2] };
  }

  // Fetch URL (requires CORS)
  const response = await fetch(input);
  if (!response.ok) throw new Error(`Failed to fetch reference image: ${response.status}`);
  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  const mimeType = response.headers.get('Content-Type') || 'image/jpeg';
  return { mimeType, data: base64 };
}
```

---

### 5. Caching Behavior
**Question:** Should reference images be cached? If so, at which layer?

**Options:**
- **No caching:** Always fetch the reference image URL fresh
- **Browser cache:** Rely on browser's HTTP cache
- **Host-side cache:** Host endpoint fetches and caches reference images
- **Storage ID caching:** Generate an image ID for the reference image and reuse it

**Recommendation:** Start with **no explicit caching** (browser cache applies automatically). Add host-side caching if needed for performance.

---

## Testing Strategy

### Unit Tests
- **Component:** Verify `input-image` property is reflected and included in requests
- **Endpoint client:** Verify `ResolveImageRequest` serialization (with/without `referenceImage`)
- **Server module:** Verify options passing to adapters
- **Adapter helpers:** Verify `toInlineData` and `toBlob` error handling

### Integration Tests
- **End-to-end:** Component → endpoint → server → provider → response
- **Provider-specific:** Test Gemini and OpenAI with actual API keys (if available)
- **Backwards compatibility:** Verify existing text-only prompts still work

### Manual Testing
1. **Omit `input-image`:** Verify identical behavior to current version
2. **Provide valid URL:** Verify image-to-image generation
3. **Provide invalid URL:** Verify clear error message
4. **Provide data URL:** Verify base64 support
5. **CORS failure:** Verify helpful error message

---

## Implementation Checklist

- [ ] Add `input-image` property to `AiImg` component
- [ ] Add `referenceImage` field to `ResolveImageRequest` interface
- [ ] Add `referenceImage` field to `BuiltinGenerateOptionsBase` type
- [ ] Add `referenceImage` field to `CustomGenerateRequest` type
- [ ] Implement `toInlineData` helper for Gemini
- [ ] Implement `toBlob` helper for OpenAI
- [ ] Implement `callOpenAIEdition` function
- [ ] Extend `callOpenAI` to use `callOpenAIEdition` when `referenceImage` present
- [ ] Extend `callGemini` to add `inlineData` part when `referenceImage` present
- [ ] Extend `callCustom` to pass `referenceImage` to generator
- [ ] Update `generateImageBuffer` to pass `referenceImage` to adapters
- [ ] Update demo host endpoint to accept and forward `inputImage`
- [ ] Rebuild TypeScript declarations
- [ ] Add unit tests for new helpers and conditional logic
- [ ] Add integration tests for reference image flow
- [ ] Manual testing with Gemini and OpenAI (if API keys available)
- [ ] Update README.md with `input-image` attribute documentation
- [ ] Update DESIGN.md with reference image support notes

---

## Documentation Updates

### README.md
Add section under "Attributes":

```markdown
### input-image (optional)

Reference image URL for image-to-image generation. When provided, the component forwards the image to the host endpoint, which may use it as a reference alongside the text prompt. Provider support varies:
- **Gemini:** Supports via inlineData in generateContent API
- **OpenAI:** Supports via multipart form upload to images/edits endpoint
- **Custom:** Depends on user-provided generator implementation

If omitted, the component behaves as before (text-only generation).

Example:
```html
<ai-img
  endpoint="/api/generate"
  prompt="turn this into a sunset"
  input-image="https://example.com/reference.jpg"
  llm="gemini"
  ratio="16:9"
></ai-img>
```

Accepts HTTPS URLs or data URIs (e.g., `data:image/jpeg;base64,...`). URLs must be CORS-accessible from the browser or host.
```

### DESIGN.md
Add section under "Design Decisions":

```markdown
## Reference Image Support

The web component supports optional reference image input for image-to-image generation. This is implemented as a **pure additive extension** with no breaking changes:

### Transport Layer
- **Component → Endpoint:** URL string (HTTPS or data URI)
- **Endpoint → Server:** JSON field (optional, omitted when undefined)
- **Server → Provider:** Provider-specific translation
  - Gemini: base64 inlineData in parts array
  - OpenAI: Blob in multipart/form-data (switches to images/edits endpoint)
  - Custom: Forwarded as-is in CustomGenerateRequest

### Backwards Compatibility
All fields are optional and default to `undefined`, so:
- Existing users see no behavior change
- Old hosts ignore unknown JSON fields
- Adapters check for presence before using reference images

### Provider Capability Validation
No explicit capability validation is required because:
- Gemini accepts arbitrary inlineData objects (the model decides relevance)
- OpenAI endpoint switching is automatic in the adapter
- Custom generators are user-controlled and self-validating

Future enhancements could add `isReferenceImageSupported()` checks for early client-side validation if needed.
```

---

## Summary

This plan adds reference image support to `wc-img-ai` through **minimal, non-breaking changes** to the existing three-layer architecture:

1. **Component layer:** Add optional `input-image` attribute
2. **Transport layer:** Add optional `referenceImage` field to request contracts
3. **Server layer:** Add optional field to options and translate to provider formats
4. **Provider adapters:** Implement provider-specific handling (Gemini `inlineData`, OpenAI multipart)

All changes are **additive** (optional fields) and **backwards compatible** (existing code paths unchanged). The implementation leverages existing architectural seams identified by the Understand Anything analysis.

**Estimated Effort:** 4-6 hours of implementation + 2-3 hours of testing and documentation
**Risk Level:** Low — isolated changes with no impact on existing behavior
**Dependencies:** None (uses only existing dependencies: `lit`, Node.js `fetch`)