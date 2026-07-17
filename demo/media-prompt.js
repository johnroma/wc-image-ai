const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

/** The demo accepts at most four reference images per generation. */
export const MAX_REFERENCE_IMAGES = 4
/** Each reference image may be at most 5 MiB. */
export const MAX_REFERENCE_FILE_BYTES = 5 * 1024 * 1024
/** All reference images together may be at most 10 MiB. */
export const MAX_REFERENCE_TOTAL_BYTES = 10 * 1024 * 1024
/** Prompt text may be at most 16 KiB after UTF-8 encoding. */
export const MAX_PROMPT_TEXT_BYTES = 16 * 1024
/** Keep structured prompt traversal bounded independently of the body limit. */
export const MAX_STRUCTURED_PROMPT_PARTS = 16
/** Reject unusually wide/tall references before invoking a browser decoder. */
export const MAX_REFERENCE_DIMENSION = 4096
/** Bound decoded work even when both dimensions are below the per-axis limit. */
export const MAX_REFERENCE_PIXELS = 12_000_000

/** @param {Uint8Array} bytes @param {number} offset */
const uint32be = (bytes, offset) =>
  bytes[offset] * 0x1000000 +
  bytes[offset + 1] * 0x10000 +
  bytes[offset + 2] * 0x100 +
  bytes[offset + 3]

/** @param {Uint8Array} bytes @param {number} offset */
const uint32le = (bytes, offset) =>
  bytes[offset] +
  bytes[offset + 1] * 0x100 +
  bytes[offset + 2] * 0x10000 +
  bytes[offset + 3] * 0x1000000

/** @param {Uint8Array} bytes */
const isPng = (bytes) => {
  if (bytes.length < 45) return false
  let offset = 8
  let sawHeader = false
  let sawImageData = false
  while (offset + 12 <= bytes.length) {
    const length = uint32be(bytes, offset)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    const end = offset + 12 + length
    if (end > bytes.length) return false
    if (!sawHeader) {
      if (type !== 'IHDR' || length !== 13) return false
      sawHeader = true
    } else if (type === 'IDAT') {
      sawImageData = true
    } else if (type === 'IEND') {
      return length === 0 && sawImageData && end === bytes.length
    }
    offset = end
  }
  return false
}

/** @param {Uint8Array} bytes */
const isJpeg = (bytes) => {
  if (
    bytes.length < 12 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes.at(-2) !== 0xff ||
    bytes.at(-1) !== 0xd9
  ) {
    return false
  }

  let offset = 2
  let sawFrame = false
  while (offset + 1 < bytes.length - 2) {
    if (bytes[offset] !== 0xff) return false
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset++]
    if (marker === 0xda) return sawFrame
    if (marker === 0xd9 || marker === 0xd8 || offset + 2 > bytes.length) {
      return false
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    const length = bytes[offset] * 0x100 + bytes[offset + 1]
    if (length < 2 || offset + length > bytes.length - 2) return false
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      sawFrame = length >= 8
    }
    offset += length
  }
  return false
}

/** @param {Uint8Array} bytes */
const isWebp = (bytes) => {
  if (bytes.length < 20 || uint32le(bytes, 4) !== bytes.length - 8) return false
  let offset = 12
  let sawImageChunk = false
  while (offset + 8 <= bytes.length) {
    const type = String.fromCharCode(...bytes.subarray(offset, offset + 4))
    const length = uint32le(bytes, offset + 4)
    const end = offset + 8 + length
    if (end > bytes.length) return false
    if (type === 'VP8 ' || type === 'VP8L' || type === 'VP8X') {
      sawImageChunk = true
    }
    offset = end + (length % 2)
  }
  return sawImageChunk && offset === bytes.length
}

/** @param {Uint8Array} bytes */
export const detectImageMimeType = (bytes) => {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a &&
    isPng(bytes)
  ) {
    return 'image/png'
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    isJpeg(bytes)
  ) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50 &&
    isWebp(bytes)
  ) {
    return 'image/webp'
  }
  return null
}

/** @param {Uint8Array} bytes @param {string} mimeType */
export const inspectImageDimensions = (bytes, mimeType) => {
  if (mimeType === 'image/png') {
    return { width: uint32be(bytes, 16), height: uint32be(bytes, 20) }
  }

  if (mimeType === 'image/jpeg') {
    let offset = 2
    while (offset + 8 < bytes.length) {
      while (bytes[offset] === 0xff) offset += 1
      const marker = bytes[offset++]
      if (marker === 0xda || marker === 0xd9) break
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
      const length = bytes[offset] * 0x100 + bytes[offset + 1]
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        return {
          width: bytes[offset + 5] * 0x100 + bytes[offset + 6],
          height: bytes[offset + 3] * 0x100 + bytes[offset + 4],
        }
      }
      offset += length
    }
  }

  if (mimeType === 'image/webp') {
    let offset = 12
    while (offset + 8 <= bytes.length) {
      const type = String.fromCharCode(...bytes.subarray(offset, offset + 4))
      const length = uint32le(bytes, offset + 4)
      const data = offset + 8
      if (type === 'VP8X' && length >= 10) {
        return {
          width:
            1 +
            bytes[data + 4] +
            bytes[data + 5] * 0x100 +
            bytes[data + 6] * 0x10000,
          height:
            1 +
            bytes[data + 7] +
            bytes[data + 8] * 0x100 +
            bytes[data + 9] * 0x10000,
        }
      }
      if (
        type === 'VP8 ' &&
        length >= 10 &&
        bytes[data + 3] === 0x9d &&
        bytes[data + 4] === 0x01 &&
        bytes[data + 5] === 0x2a
      ) {
        return {
          width: (bytes[data + 6] + bytes[data + 7] * 0x100) & 0x3fff,
          height: (bytes[data + 8] + bytes[data + 9] * 0x100) & 0x3fff,
        }
      }
      if (type === 'VP8L' && length >= 5 && bytes[data] === 0x2f) {
        const bits = uint32le(bytes, data + 1)
        return {
          width: 1 + (bits & 0x3fff),
          height: 1 + ((bits >>> 14) & 0x3fff),
        }
      }
      offset += 8 + length + (length % 2)
    }
  }

  return null
}

/** @param {ArrayBuffer} buffer */
const arrayBufferToBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }

  return btoa(binary)
}

/**
 * Convert a browser File into the data-backed image part TanStack AI expects.
 * Limits are checked for the complete selection by createMediaPrompt first.
 *
 * @param {File} file
 */
export const fileToImagePart = async (file) => {
  if (file.type.startsWith('image/') && !SUPPORTED_IMAGE_TYPES.has(file.type)) {
    throw new TypeError(
      `Unsupported reference image type: ${file.type || 'unknown'}`,
    )
  }

  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const mimeType = detectImageMimeType(bytes)
  if (!mimeType) {
    throw new TypeError(
      `Reference image ${file.name || 'file'} does not contain a valid PNG, JPEG, or WebP image`,
    )
  }
  const dimensions = inspectImageDimensions(bytes, mimeType)
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) {
    throw new TypeError(
      `Reference image ${file.name || 'file'} has invalid dimensions`,
    )
  }
  if (
    dimensions.width > MAX_REFERENCE_DIMENSION ||
    dimensions.height > MAX_REFERENCE_DIMENSION
  ) {
    throw new RangeError(
      `Reference image dimensions must not exceed ${MAX_REFERENCE_DIMENSION}px`,
    )
  }
  if (dimensions.width * dimensions.height > MAX_REFERENCE_PIXELS) {
    throw new RangeError(
      `Reference images must not exceed ${MAX_REFERENCE_PIXELS.toLocaleString('en-US')} pixels`,
    )
  }

  if (typeof globalThis.createImageBitmap === 'function') {
    try {
      const bitmap = await globalThis.createImageBitmap(file)
      bitmap.close()
    } catch {
      throw new TypeError(
        `Reference image ${file.name || 'file'} does not contain a valid PNG, JPEG, or WebP image`,
      )
    }
  }

  return {
    type: 'image',
    source: {
      type: 'data',
      value: arrayBufferToBase64(buffer),
      mimeType,
    },
  }
}

/**
 * Keep the text-only path simple, but switch to TanStack AI's MediaPrompt shape
 * when the user supplies one or more ordered reference images.
 *
 * @param {string} text
 * @param {Iterable<File>} selectedFiles
 * @returns {Promise<string | Array<object>>}
 */
export const createMediaPrompt = async (text, selectedFiles) => {
  if (!text.trim()) throw new TypeError('Prompt must not be empty.')
  if (new TextEncoder().encode(text).byteLength > MAX_PROMPT_TEXT_BYTES) {
    throw new RangeError('Prompt text must be 16 KiB or smaller.')
  }

  const files = Array.from(selectedFiles)
  if (files.length === 0) return text
  if (files.length > MAX_REFERENCE_IMAGES) {
    throw new RangeError(
      `Select at most ${MAX_REFERENCE_IMAGES} reference images.`,
    )
  }
  if (files.some((file) => file.size > MAX_REFERENCE_FILE_BYTES)) {
    throw new RangeError('Reference images must each be 5 MiB or smaller.')
  }
  if (
    files.reduce((total, file) => total + file.size, 0) >
    MAX_REFERENCE_TOTAL_BYTES
  ) {
    throw new RangeError('Reference images must total 10 MiB or less.')
  }

  const parts = [{ type: 'text', content: text }]
  for (const file of files) parts.push(await fileToImagePart(file))
  return parts
}

/**
 * Own the demo's generation lifecycle so only the active element can settle it.
 *
 * @param {{
 *   button: { disabled: boolean, setAttribute: (name: string, value: string) => void },
 *   status: { textContent: string | null },
 *   stage: { replaceChildren: (image: any) => void },
 *   createImage: () => EventTarget & Record<string, any>
 * }} controls
 */
export const createGenerationFlow = ({
  button,
  status,
  stage,
  createImage,
}) => {
  let generation = 0

  /** @param {boolean} busy */
  const setBusy = (busy) => {
    button.disabled = busy
    button.setAttribute('aria-busy', String(busy))
  }

  /** @param {string} prompt @param {Iterable<File>} files */
  return async (prompt, files) => {
    if (button.disabled) return

    const token = ++generation
    setBusy(true)
    status.textContent = 'Generating image…'

    try {
      const mediaPrompt = await createMediaPrompt(prompt, files)
      if (token !== generation) return

      const image = createImage()
      const description = prompt.trim().replace(/\s+/g, ' ').slice(0, 120)
      image.alt = `AI-generated image: ${description}`
      image.endpoint = '/api/img'
      image.prompt = mediaPrompt
      image.width = 256
      image.height = 256
      image.fallback = 'https://placehold.co/256x256?text=fallback'
      let settled = false

      const settle = (text) => {
        if (token !== generation || settled) return
        settled = true
        status.textContent = text
        setBusy(false)
      }
      image.addEventListener('ai-image', (event) => {
        const { id, url } = event.detail ?? {}
        let detail = 'Image generated.'
        try {
          if (id || url) detail = JSON.stringify({ id, url }, null, 2)
        } catch {
          // Keep lifecycle settlement independent from optional status formatting.
        }
        settle(detail)
      })
      image.addEventListener('ai-image-error', (event) => {
        settle(event.detail?.message || 'Image generation failed.')
      })
      stage.replaceChildren(image)
    } catch (error) {
      if (token !== generation) return
      status.textContent =
        error instanceof Error ? error.message : String(error)
      setBusy(false)
    }
  }
}
