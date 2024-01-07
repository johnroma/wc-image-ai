# AI based img-tags

By simply providing a src to an api that does the AI for you, and you can simply get ai-rendered images anywhere you need based on the prompt-attribute.

```html
<ai-img
  src="http://localhost:4321/api/openai/img"
  width="256"
  height="256"
  prompt="funny dolphin up to no good"
  fallback="https://placekitten.com/200/300"
></ai-img>
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

The web-component sends a POST request to the API to generate an image and expects an image in return.

#### Request Body Format

- **prompt** (string): The description or prompt based on which the image will be generated.
- **width** (number): The width of the desired image in pixels.
- **height** (number): The height of the desired image in pixels.

#### Example Request Body

```json
{
  "prompt": "a sleeping little kitten",
  "width": 256,
  "height": 256
}
```

#### Server Return

it is expected to return a simple string

```json
"https://example.com/path/to/generated/image.jpg"
```

#### Demo

Check it out [running](https://john.ro/lab/img-ai) inside an MDX/Astro framework
