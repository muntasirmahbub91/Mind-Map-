import React, { useEffect, useRef, useState } from "react";
import "../styles/mindmap.css";
import {
  useMindmapSelector, setStore, getStore,
  childrenOf, subtreeIds, wouldCreateCycle, computeTreeEdges, autoLayout,
  commitEditPure, commitStylePure, uid,
  type MapState, type NodeID, type NodeShape, type MMNode, type MMEdge,
} from "../store/mindmapStore";

type Props = { onSave?: () => void; onExit?: () => void };

/* --- color helpers (auto-lighten by depth) --- */
const clamp = (v:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,v));
const hexToRgb=(hex:string)=>{const h=hex.startsWith("#")?hex.slice(1):hex;if(h.length!==6)return null;
  const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
  if([r,g,b].some(Number.isNaN))return null;return{r,g,b};};
const rgbToHex=(r:number,g:number,b:number)=>"#"+[r,g,b].map(n=>clamp(Math.round(n),0,255).toString(16).padStart(2,"0")).join("");
const lightenHex=(hex:string,amt:number)=>{const c=hexToRgb(hex);if(!c)return hex;return rgbToHex(c.r+(255-c.r)*amt,c.g+(255-c.g)*amt,c.b+(255-c.b)*amt);};
function effectiveColor(s:MapState,id:NodeID){ const n=s.nodes[id]; if(n.color) return n.color;
  let cur=n.parentId? s.nodes[n.parentId]:undefined, depth=1;
  while(cur){ if(cur.color){ const amt=clamp(0.12*depth,0,0.6); return lightenHex(cur.color,amt); }
    cur=cur.parentId? s.nodes[cur.parentId]:undefined; depth++; }
  return "#ffffff";
}

export default function MindMap({ onSave, onExit }: Props){
  const state = useMindmapSelector(s=>s);

  const [sel,setSel]=useState<NodeID|null>(state.rootId);
  const [connectFrom,setConnectFrom]=useState<NodeID|null>(null);
  const [editing,setEditing]=useState<NodeID|null>(null);
  const [draft,setDraft]=useState("");
  const [pan,setPan]=useState({x:120,y:120});
  const [zoom,setZoom]=useState(1);
  const [draggingId,setDraggingId]=useState<NodeID|null>(null);

  const svgRef=useRef<SVGSVGElement|null>(null);
  const dragRef=useRef<{id:NodeID;ox:number;oy:number}|null>(null);
  const panningRef=useRef<{ox:number;oy:number}|null>(null);
  const jsonFileRef=useRef<HTMLInputElement|null>(null);
  const mdFileRef=useRef<HTMLInputElement|null>(null);

  useEffect(()=>{ if(editing) setDraft(state.nodes[editing]?.text ?? ""); },[editing,state.nodes]);

  const toWorld=(cx:number,cy:number)=>{ const r=svgRef.current?.getBoundingClientRect();
    const sx=cx-(r?.left??0), sy=cy-(r?.top??0); return { x:(sx-pan.x)/zoom, y:(sy-pan.y)/zoom }; };
  const worldToScreen=(x:number,y:number,z=zoom)=>({ x:x*z+pan.x, y:y*z+pan.y });

  function onNodeMouseDown(e:React.MouseEvent,id:NodeID){ e.stopPropagation();
    const pt=toWorld(e.clientX,e.clientY); const n=state.nodes[id];
    dragRef.current={id,ox:n.x-pt.x,oy:n.y-pt.y}; setDraggingId(id); setSel(id); }
  function onBgMouseDown(e:React.MouseEvent){ const pt={x:e.clientX,y:e.clientY}; panningRef.current={ox:pan.x-pt.x,oy:pan.y-pt.y}; setSel(null); }
  function onMouseMove(e:React.MouseEvent){
    if(dragRef.current){ const {id,ox,oy}=dragRef.current; const pt=toWorld(e.clientX,e.clientY);
      setStore(s=>({...s,nodes:{...s.nodes,[id]:{...s.nodes[id],x:pt.x+ox,y:pt.y+oy}}})); }
    else if(panningRef.current){ const {ox,oy}=panningRef.current; setPan({x:e.clientX+ox,y:e.clientY+oy}); }
  }
  function onMouseUp(){ dragRef.current=null; panningRef.current=null; setDraggingId(null); }
  function onWheel(e:React.WheelEvent){
    const delta=-e.deltaY, factor=delta>0?1.05:0.95, mouse=toWorld(e.clientX,e.clientY);
    setZoom(z=>{ const nz=Math.min(2.5,Math.max(0.3,z*factor));
      const before=worldToScreen(mouse.x,mouse.y,z), after=worldToScreen(mouse.x,mouse.y,nz);
      setPan(p=>({x:p.x+(before.x-after.x), y:p.y+(before.y-after.y)})); return nz; });
  }

  function addNode(){ const id=uid();
    const n:MMNode={id,text:"New node",x:0,y:0,color:"#e5e7eb",shape:"rounded"};
    setStore(s=>({...s,nodes:{...s.nodes,[id]:n}})); setSel(id); setEditing(id); }
  function addChild(){ const pid=sel??state.rootId, id=uid(), p=state.nodes[pid];
    const n:MMNode={id,text:"Child",x:p.x+170,y:p.y,parentId:pid,color:"#e0e7ff",shape:"rounded"};
    setStore(s=>({...s,nodes:{...s.nodes,[id]:n}})); setSel(id); setEditing(id); }
  function deleteNode(){ if(!sel||sel===state.rootId) return;
    setStore(s=>{ const ids=Array.from(subtreeIds(s,sel)); const nodes={...s.nodes}; ids.forEach(id=>delete nodes[id]);
      const links=s.links.filter(l=>!ids.includes(l.source)&&!ids.includes(l.target)); return {...s,nodes,links}; });
    setSel(null);
  }
  function toggleCollapse(id?:NodeID){ const nid=id??sel; if(!nid) return;
    setStore(s=>({...s,nodes:{...s.nodes,[nid]:{...s.nodes[nid],collapsed:!s.nodes[nid].collapsed}}})); }
  function setParent(child:NodeID,parent:NodeID){ if(child===parent||wouldCreateCycle(state,child,parent)) return;
    setStore(s=>({...s,nodes:{...s.nodes,[child]:{...s.nodes[child],parentId:parent}}})); }
  function startLink(){ if(!sel) return; setConnectFrom(sel); }
  function completeLink(target:NodeID){ if(!connectFrom||connectFrom===target) return;
    const id=`l-${uid()}`; setStore(s=>({...s,links:[...s.links,{id,source:connectFrom,target,kind:"link"}]})); setConnectFrom(null); }
  function makeParent(targetParent:NodeID){ if(!sel) return; setParent(sel,targetParent); }
  function relayout(){ setStore(s=>autoLayout(s)); }

  function setNodeColor(id:NodeID,color:string){ setStore(s=>commitStylePure(s,id,{color})); }
  function setNodeShape(id:NodeID,shape:NodeShape){ setStore(s=>commitStylePure(s,id,{shape})); }

  function commitEdit(id:NodeID,text:string){ setStore(s=>commitEditPure(s,id,text)); setEditing(null); setDraft(""); }
  function cancelEdit(){ setEditing(null); setDraft(""); }

  useEffect(()=>{ const onKey=(e:KeyboardEvent)=>{
      if(e.key==="Delete"||e.key==="Backspace") deleteNode();
      if(e.key==="Enter"&&sel) setEditing(sel);
      if(e.key==="Escape"){ setConnectFrom(null); setEditing(null); }
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="a"){ e.preventDefault(); addNode(); }
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){ e.preventDefault(); onSave?.(); }
    };
    window.addEventListener("keydown",onKey); return ()=>window.removeEventListener("keydown",onKey);
  },[sel,onSave]);

  const edges:MMEdge[]=[...computeTreeEdges(state),...state.links];

  const exportJson=()=>{ const payload=JSON.stringify(getStore(),null,2);
    const blob=new Blob([payload],{type:"application/json"}); const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download="mindmap.json"; a.click(); URL.revokeObjectURL(url); };
  const importJsonClick=()=>jsonFileRef.current?.click();
  const onImportJson=(e:React.ChangeEvent<HTMLInputElement>)=>{
    const f=e.target.files?.[0]; if(!f) return; const r=new FileReader();
    r.onload=()=>{ try{ const obj=JSON.parse(String(r.result)); if(!obj.nodes||!obj.rootId) throw new Error(); setStore(obj); }
      catch{ alert("Invalid mindmap JSON"); } }; r.readAsText(f); e.currentTarget.value=""; };

  // Import indented Markdown: "- item", "  - child", "    - grandchild", etc.
  const importMdClick=()=>mdFileRef.current?.click();
  const onImportMd=(e:React.ChangeEvent<HTMLInputElement>)=>{
    const f=e.target.files?.[0]; if(!f) return; const r=new FileReader();
    r.onload=()=>{ try{ setStore(mdToState(String(r.result||""))); } catch(err:any){ alert("Markdown import failed: "+(err?.message||String(err))); } };
    r.readAsText(f); e.currentTarget.value=""; };
  function mdToState(md:string):MapState{
    const lines=md.replace(/\r/g,"").split("\n"); const nodes:Record<NodeID,MMNode>={}; const stack:NodeID[]=[]; const roots:NodeID[]=[];
    const bullet=/^\s*(?:[-*+]|\d+\.)\s+(.*)$/; const normIndent=(s:string)=>{ const exp=s.replace(/\t/g,"  "); const m=exp.match(/^(\s*)/)!; return Math.floor((m[1]||"").length/2); };
    const clean=(s:string)=>s.replace(/^\s*\[(?: |x|X)\]\s*/,"").trim();
    for(const raw of lines){ if(!raw.trim()||raw.trim().startsWith("```")) continue; const m=raw.match(bullet); if(!m) continue;
      const level=normIndent(raw); const text=clean(m[1]||""); if(!text) continue; while(stack.length>level) stack.pop();
      const id=uid(); const node:MMNode={id,text,x:0,y:0}; if(stack.length) node.parentId=stack[stack.length-1]; else roots.push(id);
      nodes[id]=node; stack.push(id); }
    if(Object.keys(nodes).length===0){ const r=uid(); nodes[r]={id:r,text:"Imported",x:0,y:0}; return autoLayout({nodes,links:[],rootId:r}); }
    let rootId:NodeID; if(roots.length===1){ rootId=roots[0]; } else { rootId=uid(); nodes[rootId]={id:rootId,text:"Imported",x:0,y:0}; for(const rid of roots) nodes[rid]={...nodes[rid],parentId:rootId}; }
    return autoLayout({nodes,links:[],rootId});
  }

  return (
    <div className="mm-root">
      {/* Fixed toolbar with named buttons + Style controls */}
      <div className="top-toolbar">
        <div className="toolbar-group">
          <button className="btn" onClick={addNode}>New node</button>
          <button className="btn" onClick={addChild}>New child</button>
          <button className={`btn ${connectFrom?"active":""}`} onClick={startLink}>Start link</button>
          <button className="btn" onClick={()=>toggleCollapse()}>Collapse/Expand</button>
          <button className="btn" onClick={deleteNode}>Delete</button>
          <button className="btn" onClick={relayout}>Auto layout</button>
        </div>

        <div className="toolbar-group">
          <span className="zoom-label">Style</span>
          <label className="style-item">Color
            <input
              disabled={!sel}
              type="color"
              value={(sel && state.nodes[sel]?.color) || "#ffffff"}
              onChange={(e)=> sel && setNodeColor(sel, e.target.value)}
            />
          </label>
          <label className="style-item">Shape
            <select
              disabled={!sel}
              value={(sel && (state.nodes[sel]?.shape || "rounded")) || "rounded"}
              onChange={(e)=> sel && setNodeShape(sel, e.target.value as NodeShape)}
            >
              <option value="rounded">Rounded</option>
              <option value="rect">Rectangle</option>
              <option value="ellipse">Ellipse</option>
              <option value="diamond">Diamond</option>
            </select>
          </label>
        </div>

        <div className="toolbar-group">
          <button className="btn" onClick={exportJson}>Export JSON</button>
          <button className="btn" onClick={importJsonClick}>Import JSON</button>
          <input ref={jsonFileRef} type="file" accept="application/json" onChange={onImportJson} hidden />
          <button className="btn" onClick={importMdClick}>Import Markdown</button>
          <input ref={mdFileRef} type="file" accept=".md,.markdown,.txt" onChange={onImportMd} hidden />
        </div>

        <div className="toolbar-group">
          <label className="zoom-label">Zoom</label>
          <input className="zoom-range" type="range" min={0.3} max={2.5} step={0.01}
                 value={zoom} onChange={e=>setZoom(parseFloat(e.target.value))}/>
          <button className="btn" onClick={()=>{ setPan({x:120,y:120}); setZoom(1); }}>Reset</button>
        </div>

        {(onSave||onExit) && (
          <div className="toolbar-group">
            {onSave && <button className="btn" onClick={onSave}>Save</button>}
            {onExit && <button className="btn" onClick={()=>{ onSave?.(); onExit(); }}>Back to home</button>}
          </div>
        )}
      </div>

      {/* Canvas: only this pans/zooms */}
      <div className="canvas" onMouseMove={onMouseMove} onMouseUp={onMouseUp}>
        <svg ref={svgRef} className="svg" onMouseDown={onBgMouseDown} onWheel={onWheel}>
          <defs>
            <pattern id="grid" width={40} height={40} patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e5e7eb" strokeWidth="1"/>
            </pattern>
            <marker id="arrow" markerWidth="10" markerHeight="10" refX="10" refY="3" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M0,0 L10,3 L0,6 Z" fill="#0ea5e9"/>
            </marker>
          </defs>
          <rect x={0} y={0} width="100%" height="100%" fill="url(#grid)"/>
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {edges.map(e=>{
              const s=state.nodes[e.source], t=state.nodes[e.target];
              if(!s||!t) return null;
              if(state.nodes[e.source]?.collapsed && e.kind==="tree") return null;
              const dx=t.x-s.x, mx=s.x+dx/2;
              const d=`M ${s.x} ${s.y} C ${mx} ${s.y}, ${mx} ${t.y}, ${t.x} ${t.y}`;
              const stroke=e.kind==="tree" ? "#94a3b8" : "#0ea5e9";
              return <path key={e.id} d={d} fill="none" stroke={stroke} strokeOpacity={0.7} strokeWidth={2} vectorEffect="non-scaling-stroke" markerEnd={e.kind==="link"?"url(#arrow)":undefined}/>;
            })}

            {Object.values(state.nodes).map(n=>{
              if(n.parentId && state.nodes[n.parentId]?.collapsed) return null;
              const isSel=n.id===sel, hasKids=childrenOf(state,n.id).length>0;
              const fill=effectiveColor(state,n.id), border=isSel?"#0f172a":"#cbd5e1", strokeW=isSel?2.5:1.5;
              const shape=n.shape||"rounded", W=144, H=48, RX=14, RY=14;

              const Shape= shape==="rect"
                ? <rect className={`node-card ${isSel?"selected":""}`} x={-W/2} y={-H/2} width={W} height={H} fill={fill} stroke={border} strokeWidth={strokeW}/>
                : shape==="ellipse"
                ? <ellipse className={`node-card ${isSel?"selected":""}`} cx={0} cy={0} rx={W/2} ry={H/2} fill={fill} stroke={border} strokeWidth={strokeW}/>
                : shape==="diamond"
                ? <polygon className={`node-card ${isSel?"selected":""}`} points={`0,${-H/2} ${W/2},0 0,${H/2} ${-W/2},0`} fill={fill} stroke={border} strokeWidth={strokeW}/>
                : <rect className={`node-card ${isSel?"selected":""}`} x={-W/2} y={-H/2} width={W} height={H} rx={RX} ry={RY} fill={fill} stroke={border} strokeWidth={strokeW}/>;

              return (
                <g key={n.id} transform={`translate(${n.x},${n.y})`} onMouseDown={(e)=>onNodeMouseDown(e,n.id)} className={`node-wrap ${draggingId===n.id?"dragging":""}`}>
                  {isSel && (<rect x={-78} y={-30} width={156} height={60} rx={16} ry={16} fill="#60a5fa" opacity={0.2}/>)}
                  {Shape}

                  {hasKids && (
                    <g onClick={e=>{ e.stopPropagation(); toggleCollapse(n.id); }} className="cursor-pointer">
                      <rect className="badge" x={-90} y={-10} width={20} height={20} rx={6} ry={6}/>
                      <text x={-80} y={5} textAnchor="middle" fontSize={12} fill="#fff">{n.collapsed?"+":"−"}</text>
                    </g>
                  )}

                  {sel && sel!==n.id && (
                    <g onClick={e=>{ e.stopPropagation(); makeParent(targetParent=n.id); }} className="cursor-pointer">
                      <rect className="badge-green" x={70} y={-10} width={20} height={20} rx={6} ry={6}/>
                      <text x={80} y={5} textAnchor="middle" fontSize={12} fill="#fff">P</text>
                    </g>
                  )}

                  {editing===n.id ? (
                    <foreignObject x={-66} y={-18} width={132} height={36}>
                      <input
                        autoFocus aria-label="Edit node text" className="edit-input"
                        value={draft}
                        onChange={(e)=> setDraft(e.currentTarget ? e.currentTarget.value : draft)}
                        onBlur={()=>commitEdit(n.id,draft)}
                        onKeyDown={(e)=>{ if(e.key==="Enter"){ e.preventDefault(); commitEdit(n.id,draft); } if(e.key==="Escape"){ e.preventDefault(); cancelEdit(); } }}
                      />
                    </foreignObject>
                  ) : (
                    <text x={0} y={4} textAnchor="middle" className="node-text" onDoubleClick={()=>setEditing(n.id)}>{n.text}</text>
                  )}

                  {connectFrom && connectFrom!==n.id && (
                    <g onClick={e=>{ e.stopPropagation(); completeLink(n.id); }} className="cursor-pointer">
                      <rect x={-8} y={-42} width={16} height={16} rx={4} ry={4} fill="#0ea5e9"/>
                      <text x={0} y={-30} textAnchor="middle" fontSize={10} fill="#fff">L</text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        <div className="tip">
          <div className="tip-title">Tips</div>
          <ul className="tip-list">
            <li>Drag background to pan. Mouse wheel to zoom.</li>
            <li>Click a node to select. Enter to edit. Delete to remove.</li>
            <li>Child branches from selection. Link creates cross-links.</li>
            <li>Green P re-parents the selection.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
