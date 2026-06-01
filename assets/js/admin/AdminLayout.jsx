import React, { useState, useRef, useEffect } from "react";
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
// IMPORTANT: whenever a widget is added to RIGHT_WIDGETS in nexus.jsx, it must
// also be added here, or it will not appear in the Layout admin panel.
// Page widgets (page_widget:*) are injected dynamically via getPageWidgetEntries().
const RIGHT_WIDGETS = [
  {id:"post_author",       label:"Post Author",      pages:["post"]},
  {id:"post_participants", label:"Participants",      pages:["post"]},
  {id:"post_related",      label:"Related Posts",     pages:["post"]},
  {id:"leaderboard_panel", label:"Leaderboard Panel", pages:["leaderboard"]},
  {id:"badges_panel",      label:"Badges Panel",      pages:["badges"]},
  {id:"search_filters",    label:"Search Filters",    pages:["search"]},
  {id:"online_members",    label:"Online Members",    pages:"global"},
  {id:"live_activity",     label:"Live Activity",     pages:"global"},
  {id:"spaces_by_pulse",   label:"Spaces by Pulse",   pages:["feed"]},
  {id:"tags_by_pulse",     label:"Tags by Pulse",     pages:["feed"]},
  {id:"stats",             label:"Stats",             pages:"global"},
];
function getPageWidgetEntries() {
  return (window._pageWidgets || []).map(function(pw) {
    return {id: "page_widget:" + pw.id, label: pw.name, pages: "global"};
  });
}

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

// Look up a human-friendly label for an extension slug, preferring the
// admin-panel label, then the explore item label, then the slug itself.
// Used by both the right-sidebar pages list and the toolbar drag list to
// show "from Gamepedia" style attribution instead of a generic "extension".
function labelForExtension(slug) {
  if (!slug || !window.NexusExtensions) return slug || "extension";
  var panels = window.NexusExtensions.getAdminPanels();
  var panel  = panels.find(function(p){ return p.slug === slug; });
  if (panel && panel.label) return panel.label;
  var items  = window.NexusExtensions.getExploreItems();
  var item   = items.find(function(i){ return i.slug === slug; });
  if (item && item.label) return item.label;
  return slug;
}

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

// Explore items that cannot be hidden — always visible to users.
const LOCKED_EXPLORE_ITEMS = new Set(["everything", "members", "notifications", "messages", "search"]);

// ── ExploreDragList — drag-reorder + toggle for explore sidebar items ──────────
function ExploreDragList({items, onChange}) {
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
      var locked = LOCKED_EXPLORE_ITEMS.has(item.id);
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
        item.icon && React.createElement('i',{className:"fa-solid "+item.icon,style:{fontSize:13,color:"var(--t4)",width:16,textAlign:"center",flexShrink:0}}),
        React.createElement('span',{style:{flex:1,fontSize:13,color:item.hidden?"var(--t5)":"var(--t2)",fontWeight:500}}, item.label),
        item.authOnly && React.createElement('span',{style:{fontSize:10,color:"var(--t5)",background:"rgba(255,255,255,0.05)",padding:"1px 7px",borderRadius:20,border:"0.5px solid var(--b1)"}}, "logged in only"),
        item._ext && React.createElement('span',{style:{fontSize:10,color:"var(--t5)",background:"rgba(167,139,250,0.06)",padding:"1px 7px",borderRadius:20,border:"0.5px solid rgba(167,139,250,0.2)"}}, "extension"),
        locked
          ? React.createElement('div',{style:{width:46,height:26,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}},
              React.createElement('span',{style:{fontSize:10,color:"var(--t5)",padding:"1px 7px",borderRadius:20,background:"rgba(255,255,255,0.03)",border:"0.5px solid var(--b1)"},title:"This item cannot be hidden"}, "required")
            )
          : React.createElement('div', {style:{flexShrink:0, margin:"-12px 0"}},
              React.createElement(Toggle, {value: !item.hidden, onChange: function(){ toggle(idx); }})
            )
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

  // Re-render when extension bundles register widgets, admin panels, or
  // explore items at runtime — getAllPages reads from all three sources.
  var [, forceUpdate] = React.useState(0);
  useEffect(function() {
    var unsubs = [
      window.NexusExtensions.onRightWidgetChange(function(){ forceUpdate(function(n){ return n + 1; }); }),
      window.NexusExtensions.onAdminPanelChange(function(){ forceUpdate(function(n){ return n + 1; }); }),
      window.NexusExtensions.onExploreChange(function(){ forceUpdate(function(n){ return n + 1; }); }),
    ];
    return function() { unsubs.forEach(function(fn){ fn(); }); };
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
    // Start from saved, but refresh any button properties (label, tip, wrap,
    // style, onClick for ext) from the live definition — this self-heals stale
    // saved data such as an old icon from a previous version of an extension.
    // For ext entries with no live definition (extension not yet loaded or
    // uninstalled), the saved entry is carried forward so the admin can still
    // see and remove it.
    var result = saved.map(function(s) {
      if(s.sep) return s;
      var live = all.find(function(d){ return d.type === s.type; });
      if(!live) return s;
      return Object.assign({}, live, {hidden: s.hidden});
    });
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
      var def = defaults.find(function(d){return d.id===s.id;});
      if(def) return Object.assign({}, def, {hidden: s.hidden || false});
      return s;
    });
    defaults.forEach(function(d) {
      if(!result.find(function(r){return r.id===d.id;})) result.push(d);
    });
    return result;
  }

  // ── Right sidebar helpers ────────────────────────────────────────────────
  //
  // Pages model:
  //   - Core pages (CORE_PAGES) have id "post", "feed", etc.
  //   - Extension pages have id "ext:<slug>". One row per extension, regardless
  //     of how many routes or widgets that extension has. The admin configures
  //     a single consolidated layout that applies to every page of that
  //     extension. This mirrors the resolver in RightPanel.
  //
  // Saved state keys in layoutCfg.right_widgets_by_page follow the same scheme.

  // Build the full list of pages: core pages + one row per extension
  // that has any registered widgets.
  function getAllPages() {
    var pages = CORE_PAGES.slice();
    var extWidgets = window.NexusExtensions.getRightWidgets();
    var seenSlugs = {};
    extWidgets.forEach(function(w) {
      if (!w.slug || seenSlugs[w.slug]) return;
      seenSlugs[w.slug] = true;
      pages.push({
        id:    "ext:" + w.slug,
        label: labelForExtension(w.slug),
        _ext:  true,
      });
    });
    return pages;
  }

  // Decide whether a widget belongs on a given pageId.
  //   - "global" — always
  //   - {extension: slug} — when pageId is "ext:<slug>"
  //   - [paths...] — when pageId is "ext:<slug>" AND any path is /ext/<slug>/...
  //                  OR when pageId matches one of the core-page ids in the array
  function widgetMatchesPage(w, pageId) {
    var wp = w.pages;
    if (wp === "global") return true;
    if (wp && typeof wp === "object" && !Array.isArray(wp) && wp.extension) {
      return pageId === "ext:" + wp.extension;
    }
    if (Array.isArray(wp)) {
      if (wp.indexOf(pageId) !== -1) return true;
      // Path-specific extension widget — match if pageId is the owning extension
      if (pageId && pageId.indexOf("ext:") === 0) {
        var slug = pageId.slice("ext:".length);
        var prefix = "/ext/" + slug;
        return wp.some(function(p) {
          return typeof p === "string" && (p === prefix || p.indexOf(prefix + "/") === 0);
        });
      }
      return false;
    }
    return false;
  }

  // Build the full widget list for a given page, merging saved state
  function getPageWidgets(pageId) {
    var allWidgets = [];
    var extWidgets = window.NexusExtensions.getRightWidgets();

    // Add built-in widgets that belong on this page
    RIGHT_WIDGETS.forEach(function(w) {
      if (widgetMatchesPage(w, pageId)) {
        allWidgets.push(Object.assign({}, w));
      }
    });

    // Add dynamic page widgets
    getPageWidgetEntries().forEach(function(w) {
      if (widgetMatchesPage(w, pageId)) {
        allWidgets.push(Object.assign({}, w));
      }
    });

    // Add extension widgets that belong on this page
    extWidgets.forEach(function(w) {
      if (widgetMatchesPage(w, pageId)) {
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
    // Tab bar — desktop: underline buttons; mobile: dropdown.
    React.createElement('div', {className: "admin-tabs-underline"},
      TABS.map(function(t) {
        var active = tab === t.id;
        return React.createElement('button', {
          key: t.id,
          onClick: function(){setTab(t.id);},
          className: "admin-tab-underline" + (active ? " active" : "")
        }, t.label);
      })
    ),
    React.createElement('div', {className: "admin-tabs-mob"},
      React.createElement('details', null,
        React.createElement('summary', null,
          React.createElement('span', {className: "atm-label"},
            React.createElement('span', null, (TABS.find(function(t){return t.id===tab;})||TABS[0]).label)
          ),
          React.createElement('i', {className: "fa-solid fa-chevron-down", style:{fontSize:11,color:"var(--t5)"}})
        ),
        React.createElement('div', {className: "atm-menu"},
          TABS.map(function(t) {
            var active = tab === t.id;
            return React.createElement('div', {
              key: t.id,
              className: "atm-item" + (active ? " active" : ""),
              onClick: function(e){ setTab(t.id); e.currentTarget.closest("details").removeAttribute("open"); }
            }, t.label);
          })
        )
      )
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
      React.createElement('div', {className:"page-sub"}, "Drag to reorder. Toggle to show or hide. Required items cannot be hidden."),
      React.createElement(ExploreDragList, {
        items: orderedList("explore_items", [...EXPLORE_ITEMS, ...window.NexusExtensions.getExploreItems()]),
        onChange: function(items){update("explore_items", items);}
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
    ),
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
                      {(item._ext || item.type === "emoji" || (typeof item.label === 'string' && item.label.startsWith('fa-'))) ? React.createElement('i', {className:item.label, style:{fontSize:14}}) : item.label}
                    </div>
                    <div>
                      <div style={{fontSize:13,color:"var(--t2)",fontWeight:500}}>{item.tip}</div>
                      <div style={{fontSize:11,color:"var(--t5)",marginTop:1,fontFamily:"monospace"}}>{item._ext?("from " + labelForExtension(item.slug)):item.type==="image"?"file upload":item.wrap?item.wrap[0]+(item.wrap[0]?'…':'')+(item.wrap[1]||''):''}</div>
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
                : React.createElement('button',{key:b.type+i,className:"comp-tb-btn",style:b.style||{}}, (b.type==="emoji" || (typeof b.label === 'string' && b.label.startsWith('fa-'))) ? React.createElement('i',{className:b.label,style:{fontSize:16}}) : b.label);
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
