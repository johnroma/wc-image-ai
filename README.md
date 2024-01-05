# AI based img-tags

By simply providing an src to an api that does the AI for you, and you can simply get ai-rendered images anywhere you need based on the alt-attribute.

```html
<script
  type="module"
  src="/src/ai-image.ts"
></script>

<img
  is="ai-image"
  src="/api/openai"
  alt="a sleeping little kitten"
  data-fallback="https://placekitten.com/12/12"
/>
```
