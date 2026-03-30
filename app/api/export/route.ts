export const runtime = "nodejs"

import Groq from "groq-sdk"

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

export async function POST(req: Request) {
  try {
    const { messages, docNames } = await req.json()

    const qaText = messages
      .filter((m: any) => m.role === "user")
      .map((m: any, i: number) => {
        const answer = messages[i * 2 + 1]
        return `Q: ${m.content}\nA: ${answer?.content || "No answer"}`
      }).join("\n\n")

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "Generate a clean professional markdown report from these Q&A exchanges. Include a title, summary section, and all Q&A pairs formatted nicely."
        },
        {
          role: "user",
          content: `Documents: ${docNames.join(", ")}\n\nQ&A Session:\n${qaText}`
        }
      ],
      model: "llama-3.3-70b-versatile"
    })

    return Response.json({ report: completion.choices[0].message.content })
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 })
  }
}