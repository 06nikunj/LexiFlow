export const runtime = "nodejs"

import { chunkText } from "../../lib/chunkText"
import { embeddings } from "../../lib/embeddings"
import { supabase } from "../../lib/supabase"
import { extractTextFromPDF } from "../../lib/extractText"

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const file = formData.get("file") as File
    if (!file) return Response.json({ error: "No file uploaded" }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())

    const { text, usedOCR } = await extractTextFromPDF(buffer)

    if (!text || text.length < 50) {
      return Response.json({ error: "Could not extract text from this PDF. Try a clearer scan." }, { status: 400 })
    }

    const chunks = chunkText(text)
    const docId = `${file.name}-${Date.now()}`

    // Generate all embeddings first
    const vectors: any[] = []
    for (const chunk of chunks) {
      const vector = await embeddings.embedQuery(chunk)
      vectors.push({
        content: chunk,
        metadata: { source: file.name, docId, uploadedAt: new Date().toISOString(), usedOCR },
        embedding: vector
      })
    }

    // Batch insert in groups of 20 to avoid payload limits
    const batchSize = 20
    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize)
      const { error } = await supabase.from("documents").insert(batch)
      if (error) throw new Error(error.message)
    }

    return Response.json({
      message: "PDF stored successfully",
      chunksStored: chunks.length,
      docId,
      usedOCR,
      extractedText: text.slice(0, 3000)
    })
  } catch (error: any) {
    console.error("UPLOAD ERROR:", error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
