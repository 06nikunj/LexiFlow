export const runtime = "nodejs"

import { embeddings } from "../../lib/embeddings"
import { supabase } from "../../lib/supabase"
import Groq from "groq-sdk"

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

export async function POST(req: Request) {
  try {
    const { question, selectedDocs } = await req.json()
    const queryVector = await embeddings.embedQuery(question)

    const { data, error } = await supabase.rpc("match_documents", {
      query_embedding: queryVector,
      match_threshold: 0.3,
      match_count: 8
    })

    if (error) throw new Error("Supabase error: " + error.message)

    // Filter by selected docs if specified
    const filtered = selectedDocs?.length
      ? data?.filter((doc: any) => selectedDocs.includes(doc.metadata?.docId))
      : data

    const sources = filtered?.map((doc: any) => ({
      content: doc.content,
      source: doc.metadata?.source || "Unknown",
      docId: doc.metadata?.docId,
      similarity: Math.round(doc.similarity * 100)
    })) || []

    const context = sources.map((s: any) => `[From: ${s.source}]\n${s.content}`).join("\n\n")

    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: "Answer the question using only the provided context. Always mention which document the information comes from." },
        { role: "user", content: `Context:\n${context}\n\nQuestion: ${question}` }
      ],
      model: "llama-3.3-70b-versatile"
    })

    return Response.json({ answer: completion.choices[0].message.content, sources })
  } catch (error: any) {
    console.error("CHAT ERROR:", error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}