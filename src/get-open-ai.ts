export const getOpenAi = async (
  endpoint: string,
  prompt: string,
  width: number,
  height: number
) => {
  //let response = "https://placekitten.com/256/256"
  let response
  console.log("getOpenAi", endpoint, prompt, width, height)
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
