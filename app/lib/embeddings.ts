export const embeddings = {
  async embedQuery(text: string): Promise<number[]> {
    const response = await fetch(
      "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.HF_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inputs: text }),
      }
    )
    const data = await response.json()
    if (!Array.isArray(data)) throw new Error(JSON.stringify(data))
    return data
  }
}