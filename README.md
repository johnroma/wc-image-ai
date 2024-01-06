# AI based img-tags

By simply providing an src to an api that does the AI for you, and you can simply get ai-rendered images anywhere you need based on the alt-attribute.

## Browser Compatibility Note

As of the current state of browser implementations, there are known limitations in Safari when extending native HTML elements, such as `<img>`, using Web Components. This may affect the functionality of AI-based img-tags in Safari. For more details, see the related [WebKit bug report](https://bugs.webkit.org/show_bug.cgi?id=182671).

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

#### Server Return

it is expected to return a simple string

```json
"https://example.com/path/to/generated/image.jpg"
```

#### Demo

Check it out [running](https://john.ro/lab/img-ai) inside an MDX/Astro framework
