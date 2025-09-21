// src/store/mindmapStore.ts
// LocalStorage-backed store with subscribe/select. No React imports.

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

export interface MMEdge {
  id: string;
  source: NodeID;
  target: NodeID;
  kind: "tree" | "link";
}

export interface MapState {
  nodes: Record<NodeID, MMNode>;
  links: MMEdge[];           // cross-links only; tree edges are implicit
  rootId: NodeID;
}

const STORAGE_KEY = "mindmap:v1";
const VERSION = 1;

// ---------- persistence ----------
function loadInitialState(): MapState | null {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== VERSION || !parsed?.state?.nodes) return null;
    return parsed.state as MapState;
  } catch {
    return null;
  }
}

function makeDebouncedSaver() {
  let t: number | undefined;
  return (state: MapState) => {
    if (t) window.clearTimeout(t);
    t = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, state }));
      } catch {
        // ignore quota or privacy mode
      }
    }, 120);
  };
}
const persist = makeDebouncedSaver();

// ---------- store core ----------
class Store {
  private state: MapState;
  private listeners = new Set<() => void>();
  constructor(initial: MapState) { this.state = initial; }
  getState = () => this.state;
  setState = (updater: MapState | ((s: MapState) => MapState)) => {
    const next = typeof updater === "function" ? (updater as (s: MapState) => MapState)(this.state) : updater;
    this.state = next;
    persist(this.state);
    this.listeners.forEach(l => l());
  };
  subscribe = (cb: () => void) => { this.listeners.add(cb); return () => this.listeners.delete(cb); };
}

// ---------- helpers ----------
export const uid = () => Math.random().toString(36).slice(2, 9);

export const childrenOf = (state: MapState, id: NodeID) =>
  Object.values(state.nodes).filter(n => n.parentId === id);

export function subtreeIds(state: MapState, id: NodeID): Set<NodeID> {
  const out = new Set<NodeID>();
  const stack: NodeID[] = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue;
    out.add(cur);
    childrenOf(state, cur).forEach(c => stack.push(c.id));
  }
  return out;
}

export function wouldCreateCycle(state: MapState, childId: NodeID, parentId: NodeID): boolean {
  return subtreeIds(state, childId).has(parentId);
}

export function computeTreeEdges(state: MapState): MMEdge[] {
  const edges: MMEdge[] = [];
  Object.values(state.nodes).forEach(n => {
    if (n.parentId) edges.push({ id: `t-${n.id}`, source: n.parentId, target: n.id, kind: "tree" });
  });
  return edges;
}

/**
 * Simple layered layout. Places nodes by BFS depth (x) and distributes siblings (y).
 * levelGap = horizontal spacing per depth. nodeGap = vertical spacing between siblings.
 */
export function autoLayout(state: MapState, levelGap = 220, nodeGap = 90): MapState {
  const root = state.nodes[state.rootId];
  if (!root) return state;

  const levels: NodeID[][] = [];
  const q: { id: NodeID; depth: number }[] = [{ id: state.rootId, depth: 0 }];
  const seen = new Set<NodeID>();

  while (q.length) {
    const { id, depth } = q.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    (levels[depth] ||= []).push(id);
    childrenOf(state, id).forEach(c => q.push({ id: c.id, depth: depth + 1 }));
  }

  const nodes = { ...state.nodes };
  levels.forEach((ids, depth) => {
    const total = (ids.length - 1) * nodeGap;
    ids.forEach((nid, i) => {
      const n = nodes[nid];
      nodes[nid] = { ...n, x: depth * levelGap, y: -total / 2 + i * nodeGap };
    });
  });

  return { ...state, nodes };
}

// immutable edits
export function commitEditPure(state: MapState, nodeId: NodeID, text: string): MapState {
  if (!state.nodes[nodeId]) return state;
  return { ...state, nodes: { ...state.nodes, [nodeId]: { ...state.nodes[nodeId], text } } };
}

export function commitStylePure(
  state: MapState,
  nodeId: NodeID,
  patch: Partial<Pick<MMNode, "color" | "shape">>
): MapState {
  if (!state.nodes[nodeId]) return state;
  return { ...state, nodes: { ...state.nodes, [nodeId]: { ...state.nodes[nodeId], ...patch } } };
}

// ---------- initial demo ----------
function demoInitial(): MapState {
  const rootId = uid();
  const a = uid(), b = uid(), c = uid();
  const nodes: Record<NodeID, MMNode> = {
    [rootId]: { id: rootId, text: "Root idea", x: 0, y: 0, color: "#fde68a", shape: "rounded" },
    [a]: { id: a, text: "First branch",  x: 200, y: -110, parentId: rootId, color: "#bfdbfe", shape: "rounded" },
    [b]: { id: b, text: "Second branch", x: 200, y:   0,  parentId: rootId, color: "#bbf7d0", shape: "rounded" },
    [c]: { id: c, text: "Third branch",  x: 200, y: 110,  parentId: rootId, color: "#fecaca", shape: "rounded" },
  };
  return { nodes, links: [], rootId };
}

// ---------- exported store singletons ----------
const persisted = typeof window !== "undefined" ? loadInitialState() : null;
export const mindmapStore = new Store(autoLayout(persisted ?? demoInitial()));

export function getStore() { return mindmapStore.getState(); }
export function setStore(updater: MapState | ((s: MapState) => MapState)) { mindmapStore.setState(updater); }

// React selector hook lives in the component file via useSyncExternalStore.
// To keep this file framework-agnostic, expose subscribe only:
export function subscribeStore(cb: () => void) { return mindmapStore.subscribe(cb); }
