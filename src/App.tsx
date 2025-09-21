// src/App.tsx
import "./app.css";
import React, { useEffect, useMemo, useState } from "react";
import MindMap from "./components/MindMap";
import { setStore, getStore, type MapState } from "./store/mindmapStore";
import {
  listDocs, createDoc, loadDoc, saveDoc, renameDoc,
  duplicateDoc, deleteDoc, exportDoc, importDoc, type MindmapDocMeta,
} from "./store/mindmapProjects";

type Screen = "library" | "editor";
type SortKey = "updated" | "name" | "created"; // created==updated at first save for local impl

export default function App() {
  const [screen, setScreen] = useState<Screen>("library");
  const [docs, setDocs] = useState<MindmapDocMeta[]>(listDocs());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [renameDraft, setRenameDraft] = useState<string>("");

  const refresh = () => setDocs(listDocs());

  const openDoc = (id: string) => {
    const data = loadDoc(id); if (!data) return;
    setStore(data);
    setActiveId(id);
    localStorage.setItem("mindmap:lastId", id);
    setScreen("editor");
  };

  const newDoc = () => { const id = createDoc("Untitled"); refresh(); openDoc(id); };

  const doImport = (file: File) => {
    const r = new FileReader();
    r.onload = () => { const id = importDoc("Imported map", String(r.result || "")); refresh(); openDoc(id); };
    r.readAsText(file);
  };

  const saveActive = () => { if (!activeId) return; const s: MapState = getStore(); saveDoc(activeId, s); };

  // autosave in editor
  useEffect(() => {
    if (screen !== "editor" || !activeId) return;
    const t = setInterval(saveActive, 800);
    return () => clearInterval(t);
  }, [screen, activeId]);

  // Cmd/Ctrl+S in editor
  useEffect(() => {
    if (screen !== "editor") return;
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveActive(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, activeId]);

  // derived list with search + sort
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? docs.filter(d => d.name.toLowerCase().includes(q)) : docs.slice();
    filtered.sort((a,b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name);
      // "created" not stored separately; use updated as proxy
      return b.updatedAt - a.updatedAt;
    });
    return filtered;
  }, [docs, query, sortKey]);

  if (screen === "library") {
    return (
      <div className="library-root">
        {/* Header */}
        <header className="app-header">
          <div className="title-wrap">
            <h1 className="app-title">Mind maps</h1>
          </div>
          <div className="header-actions">
            <button className="btn" onClick={newDoc}>＋ New map</button>
            <label className="btn file-btn">
              Import
              <input type="file" accept="application/json"
                     onChange={(e)=>{const f=e.target.files?.[0]; if(f) doImport(f); e.currentTarget.value="";}} />
            </label>
          </div>
        </header>

        {/* Toolbar */}
        <div className="toolbar">
          <input
            className="search"
            type="search"
            placeholder="Search maps…"
            value={query}
            onChange={(e)=>setQuery(e.target.value)}
          />
          <div className="spacer" />
          <label className="sort">
            <span>Sort</span>
            <select value={sortKey} onChange={(e)=>setSortKey(e.target.value as SortKey)}>
              <option value="updated">Updated</option>
              <option value="name">Name</option>
              <option value="created">Created</option>
            </select>
          </label>
        </div>

        {/* Grid */}
        <main className="grid-wrap">
          {shown.length === 0 ? (
            <div className="empty-card">
              <div className="empty-title">No maps found</div>
              <div className="empty-sub">Create a new map or adjust your search.</div>
              <button className="btn" onClick={newDoc}>Create map</button>
            </div>
          ) : (
            <div className="card-grid">
              {shown.map((d) => (
                <article key={d.id} className="doc-card" onClick={()=>openDoc(d.id)} role="button" tabIndex={0}
                         onKeyDown={(e)=>{ if(e.key==="Enter") openDoc(d.id); }}>
                  <div className="thumb" aria-hidden>
                    <div className="thumb-grid">
                      <div /><div /><div /><div /><div /><div />
                    </div>
                  </div>

                  <div className="doc-meta">
                    <input
                      className="doc-name"
                      value={activeId===d.id && renameDraft!=="" ? renameDraft : d.name}
                      onClick={(e)=>e.stopPropagation()}
                      onChange={(e)=>{ setActiveId(d.id); setRenameDraft(e.target.value); }}
                      onBlur={()=>{
                        if (!activeId || !renameDraft.trim()) { setRenameDraft(""); return; }
                        renameDoc(activeId, renameDraft.trim()); setRenameDraft(""); refresh();
                      }}
                      onKeyDown={(e)=>{ if(e.key==="Enter"){ (e.target as HTMLInputElement).blur(); } }}
                    />
                    <div className="doc-time">Updated · {new Date(d.updatedAt).toLocaleString()}</div>
                  </div>

                  <details className="kebab" onClick={(e)=>e.stopPropagation()}>
                    <summary aria-label="Actions">⋯</summary>
                    <div className="menu">
                      <button onClick={()=>openDoc(d.id)}>Open</button>
                      <button onClick={()=>{ const id=duplicateDoc(d.id); refresh(); openDoc(id); }}>Duplicate</button>
                      <button onClick={()=>{
                        const text = exportDoc(d.id); if (!text) return;
                        const blob = new Blob([text], { type: "application/json" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a"); a.href = url; a.download = `${d.name || "mindmap"}.json`; a.click();
                        URL.revokeObjectURL(url);
                      }}>Export</button>
                      <button className="danger"
                        onClick={()=>{ if(confirm("Delete this map?")){ deleteDoc(d.id); refresh(); } }}>
                        Delete
                      </button>
                    </div>
                  </details>
                </article>
              ))}
            </div>
          )}
        </main>
      </div>
    );
  }

  // Editor view: Save & Exit wired via MindMap props
  return (
    <div className="fixed inset-0">
      <MindMap
        onSave={saveActive}
        onExit={() => { saveActive(); setScreen("library"); refresh(); }}
      />
    </div>
  );
}
