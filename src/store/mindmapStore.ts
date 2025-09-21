import { useSyncExternalStore } from "react";

export type NodeID = string;
export type NodeShape = "rounded" | "rect" | "ellipse" | "diamond";

export interface MMNode {
  id: NodeID;
  text: string;
  x: number;
  y: number;
  parentId?: NodeID;
  color?: string;
  shape?: NodeShape;
  collapsed?: boolean;
}

export interface MMEdge { id: string; source: NodeID; target: NodeID; kind: "tree" | "link"; }
export interface MapState { nodes: Record<NodeID, MMNode>; links: MMEdge[]; rootId: NodeID; }

const STORAGE_KEY = "mindmap:v1";
const VERSION = 1;

/* ---------- persistence ---------- */
function loadInitial(): MapState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== VERSION || !parsed?.state?.nodes) return null;
    return parsed.state as MapState;
  } catch { return null; }
}

const persist = (() => {
  let t: number | undefined;
  return (state: MapState) => {
    if (t) window.clearTimeout(t);
    t = window.setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, state })); } catch {}
    }, 150);
  };
})();

/* ---------- store ---------- */
class Store {
  private state: MapState;
  private listeners = new Set<() => void>();
  constructor(initial: MapState) { this.state = initial; }
  getState = () => this.state;
  setState = (updater: MapState | ((s: MapState) => MapState)) => {
    const next = typeof updater === "function" ? (updater as any)(this.state) : updater;
    this.state = next;
    persist(this.state);
    this.listeners.forEach(l => l());
  };
  subscribe = (cb: () => void) => { this.listeners.add(cb); return () => this.listeners.delete(cb); };
}

/* ---------- helpers ---------- */
export const uid = () => Math.random().toString(36).slice(2, 9);
export const childrenOf = (s: MapState, id: NodeID) => Object.values(s.nodes).filter(n => n.parentId === id);
export function subtreeIds(s: MapState, id: NodeID): Set<NodeID> {
  const out = new Set<NodeID>(); const st: NodeID[] = [id];
  while (st.length) { const cur = st.pop()!; out.add(cur); childrenOf(s, cur).forEach(c => st.push(c.id)); }
  return out;
}
export const wouldCreateCycle = (s: MapState, child: NodeID, parent: NodeID) => subtreeIds(s, child).has(parent);
export const computeTreeEdges = (s: MapState): MMEdge[] =>
  Object.values(s.nodes).flatMap(n => n.parentId ? [{ id:`t-${n.id}`, source:n.parentId, target:n.id, kind:"tree" as const }] : []);
export function autoLayout(s: MapState, levelGap=220, nodeGap=90): MapState {
  const root = s.nodes[s.rootId]; if (!root) return s;
  const levels: NodeID[][] = []; const q:[NodeID,number][]= [[root.id,0]]; const seen=new Set<NodeID>();
  while(q.length){ const [id,d]=q.shift()!; if(seen.has(id)) continue; seen.add(id);
    (levels[d]??=[]).push(id); childrenOf(s,id).forEach(c=>q.push([c.id,d+1])); }
  const nodes = {...s.nodes};
  levels.forEach((ids,d)=>{ const total=(ids.length-1)*nodeGap;
    ids.forEach((nid,i)=>{ const n=nodes[nid]; nodes[nid]={...n,x:d*levelGap,y:-total/2+i*nodeGap}; });});
  return {...s, nodes};
}
export const commitEditPure = (s: MapState, id: NodeID, text: string): MapState =>
  s.nodes[id] ? ({...s, nodes:{...s.nodes, [id]:{...s.nodes[id], text}}}) : s;

export const commitStylePure = (s: MapState, id: NodeID, patch: Partial<Pick<MMNode,"color"|"shape">>): MapState =>
  s.nodes[id] ? ({...s, nodes:{...s.nodes, [id]:{...s.nodes[id], ...patch}}}) : s;

/* ---------- bootstrap ---------- */
function demoInitial(): MapState {
  const r=uid(), a=uid(), b=uid(), c=uid();
  const nodes: Record<NodeID,MMNode> = {
    [r]: { id:r, text:"Exam Plan", x:0, y:0, color:"#fde68a", shape:"rounded" },
    [a]: { id:a, text:"Topics", x:200, y:-110, parentId:r, color:"#bfdbfe", shape:"rounded" },
    [b]: { id:b, text:"Schedule", x:200, y:0, parentId:r, color:"#bbf7d0", shape:"rounded" },
    [c]: { id:c, text:"Resources", x:200, y:110, parentId:r, color:"#fecaca", shape:"rounded" },
  };
  return { nodes, links: [], rootId:r };
}

const persisted = typeof window !== "undefined" ? loadInitial() : null;
const initial = autoLayout(persisted ?? demoInitial());
const internalStore = new Store(initial);

/* ---------- public API ---------- */
export function useMindmapSelector<T>(selector: (s: MapState)=>T): T {
  return useSyncExternalStore(internalStore.subscribe, () => selector(internalStore.getState()));
}
export const setStore = (updater: MapState | ((s: MapState)=>MapState)) => internalStore.setState(updater);
export const getStore = () => internalStore.getState();
