// Multi-document persistence for Mind Map
// Each doc stored under mindmap:doc:{id}, plus an index mindmap:index

import type { MapState } from "./mindmapStore";

export type DocID = string;
export interface MindmapDocMeta {
  id: DocID;
  name: string;
  updatedAt: number;
}
const IDX_KEY = "mindmap:index";
const DOC_KEY = (id: DocID) => `mindmap:doc:${id}`;

const now = () => Date.now();
const uid = () => Math.random().toString(36).slice(2, 10);

function readIndex(): MindmapDocMeta[] {
  try { return JSON.parse(localStorage.getItem(IDX_KEY) || "[]"); } catch { return []; }
}
function writeIndex(list: MindmapDocMeta[]) {
  localStorage.setItem(IDX_KEY, JSON.stringify(list));
}

export function listDocs(): MindmapDocMeta[] {
  return readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function createDoc(name = "Untitled"): DocID {
  const id = uid();
  const meta: MindmapDocMeta = { id, name, updatedAt: now() };
  const idx = readIndex();
  idx.push(meta);
  writeIndex(idx);
  // minimal starter state
  const state: MapState = { rootId: "root", nodes: { root: { id: "root", text: name, x: 0, y: 0, color: "#fde68a", shape: "rounded" } }, links: [] };
  localStorage.setItem(DOC_KEY(id), JSON.stringify(state));
  return id;
}

export function loadDoc(id: DocID): MapState | null {
  const raw = localStorage.getItem(DOC_KEY(id));
  if (!raw) return null;
  try { return JSON.parse(raw) as MapState; } catch { return null; }
}

export function saveDoc(id: DocID, state: MapState) {
  localStorage.setItem(DOC_KEY(id), JSON.stringify(state));
  const idx = readIndex();
  const i = idx.findIndex(d => d.id === id);
  if (i !== -1) { idx[i] = { ...idx[i], updatedAt: now() }; writeIndex(idx); }
}

export function renameDoc(id: DocID, name: string) {
  const idx = readIndex();
  const i = idx.findIndex(d => d.id === id);
  if (i !== -1) { idx[i] = { ...idx[i], name, updatedAt: now() }; writeIndex(idx); }
}

export function duplicateDoc(id: DocID): DocID {
  const src = loadDoc(id);
  const nid = createDoc(`${listDocs().find(d=>d.id===id)?.name || "Copy"} (copy)`);
  if (src) saveDoc(nid, src);
  return nid;
}

export function deleteDoc(id: DocID) {
  localStorage.removeItem(DOC_KEY(id));
  writeIndex(readIndex().filter(d => d.id !== id));
}

export function exportDoc(id: DocID): string | null {
  const s = loadDoc(id);
  return s ? JSON.stringify(s, null, 2) : null;
}

export function importDoc(name: string, json: string): DocID {
  const id = createDoc(name);
  try {
    const parsed = JSON.parse(json) as MapState;
    saveDoc(id, parsed);
  } catch {/* if bad JSON we leave the empty doc */}
  return id;
}
