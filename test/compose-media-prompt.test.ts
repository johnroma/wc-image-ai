import type { ImagePart } from '@tanstack/ai'
import { describe, expect, it } from 'vitest'
import { composeMediaPrompt, referenceToImagePart } from '../src/ai-img'

const pngDataUrl = 'data:image/png;base64,iVBORw0KGgo='
const jpegDataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

describe('referenceToImagePart', () => {
  it('passes ImagePart objects through untouched', () => {
    const part: ImagePart = {
      type: 'image',
      source: { type: 'data', value: 'aGVsbG8=', mimeType: 'image/webp' },
    }
    expect(referenceToImagePart(part)).toBe(part)
  })

  it('decodes data URLs into inline data sources', () => {
    expect(referenceToImagePart(pngDataUrl)).toEqual({
      type: 'image',
      source: { type: 'data', value: 'iVBORw0KGgo=', mimeType: 'image/png' },
    })
    expect(referenceToImagePart(jpegDataUrl)).toEqual({
      type: 'image',
      source: {
        type: 'data',
        value: '/9j/4AAQSkZJRg==',
        mimeType: 'image/jpeg',
      },
    })
  })

  it('defaults the data URL mime type to image/png', () => {
    expect(referenceToImagePart('data:;base64,aGk=')).toEqual({
      type: 'image',
      source: { type: 'data', value: 'aGk=', mimeType: 'image/png' },
    })
  })

  it('treats plain URLs as url sources', () => {
    expect(referenceToImagePart('https://example.com/cat.webp')).toEqual({
      type: 'image',
      source: { type: 'url', value: 'https://example.com/cat.webp' },
    })
  })
})

describe('composeMediaPrompt', () => {
  it('returns the prompt unchanged when there are no references', () => {
    expect(composeMediaPrompt('a lighthouse', [])).toBe('a lighthouse')
    const parts = [{ type: 'text' as const, content: 'kept' }]
    expect(composeMediaPrompt(parts, [])).toBe(parts)
  })

  it('blends a text instruction with ordered references', () => {
    expect(
      composeMediaPrompt('blend these', [pngDataUrl, jpegDataUrl]),
    ).toEqual([
      { type: 'text', content: 'blend these' },
      {
        type: 'image',
        source: { type: 'data', value: 'iVBORw0KGgo=', mimeType: 'image/png' },
      },
      {
        type: 'image',
        source: {
          type: 'data',
          value: '/9j/4AAQSkZJRg==',
          mimeType: 'image/jpeg',
        },
      },
    ])
  })

  it('keeps already-structured prompt parts and appends references', () => {
    const base = [{ type: 'text' as const, content: 'merge into this' }]
    expect(composeMediaPrompt(base, ['https://example.com/a.png'])).toEqual([
      { type: 'text', content: 'merge into this' },
      {
        type: 'image',
        source: { type: 'url', value: 'https://example.com/a.png' },
      },
    ])
  })

  it('omits the text part for blank prompts', () => {
    expect(composeMediaPrompt('   ', [pngDataUrl])).toEqual([
      {
        type: 'image',
        source: { type: 'data', value: 'iVBORw0KGgo=', mimeType: 'image/png' },
      },
    ])
    expect(composeMediaPrompt('', [pngDataUrl])).toHaveLength(1)
  })
})
