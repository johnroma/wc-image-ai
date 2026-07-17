import type { MediaPrompt } from '@tanstack/ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveImage } from '../src/get-generated-image'

describe('resolveImage multimodal requests', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('forwards a structured prompt and exact model to the endpoint', async () => {
    const prompt: MediaPrompt = [
      { type: 'text', content: 'Restyle the reference.' },
      {
        type: 'image',
        source: {
          type: 'data',
          value: 'cmVmZXJlbmNl',
          mimeType: 'image/png',
        },
      },
    ]
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ id: 'generated-id', url: '/images/generated.webp' }),
      )
    vi.stubGlobal('fetch', fetchMock)

    await resolveImage('/api/img/generate', {
      prompt,
      model: 'gpt-image-2',
      width: 1024,
      height: 1024,
    })

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body as string)).toMatchObject({
      prompt,
      model: 'gpt-image-2',
      width: 1024,
      height: 1024,
    })
  })
})
