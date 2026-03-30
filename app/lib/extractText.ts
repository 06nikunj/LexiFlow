export async function extractTextFromPDF(buffer: Buffer): Promise<{ text: string; usedOCR: boolean }> {
  const pdfParse = require("pdf-parse")

  try {
    const pdfData = await pdfParse(buffer)
    const text = pdfData.text?.trim() || ""

    // If we got enough text, use it directly
    if (text.length > 100) {
      return { text, usedOCR: false }
    }

    // Scanned PDF — return helpful message instead of crashing
    return {
      text: "This appears to be a scanned PDF. Text extraction was limited. Please try a text-based PDF for best results.",
      usedOCR: false
    }
  } catch (error) {
    throw new Error("Failed to read PDF file.")
  }
}