import { useState, useEffect } from "react";
import { userColor } from "../lib/utils";
import { api } from "../lib/api";

// ── Avatar components ─────────────────────────────────────────────────────────
//
// Two avatar variants — use these everywhere. Never write an inline avatar
// <img> tag in any other component.
//
//   <RsAv user={user} />               — rounded-square, clickable user card
//   <RsAv user={user} size={48} />     — larger
//   <RsAv user={user} noCard />        — no click-to-user-card
//   <RsAv user={user} color="#f00" />  — force a specific fallback bg color
//
//   <Av user={user} />                 — simple avatar, no card, no border
//   <Av user={user} size={20} />       — smaller
//
// Both components:
//   - Show the avatar_url image when available
//   - Fall back to colored initials tile when no avatar_url
//   - Respect the --av-radius CSS variable set by admin appearance settings
//   - Never hard-code border-radius, size, or color values inline

// ---------------------------------------------------------------------------
// RsAv — primary avatar used in feeds, replies, user cards, sidebars.
// Clickable by default (opens user card popover). Pass noCard to disable.
// ---------------------------------------------------------------------------
export function RsAv({ user, size = 34, color, noCard = false }) {
  const bg       = color || userColor(user);
  const initials = (user?.username || "?").slice(0, 2).toUpperCase();

  const handleClick = noCard
    ? undefined
    : (e) => {
        e.stopPropagation();
        if (user?.username) openUserCard(user.username, e.currentTarget);
      };

  if (user?.avatar_url) {
    return (
      <img
        src={user.avatar_url}
        alt={user.username}
        onClick={handleClick}
        style={{
          width:        size,
          height:       size,
          borderRadius: "var(--av-radius)",
          objectFit:    "cover",
          flexShrink:   0,
          border:       `1px solid ${bg}33`,
          cursor:       noCard ? "default" : "pointer",
        }}
      />
    );
  }

  return (
    <div
      onClick={handleClick}
      style={{
        width:           size,
        height:          size,
        borderRadius:    "var(--av-radius)",
        background:      bg,
        color:           "#fff",
        display:         "flex",
        alignItems:      "center",
        justifyContent:  "center",
        fontSize:        Math.round(size * 0.35),
        fontWeight:      500,
        flexShrink:      0,
        cursor:          noCard ? "default" : "pointer",
      }}
    >
      {initials}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Av — lightweight avatar used in compact contexts (DM list, notification
// rows, mentions). No user card, thinner border.
// ---------------------------------------------------------------------------
export function Av({ user, size = 28 }) {
  const bg = userColor(user);

  if (user?.avatar_url) {
    return (
      <img
        src={user.avatar_url}
        alt={user?.username}
        style={{
          width:        size,
          height:       size,
          borderRadius: "var(--av-radius)",
          objectFit:    "cover",
          flexShrink:   0,
          border:       `0.5px solid ${bg}55`,
        }}
      />
    );
  }

  return (
    <div
      style={{
        width:          size,
        height:         size,
        borderRadius:   "var(--av-radius)",
        background:     bg,
        color:          "#fff",
        flexShrink:     0,
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        fontSize:       Math.round(size * 0.38),
        fontWeight:     500,
      }}
    >
      {(user?.username || "?").slice(0, 2).toUpperCase()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// User card popover — global singleton driven by openUserCard()
// ---------------------------------------------------------------------------

// Global setter — set by useUserCard, called by openUserCard from anywhere
let _ucardSetState = null;

export function useUserCard() {
  const [card, setCard] = useState(null); // { username, x, y, loading, user }
  useEffect(() => {
    _ucardSetState = setCard;
    return () => { _ucardSetState = null; };
  }, []);
  return [card, setCard];
}

// Call this from anywhere to open the user card for a given username,
// anchored below the element that was clicked.
export function openUserCard(username, anchorEl) {
  if (!_ucardSetState) return;
  const rect = anchorEl.getBoundingClientRect();
  _ucardSetState({ username, x: rect.left, y: rect.bottom + 8, loading: true, user: null });
  api.get(`/users/${username}`).then(d => {
    if (d.user) {
      _ucardSetState(p => p?.username === username ? { ...p, user: d.user, loading: false } : p);
    }
  }).catch(() => _ucardSetState(null));
}

export function UserCardPopover({ card, setCard, currentUser, navigate }) {
  const ref = useState(null)[0] || (() => { const r = { current: null }; return r; })();
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    if (!card) return;
    const fn = e => { if (ref.current && !ref.current.contains(e.target)) setCard(null); };
    setTimeout(() => document.addEventListener("mousedown", fn), 0);
    return () => document.removeEventListener("mousedown", fn);
  }, [card]);

  useEffect(() => {
    const unsub = window.NexusExtensions.onUserActionChange(() => forceUpdate(n => n + 1));
    return unsub;
  }, []);

  if (!card) return null;

  const u = card.user;
  const ROLE_COLOR = { admin: "var(--amber)", moderator: "var(--ac)", member: "var(--t5)" };
  const ROLE_BG    = { admin: "rgba(251,191,36,.15)", moderator: "var(--ac-bg)", member: "var(--s3)" };

  const startDM = async () => {
    setCard(null);
    const d = await api.post("/threads/direct", { username: card.username });
    if (d.thread) navigate("dm", { threadId: d.thread.id, threadName: card.username });
    else toast(d.error || "Could not start conversation", "err");
  };

  // Keep card on screen horizontally and vertically
  const cardW = 320;
  const cardH = 420;
  const x = Math.min(card.x, window.innerWidth - cardW - 12);
  const y = card.y + cardH > window.innerHeight ? card.y - cardH - 60 : card.y;

  return (
    <div ref={ref} className={`ucard-wrap ${card ? "visible" : ""}`} style={{ left: x, top: y }}>
      <div className="ucard">
        {/* Cover */}
        <div
          className="ucard-cover"
          style={{
            background: u?.cover_url
              ? `url(${u.cover_url}) center/cover`
              : "linear-gradient(135deg,#1e1c2e,#312e55)",
          }}
        >
          <div style={{ position: "absolute", bottom: -36, left: 16 }}>
            <RsAv user={u || { username: card.username }} size={96} noCard />
          </div>
        </div>

        {/* Body */}
        <div className="ucard-body">
          {card.loading && !u ? (
            <div style={{ height: 100, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--t5)", fontSize: 13 }}>
              Loading…
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10, paddingTop: 44 }}>
                <div>
                  <div
                    style={{ fontSize: 17, fontWeight: 500, color: "var(--t1)", cursor: "pointer" }}
                    onClick={() => { setCard(null); navigate("profile", { username: u.username }); }}
                  >
                    {u.username}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--t5)", marginTop: 3 }}>
                    Joined {new Date(u.inserted_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                  </div>
                </div>
                {u.role && u.role !== "member" && (
                  <div style={{
                    fontSize: 11, padding: "3px 8px", borderRadius: 6,
                    background: ROLE_BG[u.role], color: ROLE_COLOR[u.role],
                    border: `0.5px solid ${ROLE_COLOR[u.role]}44`, flexShrink: 0,
                  }}>
                    {u.role}
                  </div>
                )}
              </div>

              {(u.groups||[]).filter(g=>g.show_on_popover).length>0&&(
                <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:10}}>
                  {(u.groups||[]).filter(g=>g.show_on_popover).map(g=>(
                    <span key={g.slug} style={{
                      display:"inline-flex",alignItems:"center",gap:4,
                      fontSize:10,fontWeight:500,padding:"2px 8px",borderRadius:20,
                      background:g.badge_color?g.badge_color+"1a":"rgba(255,255,255,0.08)",
                      color:g.badge_color||"var(--t3)",
                      border:`0.5px solid ${g.badge_color?g.badge_color+"40":"rgba(255,255,255,0.15)"}`,
                    }}>
                      {g.badge_icon&&<i className={`fa-solid ${g.badge_icon}`} style={{fontSize:8}}/>}
                      {g.badge_label||g.name}
                    </span>
                  ))}
                </div>
              )}

              {u.bio && (
                <p style={{ fontSize: 13, color: "var(--t3)", margin: "0 0 12px", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {u.bio}
                </p>
              )}

              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <div className="ucard-stat"><div className="ucard-stat-n">{u.post_count || 0}</div><div className="ucard-stat-l">posts</div></div>
                <div className="ucard-stat"><div className="ucard-stat-n">{u.reply_count || 0}</div><div className="ucard-stat-l">replies</div></div>
                <div className="ucard-stat"><div className="ucard-stat-n" style={{ color: "var(--ac)" }}>{u.reactions_received || 0}</div><div className="ucard-stat-l">reactions</div></div>
              </div>

              {u.last_seen_at && (
                <div style={{ fontSize: 12, color: "var(--t5)", marginBottom: 12, display: "flex", alignItems: "center", gap: 5 }}>
                  <i className="fa-solid fa-clock" style={{ fontSize: 10 }} />
                  Active {ago(u.last_seen_at)}
                </div>
              )}

              {(() => {
                const actions = window.NexusExtensions.getUserActions()
                  .filter(a => !a.authOnly || currentUser);
                const coreButtons = (currentUser && currentUser.username !== u.username ? 1 : 0) + 1;
                const total = coreButtons + actions.length;
                const cols = total <= 3 ? total : 2;
                return (
                  <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 7 }}>
                    {currentUser && currentUser.username !== u.username && (
                      <button className="btn-ghost" style={{ fontSize: 13, padding: "8px 0", borderRadius: 8 }} onClick={startDM}>
                        <i className="fa-solid fa-message" style={{ fontSize: 11, marginRight: 5 }} />Message
                      </button>
                    )}
                    <button className="btn-ghost" style={{ fontSize: 13, padding: "8px 0", borderRadius: 8 }} onClick={() => { setCard(null); navigate("profile", { username: u.username }); }}>
                      <i className="fa-solid fa-user" style={{ fontSize: 11, marginRight: 5 }} />Profile
                    </button>
                    {actions.map(a => (
                      <button key={a.id} className="btn-ghost" style={{ fontSize: 13, padding: "8px 0", borderRadius: 8 }}
                        onClick={() => a.onClick({ user: u, currentUser, navigate, closeCard: () => setCard(null) })}>
                        <i className={`fa-solid ${a.icon}`} style={{ fontSize: 11, marginRight: 5 }} />
                        {a.label}
                      </button>
                    ))}
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ago is needed inside UserCardPopover — import it here to keep Avatar.jsx self-contained
function ago(d) {
  if (!d) return "";
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (s < 60)     return "just now";
  if (s < 3600)   return `${Math.floor(s / 60)}m`;
  if (s < 86400)  return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(d).toLocaleDateString();
}
