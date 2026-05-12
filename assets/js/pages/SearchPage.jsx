import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../lib/api";
import { ago, userColor, spaceColor } from "../lib/utils";
import { RsAv } from "../components/Avatar";

// Strips markdown syntax from body text for plain-text excerpt display
function stripMd(text="") {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/[#*`>~_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Renders a highlight string from ts_headline — wraps <b> tags in accent color spans
function Highlight({text}) {
  if (!text) return null;
  // ts_headline wraps matches in <b>...</b>
  const parts = text.split(/(<b>[^<]*<\/b>)/g);
  return (
    <span style={{fontSize:12, color:"var(--t4)", lineHeight:1.6}}>
      {parts.map((part, i) => {
        if (part.startsWith("<b>") && part.endsWith("</b>")) {
          return <mark key={i} style={{background:"transparent", color:"var(--ac-text)", fontWeight:500}}>
            {part.slice(3, -4)}
          </mark>;
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

function SearchPage({navigate, tags=[], spaces=[], initialQ=""}) {
  const [q,         setQ]         = useState(initialQ);
  const [results,   setResults]   = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [filters,   setFilters]   = useState({
    kind:"all", sort:"relevance", space:"", tag:"",
    author:"", date_from:"", date_to:""
  });

  // Mobile filter bar state
  const [mobFiltersOpen, setMobFiltersOpen] = useState(false);
  const [mobKind,   setMobKind]   = useState("all");
  const [mobSort,   setMobSort]   = useState("relevance");
  const [mobSpace,  setMobSpace]  = useState("");

  const debounceRef = useRef();
  const filtersRef  = useRef(filters);
  useEffect(() => { filtersRef.current = filters; }, [filters]);

  const buildParams = useCallback((qVal, f) => {
    const p = new URLSearchParams({q: qVal});
    if (f.kind  && f.kind  !== "all")       p.set("kind",      f.kind);
    if (f.sort  && f.sort  !== "relevance") p.set("sort",      f.sort);
    if (f.space)   p.set("space",     f.space);
    if (f.tag)     p.set("tag",       f.tag);
    if (f.author)  p.set("author",    f.author);
    if (f.date_from) p.set("date_from", f.date_from);
    if (f.date_to)   p.set("date_to",   f.date_to);
    return p.toString();
  }, []);

  const doSearch = useCallback(async (qVal, f) => {
    if (!qVal.trim()) { setResults(null); return; }
    setLoading(true);
    try {
      const d = await api.get(`/search?${buildParams(qVal, f)}`);
      setResults(d);
    } finally { setLoading(false); }
  }, [buildParams]);

  // Listen for filter changes dispatched by SearchFilterPanel in the right sidebar
  useEffect(() => {
    const handler = e => {
      const f = e.detail;
      setFilters(f);
      setMobKind(f.kind);
      setMobSort(f.sort);
      setMobSpace(f.space);
      if (filtersRef.current !== f && q.trim()) {
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => doSearch(q, f), 150);
      }
    };
    window.addEventListener("nexus:search-filter", handler);
    return () => window.removeEventListener("nexus:search-filter", handler);
  }, [q, doSearch]);

  const onChange = e => {
    const val = e.target.value;
    setQ(val);
    clearTimeout(debounceRef.current);
    if (!val.trim()) { setResults(null); return; }
    debounceRef.current = setTimeout(() => doSearch(val, filtersRef.current), 300);
  };

  useEffect(() => { if (initialQ) doSearch(initialQ, filters); }, []);

  // Mobile filter dispatch
  const dispatchMobFilter = (key, val) => {
    const f = {...filtersRef.current, [key]: val};
    window.dispatchEvent(new CustomEvent("nexus:search-filter", {detail: f}));
  };

  const postCount   = results?.posts?.length  || 0;
  const replyCount  = results?.replies?.length || 0;
  const hasResults  = postCount + replyCount > 0;

  const activeMobFilterCount = [
    mobKind !== "all", mobSort !== "relevance", !!mobSpace
  ].filter(Boolean).length;

  const MobPill = ({value, current, onChange, label}) => (
    <button onClick={() => onChange(value)} style={{
      fontSize:11, padding:"3px 9px", borderRadius:20, cursor:"pointer",
      fontFamily:"inherit", border:"0.5px solid", flexShrink:0,
      borderColor: current===value ? "var(--ac-border)" : "var(--b2)",
      background:  current===value ? "var(--ac-bg)"     : "transparent",
      color:       current===value ? "var(--ac-text)"   : "var(--t4)",
    }}>{label}</button>
  );

  return (
    <div style={{flex:1, overflow:"hidden", display:"flex", flexDirection:"column"}}>
      {/* Header with search bar */}
      <div style={{height:48, borderBottom:"0.5px solid var(--b1)", display:"flex",
        alignItems:"center", padding:"0 24px", gap:12, flexShrink:0}}>
        <div className="search-bar" style={{flex:1, marginBottom:0}}>
          <i className="fa-solid fa-magnifying-glass" style={{
            fontSize:14, color:loading?"var(--ac)":"var(--t5)", transition:"color .2s", flexShrink:0
          }}/>
          <input
            className="fi"
            style={{flex:1, border:"none", background:"transparent", paddingLeft:0}}
            placeholder="Search threads and replies…"
            value={q}
            onChange={onChange}
            autoFocus
          />
          {loading && <i className="fa-solid fa-spinner fa-spin" style={{fontSize:12, color:"var(--t5)", flexShrink:0}}/>}
          {q && !loading && (
            <i className="fa-solid fa-xmark" style={{fontSize:12, color:"var(--t4)", cursor:"pointer", flexShrink:0}}
              onClick={() => { setQ(""); setResults(null); }}/>
          )}
        </div>

        {/* Mobile: filters toggle button */}
        <button
          className="mob-only"
          onClick={() => setMobFiltersOpen(o => !o)}
          style={{
            display:"none", alignItems:"center", gap:5, padding:"5px 11px",
            borderRadius:20, border:"0.5px solid", cursor:"pointer", fontFamily:"inherit",
            flexShrink:0, fontSize:11, fontWeight:500,
            borderColor: activeMobFilterCount > 0 ? "var(--ac-border)" : "var(--b2)",
            background:  activeMobFilterCount > 0 ? "var(--ac-bg)"     : "transparent",
            color:       activeMobFilterCount > 0 ? "var(--ac-text)"   : "var(--t4)",
          }}>
          <i className="fa-solid fa-sliders" style={{fontSize:11}}/>
          Filters{activeMobFilterCount > 0 ? ` · ${activeMobFilterCount}` : ""}
        </button>
      </div>

      {/* Mobile filter bar — collapsible */}
      {mobFiltersOpen && (
        <div style={{
          borderBottom:"0.5px solid var(--b1)", padding:"10px 16px",
          background:"var(--s1)", display:"flex", flexDirection:"column", gap:10,
        }}>
          <div>
            <div style={{fontSize:10,fontWeight:500,color:"var(--t5)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>Show</div>
            <div style={{display:"flex",gap:5}}>
              {[{v:"all",l:"Both"},{v:"posts",l:"Threads"},{v:"replies",l:"Replies"}].map(({v,l}) => (
                <MobPill key={v} value={v} current={mobKind} label={l}
                  onChange={val=>{setMobKind(val);dispatchMobFilter("kind",val);}}/>
              ))}
            </div>
          </div>
          <div>
            <div style={{fontSize:10,fontWeight:500,color:"var(--t5)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>Sort</div>
            <div style={{display:"flex",gap:5}}>
              {[{v:"relevance",l:"Relevance"},{v:"latest",l:"Latest"},{v:"top",l:"Top"}].map(({v,l}) => (
                <MobPill key={v} value={v} current={mobSort} label={l}
                  onChange={val=>{setMobSort(val);dispatchMobFilter("sort",val);}}/>
              ))}
            </div>
          </div>
          {spaces.length > 0 && (
            <div>
              <div style={{fontSize:10,fontWeight:500,color:"var(--t5)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>Space</div>
              <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                <MobPill value="" current={mobSpace} label="All"
                  onChange={val=>{setMobSpace(val);dispatchMobFilter("space",val);}}/>
                {spaces.map(s => (
                  <MobPill key={s.id} value={s.slug} current={mobSpace} label={s.name}
                    onChange={val=>{setMobSpace(mobSpace===val?"":val);dispatchMobFilter("space",mobSpace===val?"":val);}}/>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Results area */}
      <div className="search-wrap">
        {!q.trim() && (
          <div style={{textAlign:"center", color:"var(--t5)", padding:"48px 0", fontSize:13}}>
            <i className="fa-solid fa-magnifying-glass" style={{fontSize:28, marginBottom:12, display:"block", opacity:.4}}/>
            Type to search threads and replies
          </div>
        )}
        {loading && q.trim() && (
          <div style={{textAlign:"center", color:"var(--t5)", padding:"40px 0"}}>Searching…</div>
        )}
        {!loading && results && !hasResults && (
          <div style={{textAlign:"center", color:"var(--t5)", padding:"40px 0"}}>
            No results for "{q}"
          </div>
        )}
        {hasResults && <>
          {postCount > 0 && <>
            <div style={{fontSize:10,fontWeight:500,color:"var(--t5)",letterSpacing:".07em",textTransform:"uppercase",padding:"14px 0 8px"}}>
              Threads · {postCount}
            </div>
            {results.posts.map(p => {
              const col = spaceColor(p.space || {id:p.id});
              const excerpt = p.highlight || stripMd(p.body);
              return (
                <div key={p.id} className="thread" onClick={() => navigate("post", {id:p.id})}>
                  <div className="thread-main">
                    <div className="thread-accent" style={{background:col}}/>
                    <RsAv user={p.user} size={34} color={userColor(p.user)}/>
                    <div className="thread-body">
                      <div className="thread-top">
                        <div className="thread-title">
                          {p.title_highlight
                            ? <Highlight text={p.title_highlight}/>
                            : p.title}
                        </div>
                        {p.space && (
                          <div className="thread-tag" style={{background:`${col}20`, color:col}}>
                            {p.space.name}
                          </div>
                        )}
                      </div>
                      {excerpt && (
                        <div style={{margin:"3px 0 4px", overflow:"hidden", display:"-webkit-box",
                          WebkitLineClamp:2, WebkitBoxOrient:"vertical"}}>
                          <Highlight text={excerpt}/>
                        </div>
                      )}
                      <div className="participants-row">
                        <span className="part-label">
                          {p.user?.username} · {ago(p.inserted_at)}
                          {p.reply_count > 0 && ` · ${p.reply_count} repl${p.reply_count===1?"y":"ies"}`}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </>}

          {replyCount > 0 && <>
            <div style={{fontSize:10,fontWeight:500,color:"var(--t5)",letterSpacing:".07em",textTransform:"uppercase",padding:"14px 0 8px"}}>
              Replies · {replyCount}
            </div>
            {results.replies.map(r => {
              const col = userColor(r.user);
              const excerpt = r.highlight || stripMd(r.body);
              return (
                <div key={r.id} className="thread" onClick={() => navigate("post", {id:r.post_id})}>
                  <div className="thread-main">
                    <div className="thread-accent" style={{background:col}}/>
                    <RsAv user={r.user} size={34} color={userColor(r.user)}/>
                    <div className="thread-body">
                      <div className="thread-top">
                        {r.post && (
                          <div className="thread-tag" style={{background:"rgba(255,255,255,0.05)",color:"var(--t3)"}}>
                            in: {r.post.title?.slice(0,40)}
                          </div>
                        )}
                      </div>
                      {excerpt && (
                        <div style={{margin:"3px 0 4px", overflow:"hidden", display:"-webkit-box",
                          WebkitLineClamp:2, WebkitBoxOrient:"vertical"}}>
                          <Highlight text={excerpt}/>
                        </div>
                      )}
                      <div className="participants-row">
                        <span className="part-label">{r.user?.username} · {ago(r.inserted_at)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </>}
        </>}
      </div>
    </div>
  );
}

export { SearchPage };
