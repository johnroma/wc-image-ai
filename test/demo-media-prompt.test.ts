import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createGenerationFlow,
  createMediaPrompt,
  MAX_PROMPT_TEXT_BYTES,
  MAX_REFERENCE_DIMENSION,
  MAX_REFERENCE_FILE_BYTES,
  MAX_REFERENCE_IMAGES,
  MAX_REFERENCE_TOTAL_BYTES,
} from '../demo/media-prompt.js'

const PNG_HEADER = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const WEBP_HEADER = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80])
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
const JPEG_BYTES = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKK+ZP3E//Z',
  'base64',
)
const WEBP_BYTES = Buffer.from(
  'UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoBAAEAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=',
  'base64',
)

afterEach(() => vi.unstubAllGlobals())

describe('demo media prompt', () => {
  it('keeps text first and appends each selected image in order', async () => {
    const files = [
      new File([PNG_BYTES], 'structure.png', {
        type: 'image/png',
      }),
      new File([WEBP_BYTES], 'palette.webp', {
        type: 'image/webp',
      }),
    ]

    await expect(
      createMediaPrompt('Restyle this image.', files),
    ).resolves.toEqual([
      { type: 'text', content: 'Restyle this image.' },
      {
        type: 'image',
        source: {
          type: 'data',
          value: PNG_BYTES.toString('base64'),
          mimeType: 'image/png',
        },
      },
      {
        type: 'image',
        source: {
          type: 'data',
          value: WEBP_BYTES.toString('base64'),
          mimeType: 'image/webp',
        },
      },
    ])
  })

  it('reads and decodes selected images sequentially while preserving bytes', async () => {
    let activeDecodes = 0
    let maximumActiveDecodes = 0
    const decodeOrder: Array<string> = []
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async (file: File) => {
        activeDecodes += 1
        maximumActiveDecodes = Math.max(maximumActiveDecodes, activeDecodes)
        decodeOrder.push(file.name)
        await new Promise((resolve) => setTimeout(resolve, 0))
        activeDecodes -= 1
        return { close: vi.fn() }
      }),
    )
    const files = [
      new File([PNG_BYTES], 'first.png', { type: 'image/png' }),
      new File([JPEG_BYTES], 'second.jpg', { type: 'image/jpeg' }),
      new File([WEBP_BYTES], 'third.webp', { type: 'image/webp' }),
    ]

    const result = await createMediaPrompt('Keep their order.', files)

    expect(maximumActiveDecodes).toBe(1)
    expect(decodeOrder).toEqual(files.map((file) => file.name))
    expect(
      result
        .slice(1)
        .map((part) => (part.type === 'image' ? part.source.value : null)),
    ).toEqual(
      [PNG_BYTES, JPEG_BYTES, WEBP_BYTES].map((bytes) =>
        bytes.toString('base64'),
      ),
    )
  })

  it.each([
    [
      'PNG',
      (() => {
        const bytes = Buffer.from(PNG_BYTES)
        bytes.writeUInt32BE(MAX_REFERENCE_DIMENSION + 1, 16)
        return bytes
      })(),
    ],
    [
      'JPEG',
      (() => {
        const bytes = Buffer.from(JPEG_BYTES)
        const frame = bytes.indexOf(Buffer.from([0xff, 0xc0]))
        bytes.writeUInt16BE(MAX_REFERENCE_DIMENSION + 1, frame + 7)
        return bytes
      })(),
    ],
    [
      'WebP',
      (() => {
        const bytes = Buffer.from(WEBP_BYTES)
        const chunk = bytes.indexOf(Buffer.from('VP8 '))
        bytes.writeUInt16LE(MAX_REFERENCE_DIMENSION + 1, chunk + 14)
        return bytes
      })(),
    ],
  ])('rejects excessive %s dimensions before browser decode', async (_type, bytes) => {
    const createImageBitmap = vi.fn()
    vi.stubGlobal('createImageBitmap', createImageBitmap)
    const file = new File([bytes], 'oversized-image', {
      type: 'application/octet-stream',
    })

    await expect(createMediaPrompt('Inspect safely.', [file])).rejects.toThrow(
      `dimensions must not exceed ${MAX_REFERENCE_DIMENSION}px`,
    )
    expect(createImageBitmap).not.toHaveBeenCalled()
  })

  it('uses the plain string prompt when no reference image is selected', async () => {
    await expect(createMediaPrompt('Draw a rocket.', [])).resolves.toBe(
      'Draw a rocket.',
    )
  })

  it('rejects unsupported reference image types', async () => {
    const file = new File(['<svg/>'], 'reference.svg', {
      type: 'image/svg+xml',
    })

    await expect(createMediaPrompt('Restyle it.', [file])).rejects.toThrow(
      'Unsupported reference image type: image/svg+xml',
    )
  })

  it('uses the byte signature instead of trusting the declared MIME type', async () => {
    const disguisedText = new File(['not a png'], 'fake.png', {
      type: 'image/png',
    })
    const jpeg = new File([JPEG_BYTES], 'photo.bin', {
      type: 'application/octet-stream',
    })

    await expect(
      createMediaPrompt('Restyle it.', [disguisedText]),
    ).rejects.toThrow('does not contain a valid PNG, JPEG, or WebP image')
    await expect(
      createMediaPrompt('Restyle it.', [jpeg]),
    ).resolves.toMatchObject([
      { type: 'text' },
      { source: { mimeType: 'image/jpeg' } },
    ])
  })

  it('rejects truncated images that only contain a recognized prefix', async () => {
    const files = [
      new File([PNG_HEADER], 'truncated.png', { type: 'image/png' }),
      new File([new Uint8Array([255, 216, 255, 224])], 'truncated.jpg', {
        type: 'image/jpeg',
      }),
      new File([WEBP_HEADER], 'truncated.webp', { type: 'image/webp' }),
    ]

    for (const file of files) {
      await expect(createMediaPrompt('Restyle it.', [file])).rejects.toThrow(
        'does not contain a valid PNG, JPEG, or WebP image',
      )
    }
  })

  it('rejects files that the browser image decoder cannot decode', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockRejectedValue(new Error('bad image')),
    )
    const structurallyPlausible = new File([PNG_BYTES], 'corrupt.png', {
      type: 'image/png',
    })

    await expect(
      createMediaPrompt('Restyle it.', [structurallyPlausible]),
    ).rejects.toThrow('does not contain a valid PNG, JPEG, or WebP image')
  })

  it('requires bounded non-empty prompt text before reading files', async () => {
    await expect(createMediaPrompt('   ', [])).rejects.toThrow(
      'Prompt must not be empty',
    )
    await expect(
      createMediaPrompt('x'.repeat(MAX_PROMPT_TEXT_BYTES + 1), []),
    ).rejects.toThrow('Prompt text must be 16 KiB or smaller')
  })

  it('surfaces asynchronous file-read failures', async () => {
    const unreadable = {
      size: PNG_HEADER.byteLength,
      type: 'image/png',
      name: 'unreadable.png',
      arrayBuffer: () => Promise.reject(new Error('file read failed')),
    } as unknown as File

    await expect(
      createMediaPrompt('Restyle it.', [unreadable]),
    ).rejects.toThrow('file read failed')
  })

  it('rejects count, per-file, and aggregate limits before reading file bytes', async () => {
    const unread = (size: number) =>
      ({
        size,
        type: 'image/png',
        name: 'reference.png',
        arrayBuffer: () => {
          throw new Error('must not read oversized files')
        },
        slice: () => {
          throw new Error('must not read oversized files')
        },
      }) as unknown as File

    await expect(
      createMediaPrompt(
        'Too many.',
        Array.from({ length: MAX_REFERENCE_IMAGES + 1 }, () => unread(1)),
      ),
    ).rejects.toThrow(`at most ${MAX_REFERENCE_IMAGES}`)
    await expect(
      createMediaPrompt('Too large.', [unread(MAX_REFERENCE_FILE_BYTES + 1)]),
    ).rejects.toThrow('each be 5 MiB or smaller')
    await expect(
      createMediaPrompt('Too large together.', [
        unread(MAX_REFERENCE_FILE_BYTES),
        unread(MAX_REFERENCE_FILE_BYTES),
        unread(MAX_REFERENCE_TOTAL_BYTES - 2 * MAX_REFERENCE_FILE_BYTES + 1),
      ]),
    ).rejects.toThrow('total 10 MiB or less')
  })

  it('keeps the active generation busy and ignores stale detached events', async () => {
    class FakeImage extends EventTarget {
      endpoint = ''
      prompt: unknown
      width = 0
      height = 0
      fallback = ''
    }
    const images: Array<FakeImage> = []
    const button = { disabled: false, setAttribute: vi.fn() }
    const status = { textContent: '—' }
    const stage = {
      current: undefined as FakeImage | undefined,
      replaceChildren(image: FakeImage) {
        this.current = image
      },
    }
    const generate = createGenerationFlow({
      button,
      status,
      stage,
      createImage: () => {
        const image = new FakeImage()
        images.push(image)
        return image
      },
    })

    await generate('first', [])
    expect(button.disabled).toBe(true)
    expect(button.setAttribute).toHaveBeenLastCalledWith('aria-busy', 'true')
    await generate('overlapping', [])
    expect(images).toHaveLength(1)
    images[0].dispatchEvent(
      new CustomEvent('ai-image', { detail: { id: 'first' } }),
    )
    expect(button.disabled).toBe(false)
    expect(button.setAttribute).toHaveBeenLastCalledWith('aria-busy', 'false')

    await generate('second', [])
    images[0].dispatchEvent(
      new CustomEvent('ai-image-error', {
        detail: { message: 'stale failure' },
      }),
    )
    expect(status.textContent).not.toContain('stale failure')
    expect(button.disabled).toBe(true)
    expect(button.setAttribute).toHaveBeenLastCalledWith('aria-busy', 'true')

    images[1].dispatchEvent(
      new CustomEvent('ai-image', { detail: { id: 'second' } }),
    )
    expect(status.textContent).toContain('second')
    expect(button.disabled).toBe(false)
    expect(button.setAttribute).toHaveBeenLastCalledWith('aria-busy', 'false')
  })

  it('always settles when success event details cannot be serialized', async () => {
    class FakeImage extends EventTarget {}
    const image = new FakeImage()
    const button = { disabled: false, setAttribute: vi.fn() }
    const status = { textContent: '—' }
    const generate = createGenerationFlow({
      button,
      status,
      stage: { replaceChildren: () => undefined },
      createImage: () => image,
    })

    await generate('Draw it.', [])
    image.dispatchEvent(
      new CustomEvent('ai-image', { detail: { id: 1n, url: '/image.png' } }),
    )

    expect(button.disabled).toBe(false)
    expect(button.setAttribute).toHaveBeenLastCalledWith('aria-busy', 'false')
    expect(status.textContent).toContain('Image generated')
  })

  it('renders only compact success fields instead of prompt or blob payloads', async () => {
    class FakeImage extends EventTarget {}
    const image = new FakeImage()
    const button = { disabled: false, setAttribute: vi.fn() }
    const status = { textContent: '—' }
    const generate = createGenerationFlow({
      button,
      status,
      stage: { replaceChildren: () => undefined },
      createImage: () => image,
    })

    await generate('Restyle it.', [])
    image.dispatchEvent(
      new CustomEvent('ai-image', {
        detail: {
          id: 'generated-id',
          url: '/images/generated-id.png',
          prompt: 'x'.repeat(14 * 1024 * 1024),
          blob: new Blob(['binary payload']),
        },
      }),
    )

    expect(status.textContent).toBe(
      JSON.stringify(
        { id: 'generated-id', url: '/images/generated-id.png' },
        null,
        2,
      ),
    )
    expect(status.textContent).not.toContain('prompt')
    expect(status.textContent).not.toContain('blob')
  })

  it('sets a bounded prompt-derived alt description without image data', async () => {
    class FakeImage extends EventTarget {
      alt = ''
    }
    const image = new FakeImage()
    const button = { disabled: false, setAttribute: vi.fn() }
    const generate = createGenerationFlow({
      button,
      status: { textContent: '—' },
      stage: { replaceChildren: () => undefined },
      createImage: () => image,
    })
    const prompt = `  A   luminous whale ${'above clouds '.repeat(30)}  `

    await generate(prompt, [new File([PNG_BYTES], 'secret.png')])

    expect(image.alt).toMatch(
      /^AI-generated image: A luminous whale above clouds/,
    )
    expect(image.alt.length).toBeLessThanOrEqual(140)
    expect(image.alt).not.toContain(PNG_BYTES.toString('base64'))
  })
})
