export function chunkText(text: string, chunkSize = 500, overlap = 50): string[] {
  // Split on sentence boundaries first
  const sentences = text.match(/[^.!?]+[.!?\n]+/g) || [text]
  const chunks: string[] = []
  let current = ""

  for (const sentence of sentences) {
    if ((current + sentence).length > chunkSize && current.length > 0) {
      chunks.push(current.trim())
      // Keep last `overlap` chars for context continuity
      current = current.slice(-overlap) + sentence
    } else {
      current += sentence
    }
  }

  if (current.trim()) chunks.push(current.trim())
  return chunks
}