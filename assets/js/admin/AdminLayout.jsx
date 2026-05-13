import { useState, useRef } from "react";
import { api } from "../lib/api";
import { toast } from "../components/Toasts";
import { spaceColor } from "../lib/utils";
import { TB_BTNS, getAllToolbarButtons, setActiveToolbar } from "../components/RichTextArea";

const EXPLORE_ITEMS = [
  {id:"everything",    label:"Everything",    icon:"fa-border-all"},
  {id:"search",        label:"Search",        icon:"fa-magnifying-glass"},
  {id:"notifications", label:"Notifications", icon:"fa-bell",    authOnly:true},
  {id:"messages",      label:"Messages",      icon:"fa-message", authOnly:true},
  {id:"members",       label:"Members",       icon:"fa-users"},
  {id:"tags",          label:"Tags",          icon:"fa-tag"},
  {id:"leaderboard",   label:"Leaderboard",   icon:"fa-trophy"},
  {id:"badges",        label:"Badges",        icon:"fa-medal"},
];
const RIGHT_WIDGETS = [
  {id:"live_activity",   label:"Live Activity"},
  {id:"spaces_by_pulse", label:"Spaces by Pulse"},
  {id:"stats",           label:"Stats"},
];
const SIDEBAR_SECTIONS = [
  {id:"explore", label:"Explore"},
  {id:"spaces",  label:"Spaces"},
  {id:"you",     label:"You"},
];

// ── DragList, LayoutAdmin, ToolbarEditor ──────────────────────────────────────

// ── Simple drag-to-reorder list (reorder only, no hide/remove) ────────────────
function DragList({items, renderItem, onChange}) {
  var [dragging, setDragging] = React.useState(null);
  var [dragOver, setDragOver] = React.useState(null);

  function move(from, to) {
    if(from === to) return;
    var next = items.slice();
    var item = next.splice(from, 1)[0];
    next.splice(to, 0, item);
    onChange(next);
  }

  return React.createElement('div', {style:{display:"flex",flexDirection:"column",gap:4}},
    items.map(function(item, idx) {
      var isOver = dragOver === idx;
      var isDragging = dragging === idx;
      return React.createElement('div', {
        key: item.id || idx,
        draggable: true,
        onDragStart: function(e){e.dataTransfer.effectAllowed="move"; setDragging(idx);},
        onDragOver:  function(e){e.preventDefault(); setDragOver(idx);},
        onDragLeave: function(){setDragOver(null);},
        onDrop:      function(e){e.preventDefault(); if(dragging!==null) move(dragging,idx); setDragging(null); setDragOver(null);},
        onDragEnd:   function(){setDragging(null); setDragOver(null);},
        style:{
          display:"flex", alignItems:"center", gap:12, padding:"10px 14px",
          borderRadius:10, cursor:"grab",
          border:"0.5px solid "+(isOver?"var(--ac-border)":"var(--b1)"),
          background: isDragging?"rgba(255,255,255,0.01)": isOver?"var(--ac-bg)":"rgba(255,255,255,0.03)",
          opacity: isDragging ? 0.5 : 1,
          transition:"border-color .1s, background .1s"
        }
      },
        React.createElement('i',{className:"fa-solid fa-grip-vertical",style:{fontSize:11,color:"var(--t5)",flexShrink:0}}),
        renderItem(item, idx)
      );
    })
  );
}


// ── Layout admin with tabs ─────────────────────────────────────────────────────
function LayoutAdmin({layoutCfg, setLayoutCfg}) {
  var [tab, setTab] = React.useState("composer");

  function update(key, val) {
    var next = Object.assign({}, layoutCfg);
    next[key] = val;
    setLayoutCfg(next);
    if(key === "toolbar") setActiveToolbar(val);
    api.patch("/admin/settings/layout", {value: next}).catch(function(){});
  }

  // Get ordered list with defaults for any missing ids
  function orderedList(key, defaults) {
    var saved = layoutCfg[key];
    if(!saved || !saved.length) return defaults.slice();
    // Merge: keep saved order, append any new defaults not in saved
    var result = saved.map(function(s) {
      return defaults.find(function(d){return d.id===s.id;}) || s;
    });
    defaults.forEach(function(d) {
      if(!result.find(function(r){return r.id===d.id;})) result.push(d);
    });
    return result;
  }

  var TABS = [
    {id:"composer",  label:"Composer toolbar"},
    {id:"left",      label:"Left sidebar"},
    {id:"right",     label:"Right sidebar"},
  ];

  return React.createElement('div', null,
    // Tab bar
    React.createElement('div', {style:{display:"flex",gap:0,borderBottom:"0.5px solid var(--b1)",marginBottom:24}},
      TABS.map(function(t) {
        var active = tab === t.id;
        return React.createElement('button', {
          key: t.id,
          onClick: function(){setTab(t.id);},
          style:{
            padding:"10px 20px", background:"none", border:"none",
            borderBottom: active ? "2px solid var(--ac)" : "2px solid transparent",
            color: active ? "var(--ac-text)" : "var(--t4)",
            fontWeight: active ? 500 : 400,
            fontSize:13, cursor:"pointer", fontFamily:"inherit",
            marginBottom:-1, transition:"color .1s"
          }
        }, t.label);
      })
    ),

    // Composer tab
    tab === "composer" && React.createElement('div', null,
      React.createElement('div', {className:"page-sub"}, "Drag to reorder. Toggle to show or hide. Changes apply to all composers and reply boxes."),
      React.createElement(ToolbarEditor, {
        items: layoutCfg.toolbar || TB_BTNS,
        onChange: function(items){update("toolbar", items);}
      })
    ),

    // Left sidebar tab
    tab === "left" && React.createElement('div', null,
      React.createElement('div', {className:"fgt"}, "Section order"),
      React.createElement('div', {className:"page-sub"}, "Drag to reorder the sidebar sections. Moderation and Admin Panel always stay at the bottom."),
      React.createElement(DragList, {
        items: orderedList("sidebar_sections", SIDEBAR_SECTIONS),
        onChange: function(items){update("sidebar_sections", items);},
        renderItem: function(item) {
          return React.createElement('span', {style:{fontSize:13,color:"var(--t2)",fontWeight:500}}, item.label);
        }
      }),
      React.createElement('div', {className:"fgt", style:{marginTop:28}}, "Explore items"),
      React.createElement('div', {className:"page-sub"}, "Drag to reorder the items within the Explore section."),
      React.createElement(DragList, {
        items: orderedList("explore_items", [...EXPLORE_ITEMS, ...window.NexusExtensions.getExploreItems()]),
        onChange: function(items){update("explore_items", items);},
        renderItem: function(item, idx, allItems, onChange) {
          return React.createElement('div', {style:{display:"flex",alignItems:"center",gap:10,flex:1}},
            React.createElement('i', {className:"fa-solid "+item.icon, style:{fontSize:13,color:"var(--t4)",width:16,textAlign:"center"}}),
            React.createElement('span', {style:{fontSize:13,color:"var(--t2)",fontWeight:500}}, item.label),
            item.authOnly && React.createElement('span', {style:{fontSize:10,color:"var(--t5)",background:"rgba(255,255,255,0.05)",padding:"1px 7px",borderRadius:20,border:"0.5px solid var(--b1)"}}, "logged in only"),
            item._ext && React.createElement('span', {style:{fontSize:10,color:"var(--t5)",background:"rgba(167,139,250,0.06)",padding:"1px 7px",borderRadius:20,border:"0.5px solid rgba(167,139,250,0.2)"}}, "extension"),
            item._ext && React.createElement('button', {
              onClick: function(e){
                e.stopPropagation();
                var current = orderedList("explore_items", [...EXPLORE_ITEMS, ...window.NexusExtensions.getExploreItems()]);
                update("explore_items", current.filter(function(i){return i.id !== item.id;}));
              },
              style:{marginLeft:"auto",background:"none",border:"none",color:"var(--t5)",cursor:"pointer",padding:"2px 6px",fontSize:12,lineHeight:1},
              title:"Remove"
            }, React.createElement('i', {className:"fa-solid fa-xmark"}))
          );
        }
      })
    ),

    // Right sidebar tab
    tab === "right" && React.createElement('div', null,
      React.createElement('div', {className:"fgt"}, "Widget order"),
      React.createElement('div', {className:"page-sub"}, "Drag to reorder the widgets in the right sidebar."),
      React.createElement(DragList, {
        items: orderedList("right_widgets", [...RIGHT_WIDGETS, ...window.NexusExtensions.getRightWidgets()]),
        onChange: function(items){update("right_widgets", items);},
        renderItem: function(item) {
          return React.createElement('div', {style:{display:"flex",alignItems:"center",gap:10,flex:1}},
            React.createElement('span', {style:{fontSize:13,color:"var(--t2)",fontWeight:500}}, item.label),
            item._ext && React.createElement('span', {style:{fontSize:10,color:"var(--t5)",background:"rgba(167,139,250,0.06)",padding:"1px 7px",borderRadius:20,border:"0.5px solid rgba(167,139,250,0.2)"}}, "extension"),
            item._ext && React.createElement('button', {
              onClick: function(e){
                e.stopPropagation();
                var current = orderedList("right_widgets", [...RIGHT_WIDGETS, ...window.NexusExtensions.getRightWidgets()]);
                update("right_widgets", current.filter(function(i){return i.id !== item.id;}));
              },
              style:{marginLeft:"auto",background:"none",border:"none",color:"var(--t5)",cursor:"pointer",padding:"2px 6px",fontSize:12,lineHeight:1},
              title:"Remove"
            }, React.createElement('i', {className:"fa-solid fa-xmark"}))
          );
        }
      })
    )
  );
}

function ToolbarEditor({items, onChange}) {
  var [dragging, setDragging] = React.useState(null);
  var [dragOver, setDragOver] = React.useState(null);
  var list = items.map(function(item, i) {
    return Object.assign({}, item, {_id: item.type || ('sep-'+i)});
  });

  function move(fromIdx, toIdx) {
    if(fromIdx === toIdx) return;
    var next = list.slice();
    var item = next.splice(fromIdx, 1)[0];
    next.splice(toIdx, 0, item);
    onChange(next.map(function(x){var c=Object.assign({},x);delete c._id;return c;}));
  }

  function toggle(idx) {
    var next = list.map(function(x){return Object.assign({},x);});
    next[idx].hidden = !next[idx].hidden;
    onChange(next.map(function(x){var c=Object.assign({},x);delete c._id;return c;}));
  }

  function removeItem(idx) {
    var next = list.filter(function(_,i){return i!==idx;});
    onChange(next.map(function(x){var c=Object.assign({},x);delete c._id;return c;}));
  }

  function addSep() {
    var next = list.concat([{sep:true}]);
    onChange(next.map(function(x){var c=Object.assign({},x);delete c._id;return c;}));
  }

  function reset() {
    onChange(TB_BTNS);
    setActiveToolbar(null);
  }

  return (
    <div>
      <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:14}}>
        {list.map(function(item, idx){
          var isSep = !!item.sep;
          var isDraggingThis = dragging === idx;
          var isOver = dragOver === idx;
          return (
            <div key={item._id+idx}
              draggable={true}
              onDragStart={function(e){e.dataTransfer.effectAllowed="move";setDragging(idx);}}
              onDragOver={function(e){e.preventDefault();e.dataTransfer.dropEffect="move";setDragOver(idx);}}
              onDragLeave={function(){setDragOver(null);}}
              onDrop={function(e){e.preventDefault();if(dragging!==null)move(dragging,idx);setDragging(null);setDragOver(null);}}
              onDragEnd={function(){setDragging(null);setDragOver(null);}}
              style={{
                display:"flex",alignItems:"center",gap:12,padding:"10px 14px",
                borderRadius:10,border:"0.5px solid "+(isOver?"var(--ac-border)":"var(--b1)"),
                background:isDraggingThis?"rgba(255,255,255,0.02)":isOver?"var(--ac-bg)":"rgba(255,255,255,0.03)",
                cursor:"grab",opacity:item.hidden?0.45:1,transition:"border-color .1s,background .1s"
              }}>
              <i className="fa-solid fa-grip-vertical" style={{fontSize:11,color:"var(--t5)",flexShrink:0}}/>
              {isSep
                ? <div style={{flex:1,display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:24,height:16,borderRight:"1.5px solid var(--b2)",flexShrink:0}}/>
                    <span style={{fontSize:12,color:"var(--t4)"}}>Separator</span>
                  </div>
                : <div style={{flex:1,display:"flex",alignItems:"center",gap:10}}>
                    <div style={{minWidth:28,height:28,borderRadius:6,border:"0.5px solid var(--b1)",background:"rgba(255,255,255,0.04)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:item._ext?(item.color||"var(--ac)"):"var(--t3)",fontWeight:500,...(item.style||{})}}>
                      {item._ext ? React.createElement('i', {className:item.label, style:{fontSize:14}}) : item.label}
                    </div>
                    <div>
                      <div style={{fontSize:13,color:"var(--t2)",fontWeight:500}}>{item.tip}</div>
                      <div style={{fontSize:11,color:"var(--t5)",marginTop:1,fontFamily:"monospace"}}>{item._ext?"extension":item.type==="image"?"file upload":item.wrap?item.wrap[0]+(item.wrap[0]?'…':'')+(item.wrap[1]||''):''}</div>
                    </div>
                  </div>}
              {/* Toggle visible */}
              <button onClick={function(){toggle(idx);}} title={item.hidden?"Show":"Hide"}
                style={{background:"none",border:"none",cursor:"pointer",color:item.hidden?"var(--t5)":"var(--ac)",fontSize:14,padding:"2px 6px",borderRadius:6,flexShrink:0}}>
                <i className={"fa-solid "+(item.hidden?"fa-toggle-off":"fa-toggle-on")}/>
              </button>
              {/* Remove */}
              <button onClick={function(){removeItem(idx);}} title="Remove from toolbar"
                style={{background:"none",border:"none",cursor:"pointer",color:"var(--t5)",fontSize:12,padding:"2px 6px",borderRadius:6,flexShrink:0}}
                onMouseEnter={function(e){e.currentTarget.style.color="var(--red)";}}
                onMouseLeave={function(e){e.currentTarget.style.color="var(--t5)";}}>
                <i className="fa-solid fa-xmark"/>
              </button>
            </div>
          );
        })}
      </div>
      <div style={{display:"flex",gap:8}}>
        <button className="btn-ghost" style={{fontSize:12}} onClick={addSep}>
          <i className="fa-solid fa-grip-lines" style={{marginRight:6}}/>Add separator
        </button>
        <button className="btn-ghost" style={{fontSize:12,marginLeft:"auto",color:"var(--t4)"}} onClick={reset}>
          Reset to defaults
        </button>
      </div>
      {/* Live preview */}
      <div style={{marginTop:20}}>
        <div style={{fontSize:12,color:"var(--t4)",marginBottom:8}}>Preview</div>
        <div className="reply-box" style={{pointerEvents:"none",opacity:0.8}}>
          <div className="comp-toolbar">
            {list.filter(function(b){return !b.hidden;}).map(function(b,i){
              return b.sep
                ? React.createElement('div',{key:"sep"+i,className:"comp-tb-sep"})
                : React.createElement('button',{key:b.type+i,className:"comp-tb-btn",style:b.style||{}},b.label);
            })}
            <div style={{flex:1}}/>
            <button className="comp-tb-btn" style={{opacity:0.6}}><i className="fa-regular fa-eye" style={{fontSize:16}}/></button>
          </div>
        </div>
      </div>
    </div>
  );
}


// ── Exports ──────────────────────────────────────────────────────────────────
export { DragList, LayoutAdmin, ToolbarEditor };
