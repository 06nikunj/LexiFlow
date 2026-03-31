export function chunkText(text: string, chunkSize = 800, overlap = 150): string[] {
  const sentences = text.match(/[^.!?]+[.!?\n]+/g) || [text]
  const chunks: string[] = []
  let current = ""

  for (const sentence of sentences) {
    if ((current + sentence).length > chunkSize && current.length > 0) {
      chunks.push(current.trim())
      current = current.slice(-overlap) + sentence
    } else {
      current += sentence
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks
}