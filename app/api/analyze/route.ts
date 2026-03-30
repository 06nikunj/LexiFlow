export const runtime = "nodejs"

import Groq from "groq-sdk"

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

export async function POST(req: Request) {
  try {
    const { text } = await req.json()

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are a document analyzer. Given document text, respond ONLY with a valid JSON object in this exact format with no extra text:
{
  "summary": "3 sentence summary of the document",
  "questions": ["question 1", "question 2", "question 3", "question 4", "question 5"],
  "topic": "main topic in 3 words"
}`
        },
        {
          role: "user",
          content: `Analyze this document and return JSON only:\n\n${text.slice(0, 3000)}`
        }
      ],
      model: "llama-3.3-70b-versatile"
    })

    const raw = completion.choices[0].message.content || "{}"
    const clean = raw.replace(/```json|```/g, "").trim()
    const data = JSON.parse(clean)

    return Response.json(data)
  } catch (error: any) {
    console.error("ANALYZE ERROR:", error)
    return Response.json({
      summary: "Could not generate summary.",
      questions: [],
      topic: "Unknown"
    })
  }
}