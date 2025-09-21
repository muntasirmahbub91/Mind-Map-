import React, { useEffect, useMemo, useState } from "react";
import MindMap from "./MindMap";
import { getStore, setStore, type MapState } from "../store/mindmapStore";
import { listDocs, createDoc, loadDoc, saveDoc, renameDoc, duplicateDoc, deleteDoc, exportDoc, importDoc, type MindmapDocMeta } from "../store/mindmapProjects";

export default function MindMapHost() {
  const [docs, setDocs] = useState<MindmapDocMeta[]>(listDocs());
  const [activeId, setActiveId] = useState<string>(() => docs[0]?.id ?? createDoc("My first map"));
  const [rename, setRename] = useState("");

  // load selected doc into the editor store
  useEffect(() => {
    const data = loadDoc(activeId);
    if (data) setStore(data);
  }, [activeId]);

  // autosave on editor store changes
  useEffect(() => {
    const unsub = (window as any).mindmapAutosave ??= (() => {
      return setInterval(() => {
        const s: MapState = getStore();
        saveDoc(activeId, s);
      }, 800);
    })();
    return () => { /* keep single interval */ };
  }, [activeId]);

  // refresh index list on focus (covers external changes)
  useEffect(() => {
    const fn = () => setDocs(listDocs());
    window.addEventListener("focus", fn);
    return () => window.removeEventListener("focus", fn);
  }, []);

  const onNew = () => { const id = createDoc("Untitled"); setDocs(listDocs()); setActiveId(id); };
  const onRename = () => { if (!rename.trim()) return; renameDoc(activeId, rename.trim()); setRename(""); setDocs(listDocs()); };
  const onDuplicate = () => { const id = duplicateDoc(activeId); setDocs(listDocs()); setActiveId(id); };
  const onDelete = () => { if (!confirm("Delete this map?")) return; deleteDoc(activeId); const next = listDocs(); setDocs(next); setActiveId(next[0]?.id ?? createDoc("Untitled")); };

  const onExport = () => {
    const text = exportDoc(activeId);
    if (!text) return;
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "mindmap.json"; a.click();
    URL.revokeObjectURL(url);
  };
  const onImport = (file: File) => {
    const r = new FileReader();
    r.onload = () => {
      const id = importDoc("Imported map", String(r.result || ""));
      setDocs(listDocs()); setActiveId(id);
    };
    r.readAsText(file);
  };

  return (
    <div className="mm-host">
      <aside className="mm-sidebar">
        <div className="mm-side-head">
          <button className="mm-btn" onClick={onNew}>＋ New map</button>
        </div>
        <ul className="mm-list">
          {docs.map(d => (
            <li key={d.id} className={`mm-item ${d.id===activeId?"active":""}`} onClick={()=>setActiveId(d.id)}>
              <div className="mm-name">{d.name}</div>
              <div className="mm-time">{new Date(d.updatedAt).toLocaleString()}</div>
            </li>
          ))}
        </ul>
        <div className="mm-side-actions">
          <input className="mm-input" placeholder="Rename…" value={rename} onChange={e=>setRename(e.target.value)} />
          <button className="mm-btn" onClick={onRename}>Rename</button>
          <button className="mm-btn" onClick={onDuplicate}>Duplicate</button>
          <button className="mm-btn danger" onClick={onDelete}>Delete</button>
          <button className="mm-btn" onClick={onExport}>Export</button>
          <label className="mm-btn">
            Import
            <input type="file" accept="application/json" onChange={e=>{const f=e.target.files?.[0]; if(f) onImport(f); e.currentTarget.value="";}} hidden />
          </label>
        </div>
      </aside>

      <main className="mm-main">
        <MindMap />
      </main>
    </div>
  );
}
