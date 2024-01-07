export const spinner = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><style>.a{animation:b .8s linear infinite;fill:#888}.c{animation-delay:-.65s}.d{animation-delay:-.5s}@keyframes b{93.75%,100%{r:3px}46.875%{r:.2px}}</style><circle class="a" cx="4" cy="12" r="3"/><circle class="a c" cx="12" cy="12" r="3"/><circle class="a d" cx="20" cy="12" r="3"/></svg>`

export const getGeneratedImage = async (
  endpoint: string,
  prompt: string,
  width: number,
  height: number
) => {
  //let response = "https://placekitten.com/256/256"
  let response

  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        width,
        height,
      }),
    })
    if (!r.ok) {
      throw new Error("Network response was not ok")
    }
    response = await r.text() // Use response.json() if expecting JSON
  } catch (error) {
    console.error("There has been a problem with your fetch operation:", error)
  }

  return response
}
