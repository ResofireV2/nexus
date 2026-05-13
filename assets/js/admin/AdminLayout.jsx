import { useState, useRef, useEffect } from "react";
import { api } from "../lib/api";
import { toast } from "../components/Toasts";
import { spaceColor } from "../lib/utils";
import { Toggle } from "../components/Select";
import { TB_BTNS, getAllToolbarButtons, setActivePostToolbar, setActiveReplyToolbar } from "../components/RichTextArea";

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

// Built-in right sidebar widgets — mirrors the RIGHT_WIDGETS in nexus.jsx.
// Used by AdminLayout to know what widgets exist and their default page scope.
const RIGHT_WIDGETS = [
  {id:"post_author",       label:"Post Author",      pages:["post"]},
  {id:"post_participants", label:"Participants",      pages:["post"]},
  {id:"post_related",      label:"Related Posts",     pages:["post"]},
  {id:"leaderboard_panel", label:"Leaderboard Panel", pages:["leaderboard"]},
  {id:"badges_panel",      label:"Badges Panel",      pages:["badges"]},
  {id:"search_filters",    label:"Search Filters",    pages:["search"]},
  {id:"live_activity",     label:"Live Activity",     pages:"global"},
  {id:"spaces_by_pulse",   label:"Spaces by Pulse",   pages:["feed"]},
  {id:"stats",             label:"Stats",             pages:"global"},
];

// Core Nexus pages that appear as sections in the right sidebar layout.
const CORE_PAGES = [
  {id:"feed",          label:"Feed"},
  {id:"post",          label:"Post"},
  {id:"profile",       label:"Profile"},
  {id:"members",       label:"Members"},
  {id:"leaderboard",   label:"Leaderboard"},
  {id:"badges",        label:"Badges"},
  {id:"search",        label:"Search"},
  {id:"notifications", label:"Notifications"},
  {id:"messages",      label:"Messages"},
  {id:"saved",         label:"Saved"},
  {id:"drafts",        label:"Drafts"},
];

const SIDEBAR_SECTIONS = [
  {id:"explore", label:"Explore"},
  {id:"spaces",  label:"Spaces"},
  {id:"you",     label:"You"},
];

// ── DragList ──────────────────────────────────────────────────────────────────
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

// ── WidgetDragList — drag-reorder + toggle for right sidebar widgets ───────────
function WidgetDragList({items, onChange}) {
  var [dragging, setDragging] = React.useState(null);
  var [dragOver, setDragOver] = React.useState(null);

  function move(from, to) {
    if(from === to) return;
    var next = items.slice();
    var item = next.splice(from, 1)[0];
    next.splice(to, 0, item);
    onChange(next);
  }

  function toggle(idx) {
    var next = items.map(function(x){return Object.assign({},x);});
    next[idx].hidden = !next[idx].hidden;
    onChange(next);
  }

  return React.createElement('div', {style:{display:"flex",flexDirection:"column",gap:4}},
    items.map(function(item, idx) {
      var isOver = dragOver === idx;
      var isDragging = dragging === idx;
      return React.createElement('div', {
        key: item.id,
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
        React.createElement('span',{style:{flex:1,fontSize:13,color:item.hidden?"var(--t5)":"var(--t2)",fontWeight:500}}, item.label),
        item._ext && React.createElement('span',{style:{fontSize:10,color:"var(--t5)",background:"rgba(167,139,250,0.06)",padding:"1px 7px",borderRadius:20,border:"0.5px solid rgba(167,139,250,0.2)"}}, "extension"),
        React.createElement(Toggle, {
          value: !item.hidden,
          onChange: function(v){ toggle(idx); }
        })
      );
    })
  );
}

// ── LayoutAdmin ───────────────────────────────────────────────────────────────
function LayoutAdmin({layoutCfg, setLayoutCfg}) {
  var [tab, setTab] = React.useState("post_toolbar");
  var [expandedPages, setExpandedPages] = React.useState({feed: true});
  var layoutCfgRef = useRef(layoutCfg);
  layoutCfgRef.current = layoutCfg;

  // Register save function with topbar Save Changes button
  useEffect(function() {
    window._nexusAdminSaveFn = function() {
      return api.patch("/admin/settings/layout", {value: layoutCfgRef.current})
        .then(function(){ toast("Layout saved"); });
    };
    return function() {
      if(window._nexusAdminSaveFn === window._nexusAdminSaveFn) {
        window._nexusAdminSaveFn = null;
      }
    };
  }, []);

  function markDirty() {
    if(window._nexusAdminSetDirty) window._nexusAdminSetDirty();
  }

  function rehydrate(items) {
    var live = getAllToolbarButtons();
    return items.map(function(item) {
      if(!item._ext) return item;
      var liveBtn = live.find(function(l){ return l.type === item.type; });
      if(!liveBtn) return item;
      return Object.assign({}, item, {onClick: liveBtn.onClick});
    });
  }

  function update(key, val) {
    var next = Object.assign({}, layoutCfg);
    next[key] = val;
    setLayoutCfg(next);
    if(key === "post_toolbar")  setActivePostToolbar(rehydrate(val));
    if(key === "reply_toolbar") setActiveReplyToolbar(rehydrate(val));
    markDirty();
  }

  // ── Toolbar helpers ──────────────────────────────────────────────────────
  function seedToolbar(scope_key) {
    return getAllToolbarButtons().map(function(btn) {
      if(btn.sep) return btn;
      var scope = btn.scope || "both";
      var hidden = btn.hidden || false;
      if(scope_key === "post"  && scope === "replies") hidden = true;
      if(scope_key === "reply" && scope === "posts")   hidden = true;
      var out = Object.assign({}, btn);
      out.hidden = hidden;
      return out;
    });
  }

  function getToolbar(key, scope_key) {
    var saved = layoutCfg[key];
    if(!saved || !saved.length) return seedToolbar(scope_key);
    var all = getAllToolbarButtons();
    var result = saved.slice();
    all.forEach(function(def) {
      if(def.sep) return;
      var exists = saved.some(function(s){ return s.type === def.type; });
      if(!exists) {
        var scope = def.scope || "both";
        var hidden = false;
        if(scope_key === "post"  && scope === "replies") hidden = true;
        if(scope_key === "reply" && scope === "posts")   hidden = true;
        result.push(Object.assign({}, def, {hidden: hidden}));
      }
    });
    return result;
  }

  // ── Sidebar helpers ──────────────────────────────────────────────────────
  function orderedList(key, defaults) {
    var saved = layoutCfg[key];
    if(!saved || !saved.length) return defaults.slice();
    var result = saved.map(function(s) {
      return defaults.find(function(d){return d.id===s.id;}) || s;
    });
    defaults.forEach(function(d) {
      if(!result.find(function(r){return r.id===d.id;})) result.push(d);
    });
    return result;
  }

  // ── Right sidebar helpers ────────────────────────────────────────────────
  // Build the full list of pages: core pages + any extension pages
  function getAllPages() {
    var pages = CORE_PAGES.slice();
    var extWidgets = window.NexusExtensions.getRightWidgets();
    extWidgets.forEach(function(w) {
      if(!w.pages || w.pages === "global") return;
      var wPages = Array.isArray(w.pages) ? w.pages : [w.pages];
      wPages.forEach(function(p) {
        if(!pages.find(function(pg){ return pg.id === p; })) {
          pages.push({id: p, label: p.charAt(0).toUpperCase() + p.slice(1), _ext: true});
        }
      });
    });
    return pages;
  }

  // Build the full widget list for a given page, merging saved state
  function getPageWidgets(pageId) {
    var allWidgets = [];
    var extWidgets = window.NexusExtensions.getRightWidgets();

    // Add built-in widgets that belong on this page
    RIGHT_WIDGETS.forEach(function(w) {
      if(w.pages === "global" || (Array.isArray(w.pages) && w.pages.indexOf(pageId) !== -1)) {
        allWidgets.push(Object.assign({}, w));
      }
    });

    // Add extension widgets that belong on this page
    extWidgets.forEach(function(w) {
      var wPages = w.pages;
      if(wPages === "global" || (Array.isArray(wPages) && wPages.indexOf(pageId) !== -1)) {
        allWidgets.push(Object.assign({}, w));
      }
    });

    // Apply saved state (order + hidden) for this page
    var savedByPage = layoutCfg.right_widgets_by_page || {};
    var saved = savedByPage[pageId];
    if(!saved || !saved.length) return allWidgets;

    // Merge: apply saved order and hidden flags, append any new widgets
    var result = [];
    saved.forEach(function(s) {
      var found = allWidgets.find(function(w){ return w.id === s.id; });
      if(found) result.push(Object.assign({}, found, {hidden: s.hidden || false}));
    });
    allWidgets.forEach(function(w) {
      if(!result.find(function(r){ return r.id === w.id; })) {
        result.push(Object.assign({}, w));
      }
    });
    return result;
  }

  function updatePageWidgets(pageId, items) {
    var savedByPage = Object.assign({}, layoutCfg.right_widgets_by_page || {});
    savedByPage[pageId] = items.map(function(w){ return {id: w.id, hidden: w.hidden || false}; });
    update("right_widgets_by_page", savedByPage);
  }

  function togglePageExpanded(pageId) {
    setExpandedPages(function(prev) {
      return Object.assign({}, prev, {[pageId]: !prev[pageId]});
    });
  }

  var TABS = [
    {id:"post_toolbar",  label:"Post toolbar"},
    {id:"reply_toolbar", label:"Reply toolbar"},
    {id:"left",          label:"Left sidebar"},
    {id:"right",         label:"Right sidebar"},
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

    // Post toolbar tab
    tab === "post_toolbar" && React.createElement('div', null,
      React.createElement('div', {className:"page-sub"}, "Toolbar shown in the post composer. Drag to reorder. Toggle to show or hide. Extension buttons scoped to Replies only are hidden by default."),
      React.createElement(ToolbarEditor, {
        items: getToolbar("post_toolbar", "post"),
        onReset: function(){ update("post_toolbar", seedToolbar("post")); },
        onChange: function(items){ update("post_toolbar", items); }
      })
    ),

    // Reply toolbar tab
    tab === "reply_toolbar" && React.createElement('div', null,
      React.createElement('div', {className:"page-sub"}, "Toolbar shown in reply composers. Drag to reorder. Toggle to show or hide. Extension buttons scoped to Posts only are hidden by default."),
      React.createElement(ToolbarEditor, {
        items: getToolbar("reply_toolbar", "reply"),
        onReset: function(){ update("reply_toolbar", seedToolbar("reply")); },
        onChange: function(items){ update("reply_toolbar", items); }
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
      React.createElement('div', {className:"page-sub"}, "Configure which widgets appear on each page. Drag to reorder, toggle to show or hide. Global widgets appear in every section. Extension pages appear automatically when extensions are installed."),
      React.createElement('div', {style:{display:"flex",flexDirection:"column",gap:8,marginTop:16}},
        getAllPages().map(function(pg) {
          var isExpanded = !!expandedPages[pg.id];
          var pageWidgets = getPageWidgets(pg.id);
          var visibleCount = pageWidgets.filter(function(w){ return !w.hidden; }).length;
          return React.createElement('div', {
            key: pg.id,
            style:{border:"0.5px solid var(--b1)",borderRadius:10,overflow:"hidden"}
          },
            // Section header
            React.createElement('div', {
              onClick: function(){ togglePageExpanded(pg.id); },
              style:{
                display:"flex",alignItems:"center",gap:10,padding:"12px 16px",
                cursor:"pointer",background:"rgba(255,255,255,0.02)",
                borderBottom: isExpanded ? "0.5px solid var(--b1)" : "none",
                userSelect:"none"
              }
            },
              React.createElement('i', {
                className:"fa-solid "+(isExpanded?"fa-chevron-down":"fa-chevron-right"),
                style:{fontSize:10,color:"var(--t5)",width:12,flexShrink:0}
              }),
              React.createElement('span', {style:{fontSize:13,fontWeight:500,color:"var(--t2)",flex:1}}, pg.label),
              pg._ext && React.createElement('span', {style:{fontSize:10,color:"var(--t5)",background:"rgba(167,139,250,0.06)",padding:"1px 7px",borderRadius:20,border:"0.5px solid rgba(167,139,250,0.2)",marginRight:8}}, "extension"),
              React.createElement('span', {style:{fontSize:12,color:"var(--t5)"}},
                visibleCount + " of " + pageWidgets.length + " active"
              )
            ),
            // Section body
            isExpanded && React.createElement('div', {style:{padding:"12px 16px"}},
              pageWidgets.length === 0
                ? React.createElement('div', {style:{fontSize:12,color:"var(--t5)",padding:"8px 0"}}, "No widgets registered for this page.")
                : React.createElement(WidgetDragList, {
                    items: pageWidgets,
                    onChange: function(items){ updatePageWidgets(pg.id, items); }
                  })
            )
          );
        })
      )
    )
  );
}

// ── ToolbarEditor ─────────────────────────────────────────────────────────────
function ToolbarEditor({items, onChange, onReset}) {
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
    if(onReset) onReset();
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
                    <div style={{minWidth:28,height:28,borderRadius:6,border:"0.5px solid var(--b1)",background:"rgba(255,255,255,0.04)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:"var(--t4)",fontWeight:500,...(item.style||{})}}>
                      {item._ext ? React.createElement('i', {className:item.label, style:{fontSize:14}}) : item.label}
                    </div>
                    <div>
                      <div style={{fontSize:13,color:"var(--t2)",fontWeight:500}}>{item.tip}</div>
                      <div style={{fontSize:11,color:"var(--t5)",marginTop:1,fontFamily:"monospace"}}>{item._ext?"extension":item.type==="image"?"file upload":item.wrap?item.wrap[0]+(item.wrap[0]?'…':'')+(item.wrap[1]||''):''}</div>
                    </div>
                  </div>}
              {/* Toggle visible */}
              <Toggle value={!item.hidden} onChange={function(){ toggle(idx); }}/>
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


// ── Exports ───────────────────────────────────────────────────────────────────
export { DragList, LayoutAdmin, ToolbarEditor };
