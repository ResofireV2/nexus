import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";
import { Av } from "../components/Avatar";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PERIODS   = [{k:"7d",l:"7d"},{k:"28d",l:"28d"},{k:"90d",l:"90d"},{k:"1y",l:"1y"}];
const TABS      = ["overview","content","users","moderation","engagement"];
const TAB_LABEL = {overview:"Overview",content:"Content",users:"Users",moderation:"Moderation",engagement:"Engagement"};

function pct_delta(curr, prev) {
  if (!prev || prev === 0) return null;
  return Math.round((curr - prev) / prev * 100);
}

function fmt_delta(d) {
  if (d === null || d === undefined) return null;
  return d >= 0 ? `↑ ${d}%` : `↓ ${Math.abs(d)}%`;
}

function fmt_seconds(s) {
  if (s === null || s === undefined) return "—";
  s = Math.round(s);
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

function fill_dates(series, from_date, to_date, value_key = "count") {
  const map = {};
  (series || []).forEach(p => { map[p.date] = p[value_key]; });
  const result = [];
  const from = new Date(from_date);
  const to   = new Date(to_date);
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    result.push({ date: key, count: map[key] || 0 });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Reusable micro-components
// ---------------------------------------------------------------------------

function StatCard({ label, value, delta, color }) {
  const deltaVal = delta !== null && delta !== undefined ? fmt_delta(delta) : null;
  const up       = deltaVal && deltaVal.startsWith("↑");
  return (
    <div className="admin-stat-card">
      <div className="asc-icon" style={{ background: `${color}18` }}>
        <i className={`fa-solid fa-chart-simple`} style={{ color, fontSize: 15 }} />
      </div>
      <div className="asc-n" style={{ color }}>{value}</div>
      <div className="asc-l">{label}</div>
      {deltaVal && (
        <div className={`asc-delta ${up ? "delta-up" : "delta-down"}`}>{deltaVal} vs prev period</div>
      )}
    </div>
  );
}

function Sparkline({ data, color, height = 56 }) {
  if (!data || !data.length) return <div style={{ height, display:"flex", alignItems:"center", paddingLeft:4, fontSize:12, color:"var(--t5)" }}>No data</div>;
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div style={{ display:"flex", alignItems:"flex-end", gap:2, height }}>
      {data.map((d, i) => (
        <div key={i} title={`${d.date}: ${d.count}`}
          style={{ flex:1, minWidth:0, height:`${Math.max((d.count/max)*100,2)}%`,
            background: color, borderRadius:"2px 2px 0 0", transition:"height .15s" }}/>
      ))}
    </div>
  );
}

function ChartLabel({ from, to }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"var(--t5)", marginTop:5 }}>
      <span>{from}</span><span>{to}</span>
    </div>
  );
}

function SectionCard({ title, children, style }) {
  return (
    <div style={{ border:"0.5px solid var(--b1)", borderRadius:12, padding:"16px 18px", marginBottom:12, ...style }}>
      {title && <div className="fgt" style={{ marginBottom:10 }}>{title}</div>}
      {children}
    </div>
  );
}

function BarList({ items, nameKey, countKey, color }) {
  if (!items || !items.length) return <div style={{ padding:"10px 0", fontSize:12, color:"var(--t5)" }}>No data</div>;
  const max = Math.max(...items.map(i => i[countKey]), 1);
  return items.map((item, i, arr) => (
    <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"6px 0",
      borderBottom: i < arr.length - 1 ? "0.5px solid var(--b1)" : "none" }}>
      <span style={{ width:90, flexShrink:0, fontSize:12, color:"var(--t2)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
        {item[nameKey]}
      </span>
      <div style={{ flex:1, height:5, background:"var(--b1)", borderRadius:3, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${Math.round(item[countKey]/max*100)}%`, background:color, borderRadius:3 }}/>
      </div>
      <span style={{ width:36, textAlign:"right", fontSize:11, color:"var(--t4)", flexShrink:0 }}>{item[countKey]}</span>
    </div>
  ));
}

function Alert({ type, title, sub }) {
  const ok    = type === "ok";
  const bg    = ok ? "rgba(52,211,153,0.08)"  : "rgba(251,191,36,0.08)";
  const bdr   = ok ? "rgba(52,211,153,0.25)"  : "rgba(251,191,36,0.25)";
  const ic    = ok ? "fa-circle-check"         : "fa-triangle-exclamation";
  const col   = ok ? "#34d399"                 : "#fbbf24";
  return (
    <div style={{ display:"flex", gap:10, padding:"10px 14px", borderRadius:10,
      border:`0.5px solid ${bdr}`, background:bg, marginBottom:8 }}>
      <i className={`fa-solid ${ic}`} style={{ fontSize:14, color:col, marginTop:1, flexShrink:0 }}/>
      <div>
        <div style={{ fontSize:12, fontWeight:500, color:"var(--t2)" }}>{title}</div>
        {sub && <div style={{ fontSize:11, color:"var(--t4)", marginTop:2 }}>{sub}</div>}
      </div>
    </div>
  );
}

function ContributorList({ users }) {
  if (!users || !users.length) return <div style={{ fontSize:12, color:"var(--t5)", padding:"10px 0" }}>No data</div>;
  return users.slice(0, 8).map((u, i, arr) => (
    <div key={u.user_id} style={{ display:"flex", alignItems:"center", gap:10, padding:"6px 0",
      borderBottom: i < arr.length - 1 ? "0.5px solid var(--b1)" : "none" }}>
      <Av user={{ username:u.username, avatar_url:u.avatar_url, avatar_color:u.avatar_color, id:u.user_id }} size={26}/>
      <span style={{ flex:1, fontSize:12, color:"var(--t2)" }}>{u.username}</span>
      <span style={{ fontSize:11, color:"var(--t4)" }}>{(u.posts||0) + (u.replies||0)} contrib.</span>
    </div>
  ));
}

// ---------------------------------------------------------------------------
// Tab components
// ---------------------------------------------------------------------------

function OverviewTab({ data, period }) {
  if (!data) return null;
  const { dau, dau_prev, new_members, new_members_prev, posts_count, posts_count_prev,
          median_first_reply_sec, dau_series, alerts } = data;

  const from = period?.from || "";
  const to   = period?.to   || "";
  const filled = fill_dates(dau_series, from, to);

  return (
    <>
      <div className="admin-stat-row">
        <StatCard label="Avg. DAU" value={dau ?? "—"} delta={pct_delta(dau, dau_prev)} color="#a78bfa"/>
        <StatCard label="New members" value={new_members ?? 0} delta={pct_delta(new_members, new_members_prev)} color="#34d399"/>
        <StatCard label="Posts created" value={(posts_count ?? 0).toLocaleString()} delta={pct_delta(posts_count, posts_count_prev)} color="#60a5fa"/>
        <StatCard label="Median first reply" value={fmt_seconds(median_first_reply_sec)} delta={null} color="#f472b6"/>
      </div>

      <SectionCard title="Daily active users">
        <Sparkline data={filled} color="var(--ac)" height={64}/>
        <ChartLabel from={from} to={to}/>
      </SectionCard>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
        <SectionCard title="Health alerts" style={{ marginBottom:0 }}>
          {alerts?.stale_flags?.count > 0
            ? <Alert type="warn" title={`${alerts.stale_flags.count} flagged post${alerts.stale_flags.count !== 1 ? "s" : ""} older than 48h`}
                sub={alerts.stale_flags.oldest_age_hours ? `Oldest is ${Math.round(alerts.stale_flags.oldest_age_hours)}h old` : null}/>
            : <Alert type="ok" title="No stale flags" sub="All pending reports are recent"/>}

          {alerts?.registration_spike?.spiking
            ? <Alert type="warn" title="Unusual registration spike"
                sub={`${alerts.registration_spike.recent_count} signups in the last 2h (${alerts.registration_spike.ratio}× baseline)`}/>
            : <Alert type="ok" title="Registration rate is normal" sub="No unusual signup spike in the last 2 hours"/>}

          {alerts?.pending_approvals?.count > 0
            ? <Alert type="warn" title={`${alerts.pending_approvals.count} post${alerts.pending_approvals.count !== 1 ? "s" : ""} pending approval`}
                sub={alerts.pending_approvals.oldest_age_hours ? `Oldest waiting ${Math.round(alerts.pending_approvals.oldest_age_hours)}h` : null}/>
            : <Alert type="ok" title="Approval queue is clear" sub="No posts pending approval"/>}
        </SectionCard>

        <SectionCard title="Post/discussion ratio" style={{ marginBottom:0 }}>
          {posts_count > 0 && data.replies_count !== undefined ? (
            <div style={{ fontSize:13, color:"var(--t2)" }}>
              {(posts_count / Math.max(1, data.replies_count || 1)).toFixed(2)} posts per reply
            </div>
          ) : (
            <div style={{ fontSize:12, color:"var(--t5)" }}>—</div>
          )}
        </SectionCard>
      </div>
    </>
  );
}

function ContentTab({ data, period }) {
  if (!data) return null;
  const { posts_and_replies_series, heatmap, space_activity } = data;
  const from = period?.from || "";
  const to   = period?.to   || "";

  const posts_filled   = fill_dates(posts_and_replies_series?.posts   || [], from, to);
  const replies_filled = fill_dates(posts_and_replies_series?.replies || [], from, to);

  const DAY_LABELS  = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  const HOUR_LABELS = Array.from({length:24}, (_,i) => i % 6 === 0 ? `${i}h` : "");

  return (
    <>
      <SectionCard title="Posts per day">
        <Sparkline data={posts_filled} color="var(--ac)" height={60}/>
        <ChartLabel from={from} to={to}/>
      </SectionCard>

      <SectionCard title="Replies per day">
        <Sparkline data={replies_filled} color="#60a5fa" height={48}/>
        <ChartLabel from={from} to={to}/>
      </SectionCard>

      {heatmap && heatmap.length === 7 && (
        <SectionCard title="Activity heatmap — posts by day & hour">
          <div style={{ display:"grid", gridTemplateColumns:"32px repeat(24,1fr)", gap:2 }}>
            {/* Header row */}
            <div/>
            {HOUR_LABELS.map((l, i) => (
              <div key={i} style={{ fontSize:9, color:"var(--t5)", textAlign:"center" }}>{l}</div>
            ))}
            {/* Data rows */}
            {heatmap.map((row, di) => (
              <>
                <div key={`l${di}`} style={{ fontSize:10, color:"var(--t5)", display:"flex", alignItems:"center", justifyContent:"flex-end", paddingRight:4 }}>
                  {DAY_LABELS[di]}
                </div>
                {row.map((val, hi) => (
                  <div key={`${di}-${hi}`} title={`${DAY_LABELS[di]} ${hi}:00`}
                    style={{ height:13, borderRadius:2,
                      background: val < 0.03 ? "var(--b1)" : `rgba(167,139,250,${(val * 0.85 + 0.1).toFixed(2)})` }}/>
                ))}
              </>
            ))}
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:10 }}>
            <span style={{ fontSize:10, color:"var(--t5)" }}>Less</span>
            {[0.1, 0.3, 0.5, 0.7, 0.9].map((a, i) => (
              <div key={i} style={{ width:16, height:8, borderRadius:2, background:`rgba(167,139,250,${a})` }}/>
            ))}
            <span style={{ fontSize:10, color:"var(--t5)" }}>More</span>
          </div>
        </SectionCard>
      )}

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        <SectionCard title="Posts by space" style={{ marginBottom:0 }}>
          <BarList items={space_activity} nameKey="name" countKey="posts" color="var(--ac)"/>
        </SectionCard>
        <SectionCard title="Replies by space" style={{ marginBottom:0 }}>
          <BarList items={space_activity} nameKey="name" countKey="replies" color="#60a5fa"/>
        </SectionCard>
      </div>
    </>
  );
}

function UsersTab({ data }) {
  if (!data) return null;
  const { top_contributors, new_vs_returning, inactive_counts } = data;
  const nvr = new_vs_returning || {};

  return (
    <>
      {/* Inactive counts */}
      <div className="admin-stat-row">
        {[
          { label:"Inactive 90d+",  value: inactive_counts?.days_90  ?? "—", color:"#fbbf24" },
          { label:"Inactive 180d+", value: inactive_counts?.days_180 ?? "—", color:"#f87171" },
          { label:"Inactive 365d+", value: inactive_counts?.days_365 ?? "—", color:"#f87171" },
        ].map((c, i) => (
          <div key={i} className="admin-stat-card">
            <div className="asc-n" style={{ color:c.color }}>{(c.value || 0).toLocaleString()}</div>
            <div className="asc-l">{c.label}</div>
          </div>
        ))}
      </div>

      {/* New vs returning */}
      {nvr.new_count !== undefined && (
        <SectionCard title="New vs. returning active members">
          <div style={{ height:28, borderRadius:6, overflow:"hidden", display:"flex", marginBottom:8 }}>
            <div style={{ width:`${nvr.new_pct || 0}%`, background:"rgba(96,165,250,0.35)",
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:11, fontWeight:500, color:"#60a5fa", minWidth: nvr.new_pct > 8 ? 0 : undefined }}>
              {nvr.new_pct > 8 ? `${nvr.new_pct}% new` : ""}
            </div>
            <div style={{ flex:1, background:"rgba(52,211,153,0.25)",
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:11, fontWeight:500, color:"#34d399" }}>
              {nvr.returning_pct}% returning
            </div>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"var(--t4)" }}>
            <span>{nvr.new_count} new</span>
            <span>{nvr.returning_count} returning</span>
          </div>
        </SectionCard>
      )}

      <SectionCard title="Top contributors this period">
        <ContributorList users={top_contributors}/>
      </SectionCard>
    </>
  );
}

function ModerationTab({ data, period }) {
  if (!data) return null;
  const { report_count, report_count_prev, report_series, report_reasons, hidden_series, pending_approvals } = data;
  const from = period?.from || "";
  const to   = period?.to   || "";

  const report_filled = fill_dates(report_series || [], from, to);
  const hidden_posts  = fill_dates(hidden_series?.posts   || [], from, to);
  const hidden_replies= fill_dates(hidden_series?.replies || [], from, to);

  return (
    <>
      <div className="admin-stat-row">
        <StatCard label="Reports this period" value={report_count ?? 0} delta={pct_delta(report_count, report_count_prev)} color="#f87171"/>
        <StatCard label="Pending approval" value={(pending_approvals?.posts ?? 0) + (pending_approvals?.replies ?? 0)} delta={null} color="#fbbf24"/>
      </div>

      <SectionCard title="Report volume">
        <Sparkline data={report_filled} color="#f87171" height={48}/>
        <ChartLabel from={from} to={to}/>
      </SectionCard>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
        <SectionCard title="Report reasons" style={{ marginBottom:0 }}>
          {(report_reasons || []).length === 0
            ? <div style={{ fontSize:12, color:"var(--t5)" }}>No reports this period</div>
            : <BarList items={report_reasons} nameKey="reason" countKey="count" color="#f87171"/>}
        </SectionCard>
        <SectionCard title="Hidden posts" style={{ marginBottom:0 }}>
          <Sparkline data={hidden_posts} color="#fbbf24" height={48}/>
          <ChartLabel from={from} to={to}/>
        </SectionCard>
      </div>
    </>
  );
}

function EngagementTab({ data, period }) {
  if (!data) return null;
  const { participation_pct, participation_pct_prev, reaction_ratio, reaction_ratio_prev,
          reaction_breakdown, reply_time_series } = data;
  const from = period?.from || "";
  const to   = period?.to   || "";

  const reply_filled = fill_dates(
    (reply_time_series || []).map(p => ({ date: p.date, count: Math.round(p.median_seconds || 0) })),
    from, to
  );

  return (
    <>
      <div className="admin-stat-row">
        <StatCard label="Participation rate"
          value={participation_pct !== null && participation_pct !== undefined ? `${participation_pct}%` : "—"}
          delta={pct_delta(participation_pct, participation_pct_prev)} color="#a78bfa"/>
        <StatCard label="Reactions / post"
          value={reaction_ratio?.ratio ?? "—"}
          delta={pct_delta(reaction_ratio?.ratio, reaction_ratio_prev?.ratio)} color="#34d399"/>
        <StatCard label="Total reactions" value={(reaction_ratio?.total_reactions ?? 0).toLocaleString()} delta={null} color="#60a5fa"/>
      </div>

      <SectionCard title="Median reply time (seconds)">
        <Sparkline data={reply_filled} color="var(--ac)" height={56}/>
        <ChartLabel from={from} to={to}/>
        <div style={{ fontSize:11, color:"var(--t5)", marginTop:4 }}>
          Height = median seconds to first reply on posts created that day
        </div>
      </SectionCard>

      <SectionCard title="Reaction breakdown">
        {(reaction_breakdown || []).length === 0
          ? <div style={{ fontSize:12, color:"var(--t5)" }}>No reactions this period</div>
          : reaction_breakdown.map((r, i, arr) => (
              <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"6px 0",
                borderBottom: i < arr.length - 1 ? "0.5px solid var(--b1)" : "none" }}>
                <span style={{ fontSize:16, width:22, textAlign:"center", flexShrink:0 }}>{r.emoji}</span>
                <div style={{ flex:1, height:5, background:"var(--b1)", borderRadius:3, overflow:"hidden" }}>
                  <div style={{ height:"100%", borderRadius:3, background:"var(--ac)",
                    width:`${Math.round(r.count / Math.max(...reaction_breakdown.map(x=>x.count), 1) * 100)}%` }}/>
                </div>
                <span style={{ fontSize:11, color:"var(--t4)", width:40, textAlign:"right", flexShrink:0 }}>
                  {r.count.toLocaleString()}
                </span>
              </div>
            ))}
      </SectionCard>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function AdminAnalyticsPanel() {
  const [tab,     setTab]     = useState("overview");
  const [period,  setPeriod]  = useState("28d");
  const [data,    setData]    = useState(null);
  const [meta,    setMeta]    = useState(null);  // { from, to }
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const load = useCallback((t, p) => {
    setLoading(true);
    setError(null);
    api.get(`/admin/analytics?tab=${t}&period=${p}`)
      .then(d => { setData(d.data); setMeta(d.period); })
      .catch(() => setError("Failed to load analytics."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(tab, period); }, [tab, period]);

  function switchTab(t)    { setTab(t);    setData(null); }
  function switchPeriod(p) { setPeriod(p); setData(null); }

  return (
    <div>
      <div className="page-sub">Trends and insights for your community.</div>

      {/* Period selector */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, marginTop:8 }}>
        <div style={{ display:"flex", gap:6 }}>
          {PERIODS.map(p => (
            <button key={p.k} onClick={() => switchPeriod(p.k)}
              style={{ fontSize:11, padding:"4px 12px", borderRadius:20, cursor:"pointer",
                border: period === p.k ? "0.5px solid var(--ac-border)" : "0.5px solid var(--b2)",
                background: period === p.k ? "var(--ac-bg)" : "transparent",
                color: period === p.k ? "var(--ac-text)" : "var(--t4)" }}>
              {p.l}
            </button>
          ))}
        </div>
        {meta && (
          <span style={{ fontSize:11, color:"var(--t5)" }}>{meta.from} → {meta.to}</span>
        )}
      </div>

      {/* Sub-tabs */}
      <div className="admin-tabs-underline" style={{marginBottom:20}}>
        {TABS.map(t => (
          <button key={t} onClick={() => switchTab(t)}
            className={`admin-tab-underline${tab === t ? " active" : ""}`}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>
      <div className="admin-tabs-mob" style={{marginBottom:20}}>
        <details>
          <summary>
            <span className="atm-label">
              <span>{TAB_LABEL[tab]}</span>
            </span>
            <i className="fa-solid fa-chevron-down" style={{fontSize:11,color:"var(--t5)"}}/>
          </summary>
          <div className="atm-menu">
            {TABS.map(t => (
              <div key={t}
                className={`atm-item${tab === t ? " active" : ""}`}
                onClick={e => { switchTab(t); e.currentTarget.closest("details").removeAttribute("open"); }}>
                {TAB_LABEL[t]}
              </div>
            ))}
          </div>
        </details>
      </div>

      {/* Content */}
      {loading && (
        <div style={{ textAlign:"center", padding:"48px 0", color:"var(--t5)", fontSize:13 }}>
          Loading…
        </div>
      )}

      {error && !loading && (
        <div style={{ textAlign:"center", padding:"48px 0", color:"var(--red)", fontSize:13 }}>
          {error}
        </div>
      )}

      {!loading && !error && data && (
        <>
          {tab === "overview"   && <OverviewTab   data={data} period={meta}/>}
          {tab === "content"    && <ContentTab    data={data} period={meta}/>}
          {tab === "users"      && <UsersTab      data={data}/>}
          {tab === "moderation" && <ModerationTab data={data} period={meta}/>}
          {tab === "engagement" && <EngagementTab data={data} period={meta}/>}
        </>
      )}
    </div>
  );
}
