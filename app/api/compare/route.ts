export const runtime = "nodejs"

import { embeddings } from "../../lib/embeddings"
import { supabase } from "../../lib/supabase"
import Groq from "groq-sdk"

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

export async function POST(req: Request) {
  try {
    const { question, docIds } = await req.json()

    // Get chunks from each doc separately
    const docChunks: Record<string, string[]> = {}

    for (const docId of docIds) {
      const queryVector = await embeddings.embedQuery(question)
      const { data } = await supabase.rpc("match_documents", {
        query_embedding: queryVector,
        match_threshold: 0.3,
        match_count: 4
      })
      const filtered = data?.filter((d: any) => d.metadata?.docId === docId) || []
      docChunks[docId] = filtered.map((d: any) => `[${d.metadata?.source}]: ${d.content}`)
    }

    const contextBlocks = Object.entries(docChunks)
      .map(([, chunks]) => chunks.join("\n"))
      .join("\n\n---\n\n")

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are a document comparison expert. Compare the documents and respond ONLY with valid JSON in this exact format:
{
  "similarities": ["point 1", "point 2", "point 3"],
  "differences": ["point 1", "point 2", "point 3"],
  "unique_to_first": ["point 1", "point 2"],
  "unique_to_second": ["point 1", "point 2"],
  "verdict": "2 sentence overall comparison summary"
}`
        },
        {
          role: "user",
          content: `Compare these documents on: "${question}"\n\n${contextBlocks}`
        }
      ],
      model: "llama-3.3-70b-versatile"
    })

    const raw = completion.choices[0].message.content || "{}"
    const clean = raw.replace(/```json|```/g, "").trim()
    const data = JSON.parse(clean)
    return Response.json(data)
  } catch (error: any) {
    console.error("COMPARE ERROR:", error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}