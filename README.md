# AI based img-tags

By simply providing an src to an api that does the AI for you, and you can simply get ai-rendered images anywhere you need based on the alt-attribute.

```html
<img
  is="ai-image"
  src="/api/myimage"
  alt="a sleeping little kitten"
  data-fallback="https://placekitten.com/12/12"
/>
```

## installation

```bash
pnpm i wc-img-ai
```

```html
<script type="module">
  import "wc-img-ai"
</script>
```

The api server itself needs to receive this body and return a string with the url of the image

### Function: POST

This function sends a request to the an API to generate an image based on a given prompt.

#### Request Body Format

- **prompt** (string): The description or prompt based on which the image will be generated.
- **width** (number): The width of the desired image in pixels.
- **height** (number): The height of the desired image in pixels.

#### Example Request Body

```json
{
  "prompt": "a sleeping little kitten",
  "width": 300,
  "height": 300
}
```

#### Return

it is expected to return a simple string

```json
"https://example.com/path/to/generated/image.jpg"
```
