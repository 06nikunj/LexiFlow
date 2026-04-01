"use client"

import { useState, useRef, useEffect } from "react"

type Source = { content: string; source: string; docId: string; similarity: number }
type Message = { role: "user" | "assistant"; content: string; sources?: Source[] }
type DocFile = {
  name: string; docId: string; chunks: number; uploadedAt: string; selected: boolean
  summary?: string; questions?: string[]; topic?: string; analyzing?: boolean; usedOCR?: boolean
}
type CompareResult = {
  similarities: string[]; differences: string[]
  unique_to_first: string[]; unique_to_second: string[]; verdict: string
}

export default function LexiFlow() {
  const [messages, setMessages] = useState<Message[]>([])
  const [question, setQuestion] = useState("")
  const [loading, setLoading] = useState(false)
  const [docs, setDocs] = useState<DocFile[]>([])
  const [uploadStatus, setUploadStatus] = useState<"idle"|"uploading"|"success"|"error">("idle")
  const [uploadMessage, setUploadMessage] = useState("")
  const [dragging, setDragging] = useState(false)
  const [expandedSources, setExpandedSources] = useState<number[]>([])
  const [expandedDoc, setExpandedDoc] = useState<string|null>(null)
  const [activeTab, setActiveTab] = useState<"chat"|"compare"|"export"|"history">("chat")
  const [compareQuestion, setCompareQuestion] = useState("")
  const [compareResult, setCompareResult] = useState<CompareResult|null>(null)
  const [comparing, setComparing] = useState(false)
  const [exportReport, setExportReport] = useState("")
  const [exporting, setExporting] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }) }, [messages, loading])

  useEffect(() => {
    try {
      const saved = localStorage.getItem("lexiflow-messages")
      if (saved) setMessages(JSON.parse(saved))
      const savedDocs = localStorage.getItem("lexiflow-docs")
      if (savedDocs) setDocs(JSON.parse(savedDocs))
    } catch {}
  }, [])

  useEffect(() => {
    try {
      if (messages.length > 0) localStorage.setItem("lexiflow-messages", JSON.stringify(messages))
    } catch {}
  }, [messages])

  useEffect(() => {
    try {
      if (docs.length > 0) localStorage.setItem("lexiflow-docs", JSON.stringify(docs))
    } catch {}
  }, [docs])

  function getFriendlyError(err: any): string {
    const msg = err?.message || err?.toString() || ""
    if (msg.includes("fetch failed") || msg.includes("network")) return "Connection error. Please check your internet and try again."
    if (msg.includes("Supabase")) return "Database error. Please try again in a moment."
    if (msg.includes("quota") || msg.includes("rate limit")) return "Too many requests. Please wait a moment and try again."
    if (msg.includes("timeout")) return "Request timed out. Please try again."
    if (msg.includes("No file")) return "Please select a PDF file to upload."
    if (msg.includes("extract")) return "Could not read this PDF. Please try a text-based PDF."
    return "Something went wrong. Please try again."
  }

  async function handleUpload(file: File) {
    if (!file) { setUploadStatus("error"); setUploadMessage("Please select a file."); return }
    if (file.type !== "application/pdf") { setUploadStatus("error"); setUploadMessage("Only PDF files are supported."); return }
    if (file.size > 10 * 1024 * 1024) { setUploadStatus("error"); setUploadMessage("File too large. Please use a PDF under 10MB."); return }

    setUploadStatus("uploading"); setUploadMessage("")
    const formData = new FormData()
    formData.append("file", file)
    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      const newDoc: DocFile = {
        name: file.name, docId: data.docId, chunks: data.chunksStored,
        uploadedAt: new Date().toLocaleTimeString(), selected: true, analyzing: true, usedOCR: data.usedOCR
      }
      setDocs((prev) => [...prev, newDoc])
      setUploadStatus("success")
      setUploadMessage(`${data.chunksStored} chunks indexed successfully!`)
      if (data.extractedText) {
        const analyzeRes = await fetch("/api/analyze", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: data.extractedText })
        })
        const analysis = await analyzeRes.json()
        setDocs((prev) => prev.map((d) =>
          d.docId === data.docId
            ? { ...d, summary: analysis.summary, questions: analysis.questions, topic: analysis.topic, analyzing: false }
            : d
        ))
        setExpandedDoc(data.docId)
      }
    } catch (err: any) {
      setUploadStatus("error"); setUploadMessage(getFriendlyError(err))
    }
  }

  function toggleDoc(docId: string) {
    setDocs((prev) => prev.map((d) => d.docId === docId ? { ...d, selected: !d.selected } : d))
  }

  function removeDoc(docId: string) {
    setDocs((prev) => prev.filter((d) => d.docId !== docId))
    if (expandedDoc === docId) setExpandedDoc(null)
  }

  function clearHistory() {
    setMessages([])
    try { localStorage.removeItem("lexiflow-messages") } catch {}
  }

  async function handleAsk(e: React.FormEvent) {
    e.preventDefault()
    if (!question.trim() || loading) return
    const userMsg: Message = { role: "user", content: question }
    setMessages((prev) => [...prev, userMsg])
    setQuestion("")
    setLoading(true)
    const selectedDocs = docs.filter((d) => d.selected).map((d) => d.docId)
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, selectedDocs }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMessages((prev) => [...prev, {
        role: "assistant", content: data.answer || "No response.", sources: data.sources || []
      }])
    } catch (err: any) {
      setMessages((prev) => [...prev, { role: "assistant", content: getFriendlyError(err) }])
    } finally { setLoading(false) }
  }

  async function handleCompare(e: React.FormEvent) {
    e.preventDefault()
    if (!compareQuestion.trim() || comparing) return
    const selectedDocs = docs.filter((d) => d.selected)
    if (selectedDocs.length < 2) return
    setComparing(true); setCompareResult(null)
    try {
      const res = await fetch("/api/compare", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: compareQuestion, docIds: selectedDocs.map((d) => d.docId) })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCompareResult(data)
    } catch (err: any) {
      alert(getFriendlyError(err))
    } finally { setComparing(false) }
  }

  async function handleExport() {
    if (messages.length === 0 || exporting) return
    setExporting(true); setExportReport("")
    try {
      const res = await fetch("/api/export", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, docNames: docs.map((d) => d.name) })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setExportReport(data.report || "")
    } catch (err: any) {
      alert(getFriendlyError(err))
    } finally { setExporting(false) }
  }

  function downloadReport() {
    const blob = new Blob([exportReport], { type: "text/markdown" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url; a.download = "lexiflow-report.md"; a.click()
    URL.revokeObjectURL(url)
  }

  function toggleSource(key: number) {
    setExpandedSources((prev) => prev.includes(key) ? prev.filter((i) => i !== key) : [...prev, key])
  }

  function getConfidenceColor(s: number) { return s >= 80 ? "#34d399" : s >= 60 ? "#fbbf24" : "#f87171" }
  function getConfidenceLabel(s: number) { return s >= 80 ? "High" : s >= 60 ? "Medium" : "Low" }
  function getAvgConfidence(sources?: Source[]) {
    if (!sources || sources.length === 0) return 0
    return Math.round(sources.reduce((a, s) => a + s.similarity, 0) / sources.length)
  }

  const selectedDocs = docs.filter((d) => d.selected)
  const selectedCount = selectedDocs.length

  return (
    <>
      <style suppressHydrationWarning>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        html,body{height:100%;overflow:hidden}
        body{background:#0f0f10;font-family:'Inter',sans-serif}
        ::-webkit-scrollbar{width:3px}
        ::-webkit-scrollbar-thumb{background:#2a2a2e;border-radius:2px}
        @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes blink{0%,100%{opacity:0.2}50%{opacity:1}}
        @keyframes spin{to{transform:rotate(360deg)}}
        .fade-up{animation:fadeUp 0.35s ease forwards}
        .dot{width:4px;height:4px;border-radius:50%;background:#a78bfa;display:inline-block}
        .dot:nth-child(1){animation:blink 1.2s ease infinite 0s}
        .dot:nth-child(2){animation:blink 1.2s ease infinite 0.2s}
        .dot:nth-child(3){animation:blink 1.2s ease infinite 0.4s}
        .upload-zone{border:1.5px dashed #2a2a2e;border-radius:12px;transition:all 0.2s;cursor:pointer}
        .upload-zone:hover,.upload-zone.active{border-color:#7c3aed;background:rgba(124,58,237,0.05)}
        .send-btn{background:linear-gradient(135deg,#7c3aed,#6d28d9);border:none;border-radius:10px;color:white;font-family:'Inter',sans-serif;font-size:13px;font-weight:500;padding:10px 18px;cursor:pointer;transition:all 0.15s;white-space:nowrap;height:42px;display:flex;align-items:center;justify-content:center;min-width:72px}
        .send-btn:hover:not(:disabled){background:linear-gradient(135deg,#8b5cf6,#7c3aed);transform:translateY(-1px)}
        .send-btn:disabled{opacity:0.35;cursor:not-allowed;transform:none}
        .chat-input{background:#1a1a1f;border:1.5px solid #2a2a2e;border-radius:12px;color:#e2e8f0;font-family:'Inter',sans-serif;font-size:14px;line-height:1.5;padding:10px 16px;resize:none;transition:border-color 0.2s;outline:none;flex:1;min-height:42px;max-height:120px;overflow-y:auto}
        .chat-input:focus{border-color:#7c3aed}
        .chat-input::placeholder{color:#4a4a54}
        .text-input{background:#1a1a1f;border:1.5px solid #2a2a2e;border-radius:12px;color:#e2e8f0;font-family:'Inter',sans-serif;font-size:14px;padding:10px 16px;transition:border-color 0.2s;outline:none;width:100%}
        .text-input:focus{border-color:#7c3aed}
        .text-input::placeholder{color:#4a4a54}
        .spinner{width:14px;height:14px;border:2px solid rgba(255,255,255,0.2);border-top-color:white;border-radius:50%;animation:spin 0.7s linear infinite}
        .mini-spinner{width:10px;height:10px;border:1.5px solid #7c3aed33;border-top-color:#7c3aed;border-radius:50%;animation:spin 0.7s linear infinite;display:inline-block}
        .suggestion-btn{background:#1a1a1f;border:1px solid #2a2a2e;border-radius:20px;color:#6b7280;font-family:'Inter',sans-serif;font-size:12px;padding:6px 14px;cursor:pointer;transition:all 0.15s;text-align:left}
        .suggestion-btn:hover{color:#e2e8f0;border-color:#7c3aed44;background:#1e1e28}
        .doc-card{background:#111115;border:1px solid #2a2a2e;border-radius:10px;transition:border-color 0.2s;margin-top:6px;overflow:hidden}
        .doc-card:hover{border-color:#3a3a44}
        .doc-card.selected{border-color:rgba(124,58,237,0.35);background:rgba(124,58,237,0.04)}
        .source-card{background:#111115;border:1px solid #2a2a2e;border-radius:10px;overflow:hidden;transition:border-color 0.2s;margin-top:6px}
        .source-card:hover{border-color:#3a3a44}
        .tab-btn{background:none;border:none;font-family:'Inter',sans-serif;font-size:12px;padding:10px 10px;cursor:pointer;border-bottom:2px solid transparent;transition:all 0.15s;color:#4a4a54;white-space:nowrap}
        .tab-btn.active{color:#a78bfa;border-bottom-color:#7c3aed}
        .tab-btn:hover:not(.active){color:#6b7280}
        .icon-btn{background:#1a1a1f;border:1px solid #2a2a2e;border-radius:6px;color:#6b7280;font-size:11px;padding:3px 8px;cursor:pointer;transition:all 0.15s;font-family:'Inter',sans-serif}
        .icon-btn:hover{color:#f87171;border-color:#f8717144}
        .q-chip{background:#1a1a1f;border:1px solid #2a2a2e;border-radius:8px;padding:6px 10px;font-size:12px;color:#a78bfa;cursor:pointer;transition:all 0.15s;text-align:left;width:100%;font-family:'Inter',sans-serif;margin-top:4px}
        .q-chip:hover{border-color:#7c3aed;background:#1e1e28;color:#c4b5fd}
        .confidence-bar{height:3px;border-radius:2px;background:#2a2a2e;overflow:hidden;margin-top:6px}
        .confidence-fill{height:100%;border-radius:2px;transition:width 0.5s ease}
        .compare-section{background:#111115;border:1px solid #2a2a2e;border-radius:12px;padding:16px;margin-bottom:12px}
        .compare-item{display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid #1a1a1a}
        .compare-item:last-child{border-bottom:none}
        .action-btn{background:#1a1a1f;border:1px solid #2a2a2e;border-radius:8px;color:#a78bfa;font-family:'Inter',sans-serif;font-size:12px;padding:8px 16px;cursor:pointer;transition:all 0.15s}
        .action-btn:hover{border-color:#7c3aed;background:#1e1e28}
        .action-btn:disabled{opacity:0.35;cursor:not-allowed}
        .report-area{background:#111115;border:1px solid #2a2a2e;border-radius:12px;padding:20px;font-size:13px;color:#cbd5e1;line-height:1.8;white-space:pre-wrap;overflow-y:auto;max-height:400px}
        .overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:40}
        .menu-btn{display:none;background:#1a1a1f;border:1px solid #2a2a2e;border-radius:8px;color:#e2e8f0;font-size:16px;width:36px;height:36px;cursor:pointer;align-items:center;justify-content:center}
        @media(max-width:768px){
          .menu-btn{display:flex}
          .overlay{display:block}
          .sidebar{position:fixed!important;left:-290px!important;top:0!important;height:100%!important;z-index:50!important;transition:left 0.3s ease!important}
          .sidebar.open{left:0!important}
          .main-content{width:100%!important}
          .tab-btn{font-size:11px;padding:8px 8px}
          .chat-input{font-size:13px}
        }
        @media(max-width:480px){
          .tab-btn{padding:8px 6px;font-size:10px}
          .send-btn{min-width:60px;padding:10px 12px;font-size:12px}
        }
      `}</style>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:40}} onClick={() => setSidebarOpen(false)}/>
      )}

      <div style={{display:"flex",height:"100vh",fontFamily:"'Inter',sans-serif",background:"#0f0f10",color:"#e2e8f0",overflow:"hidden"}}>

        {/* ── Sidebar ── */}
        <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}
          style={{width:"280px",borderRight:"1px solid #1e1e24",background:"#0a0a0d",display:"flex",flexDirection:"column",flexShrink:0,overflow:"hidden"}}>

          <div style={{padding:"16px",borderBottom:"1px solid #1e1e24",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
              <div style={{width:"30px",height:"30px",background:"linear-gradient(135deg,#7c3aed,#4f46e5)",borderRadius:"8px",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:"700",fontSize:"14px",color:"white",flexShrink:0}}>L</div>
              <div>
                <p style={{fontSize:"14px",fontWeight:"600",color:"#f1f5f9"}}>LexiFlow</p>
                <p style={{fontSize:"10px",color:"#3a3a44",letterSpacing:"0.06em"}}>RAG KNOWLEDGE BASE</p>
              </div>
            </div>
            <button className="icon-btn" onClick={() => setSidebarOpen(false)} style={{display:"none"}}>✕</button>
          </div>

          <div style={{padding:"12px 16px",borderBottom:"1px solid #1e1e24"}}>
            <div className={`upload-zone ${dragging?"active":""}`} style={{padding:"12px",textAlign:"center"}}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {e.preventDefault();setDragging(true)}}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {e.preventDefault();setDragging(false);const f=e.dataTransfer.files[0];if(f)handleUpload(f)}}>
              <input ref={fileRef} type="file" accept=".pdf" style={{display:"none"}} onChange={(e) => e.target.files?.[0]&&handleUpload(e.target.files[0])}/>
              {uploadStatus==="uploading"?(
                <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:"8px"}}>
                  <div style={{width:"12px",height:"12px",border:"2px solid #7c3aed33",borderTopColor:"#7c3aed",borderRadius:"50%",animation:"spin 0.7s linear infinite"}}/>
                  <p style={{fontSize:"12px",color:"#6b7280"}}>Processing PDF...</p>
                </div>
              ):(
                <p style={{fontSize:"12px",color:"#6b7280"}}>+ Upload PDF <span style={{color:"#4a4a54"}}>(max 10MB)</span></p>
              )}
            </div>
            {uploadMessage&&(
              <p style={{fontSize:"11px",color:uploadStatus==="error"?"#f87171":"#34d399",marginTop:"6px",lineHeight:1.5}}>
                {uploadStatus==="success"?"✓ ":"⚠ "}{uploadMessage}
              </p>
            )}
          </div>

          <div style={{flex:1,overflowY:"auto",padding:"12px 16px"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"8px"}}>
              <p style={{fontSize:"10px",color:"#4a4a54",letterSpacing:"0.1em",fontWeight:"500"}}>DOCUMENTS ({docs.length})</p>
              {docs.length>0&&<span style={{fontSize:"10px",color:"#4a4a54"}}>{selectedCount} active</span>}
            </div>

            {docs.length===0?(
              <div style={{textAlign:"center",marginTop:"24px"}}>
                <p style={{fontSize:"12px",color:"#3a3a44",lineHeight:1.6}}>No documents yet</p>
                <p style={{fontSize:"11px",color:"#2a2a2e",marginTop:"4px"}}>Upload a PDF to get started</p>
              </div>
            ):(
              docs.map((doc)=>(
                <div key={doc.docId} className={`doc-card ${doc.selected?"selected":""}`}>
                  <div style={{padding:"10px 12px"}}>
                    <div style={{display:"flex",alignItems:"flex-start",gap:"8px"}}>
                      <input type="checkbox" checked={doc.selected} onChange={()=>toggleDoc(doc.docId)}
                        style={{width:"14px",height:"14px",accentColor:"#7c3aed",cursor:"pointer",marginTop:"2px",flexShrink:0}}/>
                      <div style={{flex:1,minWidth:0}}>
                        <p style={{fontSize:"12px",color:"#a78bfa",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:"500"}}>{doc.name}</p>
                        <div style={{display:"flex",alignItems:"center",gap:"6px",marginTop:"2px",flexWrap:"wrap"}}>
                          <p style={{fontSize:"11px",color:"#4a4a54"}}>{doc.chunks} chunks</p>
                          {doc.usedOCR&&<span style={{fontSize:"10px",background:"rgba(251,191,36,0.1)",color:"#fbbf24",padding:"1px 5px",borderRadius:"4px"}}>OCR</span>}
                          {doc.topic&&<span style={{fontSize:"10px",background:"rgba(124,58,237,0.1)",color:"#a78bfa",padding:"1px 6px",borderRadius:"4px"}}>{doc.topic}</span>}
                        </div>
                      </div>
                      <div style={{display:"flex",gap:"4px"}}>
                        <button className="icon-btn" style={{color:"#6b7280"}} onClick={()=>setExpandedDoc(expandedDoc===doc.docId?null:doc.docId)}>{expandedDoc===doc.docId?"▲":"▼"}</button>
                        <button className="icon-btn" onClick={()=>removeDoc(doc.docId)}>✕</button>
                      </div>
                    </div>
                  </div>
                  {expandedDoc===doc.docId&&(
                    <div style={{borderTop:"1px solid #1e1e24",padding:"10px 12px"}}>
                      {doc.analyzing?(
                        <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                          <div className="mini-spinner"/>
                          <p style={{fontSize:"11px",color:"#4a4a54"}}>Analyzing document...</p>
                        </div>
                      ):(
                        <>
                          {doc.summary&&(
                            <div style={{marginBottom:"10px"}}>
                              <p style={{fontSize:"10px",color:"#4a4a54",letterSpacing:"0.08em",marginBottom:"4px"}}>SUMMARY</p>
                              <p style={{fontSize:"12px",color:"#8b8b9a",lineHeight:1.6}}>{doc.summary}</p>
                            </div>
                          )}
                          {doc.questions&&doc.questions.length>0&&(
                            <div>
                              <p style={{fontSize:"10px",color:"#4a4a54",letterSpacing:"0.08em",marginBottom:"4px"}}>SUGGESTED QUESTIONS</p>
                              {doc.questions.map((q,qi)=>(
                                <button key={qi} className="q-chip" onClick={()=>{setQuestion(q);setActiveTab("chat");setSidebarOpen(false)}}>{q}</button>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <div style={{padding:"12px 16px",borderTop:"1px solid #1e1e24"}}>
            <p style={{fontSize:"11px",color:"#3a3a44",lineHeight:1.7}}>LLaMA 3 · HuggingFace · Supabase</p>
          </div>
        </aside>

        {/* ── Main ── */}
        <main className="main-content" style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:"#0f0f10",minWidth:0}}>

          {/* Topbar */}
          <div style={{borderBottom:"1px solid #1e1e24",background:"#0a0a0d",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 16px",flexShrink:0}}>
            <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
              <button className="menu-btn" onClick={() => setSidebarOpen(true)}>☰</button>
              <div style={{display:"flex"}}>
                <button className={`tab-btn ${activeTab==="chat"?"active":""}`} onClick={()=>setActiveTab("chat")}>Chat</button>
                <button className={`tab-btn ${activeTab==="compare"?"active":""}`} onClick={()=>setActiveTab("compare")}>
                  Compare{selectedCount>=2&&<span style={{fontSize:"9px",background:"rgba(124,58,237,0.2)",color:"#a78bfa",padding:"1px 4px",borderRadius:"4px",marginLeft:"3px"}}>{selectedCount}</span>}
                </button>
                <button className={`tab-btn ${activeTab==="export"?"active":""}`} onClick={()=>setActiveTab("export")}>Export</button>
                <button className={`tab-btn ${activeTab==="history"?"active":""}`} onClick={()=>setActiveTab("history")}>
                  History{messages.length>0&&` (${Math.ceil(messages.length/2)})`}
                </button>
              </div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:"8px",flexShrink:0}}>
              <div style={{display:"flex",alignItems:"center",gap:"5px"}}>
                <div style={{width:"6px",height:"6px",borderRadius:"50%",background:selectedCount>0?"#34d399":"#4a4a54",flexShrink:0}}/>
                <span style={{fontSize:"11px",color:"#6b7280",whiteSpace:"nowrap"}}>{selectedCount>0?`${selectedCount} doc${selectedCount>1?"s":""}`:"No docs"}</span>
              </div>
              {messages.length>0&&<button className="icon-btn" onClick={clearHistory} style={{fontSize:"10px"}}>Clear</button>}
            </div>
          </div>

          {/* ── Chat Tab ── */}
          {activeTab==="chat"&&(
            <>
              <div style={{flex:1,overflowY:"auto",padding:"20px 16px"}}>
                {messages.length===0?(
                  <div style={{height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"16px",padding:"20px"}}>
                    <div style={{width:"48px",height:"48px",background:"rgba(124,58,237,0.1)",border:"1px solid rgba(124,58,237,0.2)",borderRadius:"14px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"20px"}}>⚡</div>
                    <div style={{textAlign:"center",maxWidth:"380px"}}>
                      <h2 style={{fontSize:"18px",fontWeight:"600",color:"#f1f5f9",marginBottom:"8px"}}>Ask your documents</h2>
                      <p style={{fontSize:"13px",color:"#4a4a54",lineHeight:1.6}}>Upload a PDF → get instant summary → ask questions → compare documents → export reports.</p>
                    </div>
                    {docs.length===0&&(
                      <button className="send-btn" onClick={() => fileRef.current?.click()} style={{marginTop:"8px"}}>
                        Upload PDF
                      </button>
                    )}
                    {docs.length>0&&docs[0].questions&&(
                      <div style={{width:"100%",maxWidth:"400px"}}>
                        <p style={{fontSize:"11px",color:"#4a4a54",textAlign:"center",marginBottom:"8px",letterSpacing:"0.06em"}}>SUGGESTED FROM YOUR DOCUMENTS</p>
                        {docs[0].questions.slice(0,3).map((q,i)=>(
                          <button key={i} className="suggestion-btn" style={{width:"100%",marginBottom:"6px",borderRadius:"10px",padding:"10px 14px"}} onClick={()=>setQuestion(q)}>{q}</button>
                        ))}
                      </div>
                    )}
                  </div>
                ):(
                  <div style={{maxWidth:"720px",margin:"0 auto",display:"flex",flexDirection:"column",gap:"16px"}}>
                    {messages.map((msg,i)=>{
                      const avgConf=getAvgConfidence(msg.sources)
                      const isLowConf=msg.role==="assistant"&&msg.sources&&msg.sources.length>0&&avgConf<55
                      return(
                        <div key={i} className="fade-up" style={{display:"flex",flexDirection:"column",alignItems:msg.role==="user"?"flex-end":"flex-start",gap:"4px"}}>
                          <span style={{fontSize:"10px",color:"#3a3a44",letterSpacing:"0.08em",padding:"0 4px"}}>{msg.role==="user"?"YOU":"LEXIFLOW"}</span>
                          {isLowConf&&(
                            <div style={{display:"flex",alignItems:"flex-start",gap:"6px",background:"rgba(251,191,36,0.08)",border:"1px solid rgba(251,191,36,0.2)",borderRadius:"8px",padding:"6px 10px",marginBottom:"2px",maxWidth:"90%"}}>
                              <span style={{fontSize:"12px",flexShrink:0}}>⚠</span>
                              <p style={{fontSize:"11px",color:"#fbbf24",lineHeight:1.4}}>Low confidence — this answer may not be fully accurate based on your documents.</p>
                            </div>
                          )}
                          <div style={{maxWidth:"90%",padding:"12px 16px",borderRadius:msg.role==="user"?"16px 16px 4px 16px":"16px 16px 16px 4px",background:msg.role==="user"?"rgba(124,58,237,0.12)":"#1a1a1f",border:`1px solid ${msg.role==="user"?"rgba(124,58,237,0.25)":"#2a2a2e"}`,fontSize:"14px",lineHeight:1.65,color:msg.role==="user"?"#ddd6fe":"#cbd5e1",whiteSpace:"pre-wrap",width:msg.role==="assistant"?"100%":"auto"}}>
                            {msg.content}
                          </div>
                          {msg.role==="assistant"&&msg.sources&&msg.sources.length>0&&(
                            <div style={{width:"100%",maxWidth:"90%"}}>
                              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"4px"}}>
                                <p style={{fontSize:"11px",color:"#4a4a54"}}>{msg.sources.length} source{msg.sources.length>1?"s":""}</p>
                                <p style={{fontSize:"11px",color:getConfidenceColor(avgConf)}}>{getConfidenceLabel(avgConf)} · {avgConf}%</p>
                              </div>
                              <div className="confidence-bar"><div className="confidence-fill" style={{width:`${avgConf}%`,background:getConfidenceColor(avgConf)}}/></div>
                              {msg.sources.map((src,si)=>{
                                const key=i*100+si; const isExp=expandedSources.includes(key); const color=getConfidenceColor(src.similarity)
                                return(
                                  <div key={si} className="source-card">
                                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",cursor:"pointer"}} onClick={()=>toggleSource(key)}>
                                      <div style={{display:"flex",alignItems:"center",gap:"8px",minWidth:0}}>
                                        <span style={{fontSize:"12px",flexShrink:0}}>📄</span>
                                        <span style={{fontSize:"12px",color:"#a78bfa",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{src.source}</span>
                                      </div>
                                      <div style={{display:"flex",alignItems:"center",gap:"6px",flexShrink:0}}>
                                        <span style={{display:"inline-flex",alignItems:"center",gap:"3px",borderRadius:"20px",padding:"2px 7px",fontSize:"11px",fontWeight:"500",background:`${color}18`,color}}>
                                          <span style={{width:"4px",height:"4px",borderRadius:"50%",background:color,display:"inline-block"}}/>{src.similarity}%
                                        </span>
                                        <span style={{fontSize:"11px",color:"#4a4a54"}}>{isExp?"▲":"▼"}</span>
                                      </div>
                                    </div>
                                    {isExp&&(
                                      <div style={{padding:"8px 12px 10px",borderTop:"1px solid #1e1e24"}}>
                                        <p style={{fontSize:"11px",color:"#4a4a54",marginBottom:"4px"}}>Matched text:</p>
                                        <p style={{fontSize:"12px",color:"#6b7280",lineHeight:1.6,fontStyle:"italic"}}>"{src.content.slice(0,300)}{src.content.length>300?"...":""}"</p>
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                    {loading&&(
                      <div className="fade-up" style={{display:"flex",flexDirection:"column",alignItems:"flex-start",gap:"4px"}}>
                        <span style={{fontSize:"10px",color:"#3a3a44",letterSpacing:"0.08em",padding:"0 4px"}}>LEXIFLOW</span>
                        <div style={{padding:"12px 16px",background:"#1a1a1f",border:"1px solid #2a2a2e",borderRadius:"16px 16px 16px 4px",display:"flex",gap:"5px",alignItems:"center"}}>
                          <div className="dot"/><div className="dot"/><div className="dot"/>
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef}/>
                  </div>
                )}
              </div>
              <div style={{borderTop:"1px solid #1e1e24",padding:"12px 16px",background:"#0a0a0d",flexShrink:0}}>
                {selectedCount===0&&docs.length>0&&(
                  <p style={{fontSize:"12px",color:"#fbbf24",textAlign:"center",marginBottom:"8px"}}>⚠ No documents selected — check the boxes in the sidebar</p>
                )}
                <form onSubmit={handleAsk} style={{maxWidth:"720px",margin:"0 auto",display:"flex",gap:"8px",alignItems:"flex-end"}}>
                  <textarea className="chat-input" value={question} onChange={(e)=>setQuestion(e.target.value)}
                    onKeyDown={(e)=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();handleAsk(e as any)}}}
                    placeholder={docs.length===0?"Upload a PDF to get started...":selectedCount>0?`Ask across ${selectedCount} document${selectedCount>1?"s":""}...`:"Select documents to ask questions..."}
                    rows={1} onInput={(e)=>{const el=e.currentTarget;el.style.height="auto";el.style.height=Math.min(el.scrollHeight,120)+"px"}}/>
                  <button type="submit" disabled={loading||!question.trim()||selectedCount===0} className="send-btn">
                    {loading?<div className="spinner"/>:"Send →"}
                  </button>
                </form>
                <p style={{fontSize:"11px",color:"#2a2a2e",textAlign:"center",marginTop:"6px"}}>Enter to send · Shift+Enter for new line</p>
              </div>
            </>
          )}

          {/* ── Compare Tab ── */}
          {activeTab==="compare"&&(
            <div style={{flex:1,overflowY:"auto",padding:"20px 16px"}}>
              <div style={{maxWidth:"720px",margin:"0 auto"}}>
                {selectedCount<2?(
                  <div style={{textAlign:"center",padding:"60px 0"}}>
                    <p style={{fontSize:"16px",color:"#4a4a54",marginBottom:"8px"}}>Select at least 2 documents</p>
                    <p style={{fontSize:"13px",color:"#3a3a44"}}>Check 2 or more documents in the sidebar to compare them</p>
                    <button className="send-btn" style={{margin:"16px auto 0",display:"flex"}} onClick={()=>setSidebarOpen(true)}>Open Sidebar</button>
                  </div>
                ):(
                  <>
                    <div style={{marginBottom:"20px"}}>
                      <h2 style={{fontSize:"18px",fontWeight:"600",color:"#f1f5f9",marginBottom:"4px"}}>Compare Documents</h2>
                      <p style={{fontSize:"13px",color:"#4a4a54"}}>Comparing: {selectedDocs.map(d=>d.name).join(" vs ")}</p>
                    </div>
                    <form onSubmit={handleCompare} style={{display:"flex",gap:"8px",marginBottom:"24px",flexWrap:"wrap"}}>
                      <input className="text-input" style={{minWidth:"200px",flex:1}} value={compareQuestion} onChange={(e)=>setCompareQuestion(e.target.value)}
                        placeholder="What do these documents disagree on?"/>
                      <button type="submit" disabled={comparing||!compareQuestion.trim()} className="send-btn" style={{flexShrink:0}}>
                        {comparing?<div className="spinner"/>:"Compare →"}
                      </button>
                    </form>
                    {comparing&&(
                      <div style={{textAlign:"center",padding:"40px",color:"#4a4a54"}}>
                        <div style={{width:"20px",height:"20px",border:"2px solid #7c3aed33",borderTopColor:"#7c3aed",borderRadius:"50%",animation:"spin 0.7s linear infinite",margin:"0 auto 12px"}}/>
                        <p style={{fontSize:"13px"}}>Analyzing and comparing documents...</p>
                      </div>
                    )}
                    {compareResult&&!comparing&&(
                      <div className="fade-up">
                        {compareResult.verdict&&(
                          <div style={{background:"rgba(124,58,237,0.08)",border:"1px solid rgba(124,58,237,0.2)",borderRadius:"12px",padding:"16px",marginBottom:"16px"}}>
                            <p style={{fontSize:"11px",color:"#a78bfa",letterSpacing:"0.08em",marginBottom:"6px"}}>VERDICT</p>
                            <p style={{fontSize:"14px",color:"#e2e8f0",lineHeight:1.65}}>{compareResult.verdict}</p>
                          </div>
                        )}
                        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:"12px",marginBottom:"12px"}}>
                          <div className="compare-section">
                            <p style={{fontSize:"11px",color:"#34d399",letterSpacing:"0.08em",marginBottom:"10px"}}>✓ SIMILARITIES</p>
                            {compareResult.similarities?.map((s,i)=>(
                              <div key={i} className="compare-item"><span style={{color:"#34d399",fontSize:"12px",flexShrink:0}}>•</span><p style={{fontSize:"13px",color:"#8b8b9a",lineHeight:1.5}}>{s}</p></div>
                            ))}
                          </div>
                          <div className="compare-section">
                            <p style={{fontSize:"11px",color:"#f87171",letterSpacing:"0.08em",marginBottom:"10px"}}>✕ DIFFERENCES</p>
                            {compareResult.differences?.map((s,i)=>(
                              <div key={i} className="compare-item"><span style={{color:"#f87171",fontSize:"12px",flexShrink:0}}>•</span><p style={{fontSize:"13px",color:"#8b8b9a",lineHeight:1.5}}>{s}</p></div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── Export Tab ── */}
          {activeTab==="export"&&(
            <div style={{flex:1,overflowY:"auto",padding:"20px 16px"}}>
              <div style={{maxWidth:"720px",margin:"0 auto"}}>
                <div style={{marginBottom:"20px"}}>
                  <h2 style={{fontSize:"18px",fontWeight:"600",color:"#f1f5f9",marginBottom:"4px"}}>Export Report</h2>
                  <p style={{fontSize:"13px",color:"#4a4a54"}}>Generate a professional markdown report from your chat session</p>
                </div>
                {messages.length===0?(
                  <div style={{textAlign:"center",padding:"60px 0",color:"#4a4a54"}}>
                    <p style={{fontSize:"14px"}}>No chat history to export</p>
                    <p style={{fontSize:"13px",marginTop:"4px",color:"#3a3a44"}}>Have a conversation first, then export it as a report</p>
                  </div>
                ):(
                  <>
                    <div style={{background:"#111115",border:"1px solid #2a2a2e",borderRadius:"12px",padding:"16px",marginBottom:"16px"}}>
                      <p style={{fontSize:"13px",color:"#6b7280",marginBottom:"12px"}}>{Math.ceil(messages.length/2)} exchanges from {docs.length} document{docs.length>1?"s":""}</p>
                      <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
                        <button className="action-btn" onClick={handleExport} disabled={exporting}>{exporting?"Generating...":"✦ Generate Report"}</button>
                        {exportReport&&(
                          <button className="action-btn" onClick={downloadReport} style={{color:"#34d399",borderColor:"rgba(52,211,153,0.3)"}}>↓ Download .md</button>
                        )}
                      </div>
                    </div>
                    {exporting&&(
                      <div style={{textAlign:"center",padding:"40px",color:"#4a4a54"}}>
                        <div style={{width:"20px",height:"20px",border:"2px solid #7c3aed33",borderTopColor:"#7c3aed",borderRadius:"50%",animation:"spin 0.7s linear infinite",margin:"0 auto 12px"}}/>
                        <p style={{fontSize:"13px"}}>Generating your report...</p>
                      </div>
                    )}
                    {exportReport&&!exporting&&(
                      <div className="fade-up">
                        <p style={{fontSize:"11px",color:"#4a4a54",marginBottom:"8px",letterSpacing:"0.06em"}}>GENERATED REPORT</p>
                        <div className="report-area">{exportReport}</div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── History Tab ── */}
          {activeTab==="history"&&(
            <div style={{flex:1,overflowY:"auto",padding:"20px 16px"}}>
              {messages.length===0?(
                <div style={{textAlign:"center",color:"#4a4a54",marginTop:"60px"}}>
                  <p style={{fontSize:"14px"}}>No chat history yet</p>
                </div>
              ):(
                <div style={{maxWidth:"720px",margin:"0 auto"}}>
                  <p style={{fontSize:"12px",color:"#4a4a54",marginBottom:"20px"}}>{Math.ceil(messages.length/2)} exchanges saved</p>
                  {messages.filter(m=>m.role==="user").map((msg,i)=>(
                    <div key={i} style={{background:"#111115",border:"1px solid #2a2a2e",borderRadius:"12px",padding:"14px 16px",marginBottom:"10px"}}>
                      <p style={{fontSize:"11px",color:"#4a4a54",marginBottom:"6px",letterSpacing:"0.06em"}}>Q {i+1}</p>
                      <p style={{fontSize:"14px",color:"#e2e8f0",marginBottom:"8px"}}>{msg.content}</p>
                      {messages[i*2+1]&&(
                        <>
                          <p style={{fontSize:"11px",color:"#4a4a54",marginBottom:"4px",letterSpacing:"0.06em"}}>ANSWER</p>
                          <p style={{fontSize:"13px",color:"#6b7280",lineHeight:1.6}}>{messages[i*2+1].content.slice(0,200)}{messages[i*2+1].content.length>200?"...":""}</p>
                          {messages[i*2+1].sources&&messages[i*2+1].sources!.length>0&&(
                            <p style={{fontSize:"11px",color:"#4a4a54",marginTop:"6px"}}>{messages[i*2+1].sources!.length} sources · {getAvgConfidence(messages[i*2+1].sources)}% confidence</p>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </main>
      </div>
    </>
  )
}
