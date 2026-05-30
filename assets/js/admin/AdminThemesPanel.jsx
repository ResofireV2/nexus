import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { toast } from "../components/Toasts";

export function AdminThemesPanel() {
  const [tab, setTab]                   = useState("all");
  const [themes, setThemes]             = useState(null);       // installed themes
  const [storeItems, setStoreItems]     = useState(null);       // registry entries
  const [storeLoading, setStoreLoading] = useState(false);
  const [storeError, setStoreError]     = useState(null);
  const [installing, setInstalling]     = useState(null);       // slug being installed
  const [installUrl, setInstallUrl]     = useState("");
  const [installError, setInstallError] = useState(null);
  const [filter, setFilter]             = useState("");

  useEffect(() => { loadThemes(); loadStore(); }, []);

  const loadThemes = () =>
    api.get("/admin/themes").then(d => setThemes(d.themes || []));

  const loadStore = () => {
    setStoreLoading(true); setStoreError(null);
    api.get("/admin/themes/store")
      .then(d => {
        if (d.themes) setStoreItems(d.themes);
        else setStoreError(d.error || "Failed to load store");
      })
      .catch(() => setStoreError("Network error"))
      .finally(() => setStoreLoading(false));
  };

  const installFromUrl = async () => {
    if (!installUrl.trim()) return;
    setInstalling("__url__"); setInstallError(null);
    const d = await api.post("/admin/themes/install-from-url", { url: installUrl.trim() });
    if (d.theme) {
      toast(`${d.theme.name} installed`);
      setInstallUrl(""); loadThemes(); loadStore(); setTab("installed");
    } else {
      setInstallError(d.error || "Installation failed");
    }
    setInstalling(null);
  };

  const installFromStore = async (item) => {
    setInstalling(item.slug);
    const d = await api.post("/admin/themes/install-from-url", { url: item.github_url || item.homepage });
    if (d.theme) {
      toast(`${d.theme.name} installed`);
      loadThemes();
      setStoreItems(prev => prev.map(s => s.slug === item.slug ? { ...s, installed: true } : s));
    } else {
      toast(d.error || "Installation failed", "err");
    }
    setInstalling(null);
  };

  const uninstall = async (theme) => {
    if (!confirm(`Uninstall ${theme.name}?`)) return;
    const d = await api.delete(`/admin/themes/${theme.slug}`);
    if (d.ok) {
      toast(`${theme.name} uninstalled`);
      loadThemes();
      setStoreItems(prev => prev ? prev.map(s => s.slug === theme.slug ? { ...s, installed: false } : s) : prev);
      if (theme.active_dark || theme.active_light) {
        api.get("/branding").then(bd => {
          const s = bd.settings || {};
          window._applyBranding && window._applyBranding(s.appearance || {}, s.general || {});
        });
      }
    } else {
      toast(d.error || "Uninstall failed", "err");
    }
  };

  const activate = async (theme, mode) => {
    const currentMode =
      (mode === "dark" && theme.active_dark) || (mode === "light" && theme.active_light)
        ? "none" : mode;
    const d = await api.post(`/admin/themes/${theme.slug}/activate`, { mode: currentMode });
    if (d.ok || d.theme) {
      loadThemes();
      api.get("/branding").then(bd => {
        const s = bd.settings || {};
        window._applyBranding && window._applyBranding(s.appearance || {}, s.general || {});
      });
      toast(currentMode === "none" ? `${theme.name} deactivated` : `${theme.name} set as ${mode} theme`);
    } else {
      toast(d.error || "Failed", "err");
    }
  };

  const updateTheme = async (theme) => {
    const d = await api.post(`/admin/themes/${theme.slug}/update`);
    if (d.theme) { toast(`${theme.name} updated`); loadThemes(); }
    else if (d.message) toast(d.message);
    else toast(d.error || "Update failed", "err");
  };

  // Merge installed + store into unified list
  const installedSlugs   = new Set((themes || []).map(t => t.slug));
  const installedBySlug  = Object.fromEntries((themes || []).map(t => [t.slug, t]));
  const storeSlugs       = new Set((storeItems || []).map(i => i.slug));

  const allItems = (() => {
    const store = storeItems || [];
    // Add installed themes not in the store
    const extra = (themes || [])
      .filter(t => !storeSlugs.has(t.slug))
      .map(t => ({
        slug: t.slug, name: t.name, description: t.description,
        author: t.author, version: t.installed_version || t.version,
        banner_url: t.manifest?.banner_url || null,
        logo_url: t.manifest?.logo_url || null,
        homepage: t.homepage, installed: true,
        has_update: t.has_update,
      }));
    return [...store, ...extra];
  })();

  const f = filter.toLowerCase();
  const visibleItems = allItems.filter(item => {
    if (tab === "installed" && !installedSlugs.has(item.slug)) return false;
    if (tab === "all" && installedSlugs.has(item.slug)) return false;
    if (f && !item.name?.toLowerCase().includes(f) && !item.description?.toLowerCase().includes(f)) return false;
    return true;
  });

  const slugColor = slug => {
    const palette = ["#a78bfa","#60a5fa","#34d399","#f472b6","#fb923c","#facc15","#38bdf8"];
    let h = 0; for (const c of (slug || "")) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
    return palette[Math.abs(h) % palette.length];
  };

  const TABS = [
    { id: "all",       label: "All themes" },
    { id: "installed", label: `Installed${themes?.length ? ` · ${themes.length}` : ""}` },
    { id: "url",       label: "Install from URL" },
  ];

  return (
    <div style={{ position: "relative" }}>
      {/* Tab bar */}
      <div style={{ marginBottom: 24 }}>
        <div className="admin-tabs-underline">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`admin-tab-underline${tab === t.id ? " active" : ""}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="admin-tabs-mob">
          <details>
            <summary>
              <span className="atm-label">
                <span>{(TABS.find(t => t.id === tab) || TABS[0]).label}</span>
              </span>
              <i className="fa-solid fa-chevron-down" style={{ fontSize: 11, color: "var(--t5)" }}/>
            </summary>
            <div className="atm-menu">
              {TABS.map(t => (
                <div key={t.id} className={`atm-item${tab === t.id ? " active" : ""}`}
                  onClick={e => { setTab(t.id); e.currentTarget.closest("details").removeAttribute("open"); }}>
                  {t.label}
                </div>
              ))}
            </div>
          </details>
        </div>

        {/* Search + refresh */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          {tab !== "url" && (
            <div style={{ position: "relative", flexShrink: 0 }}>
              <i className="fa-solid fa-magnifying-glass" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "var(--t5)", pointerEvents: "none" }}/>
              <input value={filter} onChange={e => setFilter(e.target.value)}
                placeholder="Search…"
                style={{ paddingLeft: 28, paddingRight: 10, height: 30, fontSize: 12, background: "var(--s3)", border: "0.5px solid var(--b1)", borderRadius: 8, color: "var(--t1)", fontFamily: "inherit", outline: "none", width: 160 }}/>
            </div>
          )}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
            <button onClick={() => { if (!storeLoading) { loadStore(); loadThemes(); } }}
              style={{ background: "none", border: "none", color: storeLoading ? "var(--ac)" : "var(--t5)", cursor: storeLoading ? "default" : "pointer", padding: "4px 8px", fontSize: 13, flexShrink: 0, transition: "color .2s" }}
              title="Refresh">
              <i className={`fa-solid fa-rotate-right${storeLoading ? " fa-spin" : ""}`}/>
            </button>
          </div>
        </div>
      </div>

      {/* Install from URL tab */}
      {tab === "url" && (
        <div style={{ maxWidth: 560 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--t1)", marginBottom: 4 }}>Install from GitHub URL</div>
          <div style={{ fontSize: 12, color: "var(--t5)", marginBottom: 16 }}>
            Paste a GitHub repo URL pointing to a Nexus theme package.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="fi" style={{ flex: 1 }} value={installUrl}
              onChange={e => setInstallUrl(e.target.value)}
              placeholder="https://github.com/someone/nexus-my-theme"
              onKeyDown={e => e.key === "Enter" && installFromUrl()}/>
            <button className="btn-primary" style={{ fontSize: 13, padding: "7px 20px", flexShrink: 0 }}
              onClick={installFromUrl} disabled={installing === "__url__" || !installUrl.trim()}>
              {installing === "__url__" ? "Installing…" : "Install"}
            </button>
          </div>
          {installError && <div style={{ fontSize: 12, color: "var(--red)", marginTop: 10 }}>{installError}</div>}
        </div>
      )}

      {/* Loading state */}
      {tab !== "url" && storeLoading && !storeItems && (
        <div style={{ padding: "60px 0", textAlign: "center", color: "var(--t5)" }}>
          <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: 20, marginBottom: 10, display: "block" }}/>
          Loading themes…
        </div>
      )}

      {/* Error state */}
      {tab !== "url" && storeError && !storeItems && (
        <div style={{ padding: 16, background: "rgba(239,68,68,0.06)", border: "0.5px solid rgba(239,68,68,0.2)", borderRadius: 10, fontSize: 13, color: "var(--red)", display: "flex", alignItems: "flex-start", gap: 10 }}>
          <i className="fa-solid fa-triangle-exclamation" style={{ marginTop: 1, flexShrink: 0 }}/>
          <div>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>Could not load theme store</div>
            <div style={{ color: "var(--t4)", fontSize: 12 }}>{storeError}</div>
          </div>
        </div>
      )}

      {/* Theme cards grid */}
      {tab !== "url" && (storeItems || themes) && (
        <>
          {visibleItems.length === 0 && (
            <div style={{ padding: "60px 0", textAlign: "center", color: "var(--t5)" }}>
              <i className="fa-solid fa-palette" style={{ fontSize: 28, opacity: .3, marginBottom: 12, display: "block" }}/>
              <div style={{ fontSize: 14, marginBottom: 4 }}>
                {tab === "installed" ? "No themes installed yet" : "No themes available"}
              </div>
              {tab === "installed" && <div style={{ fontSize: 12 }}>Browse the All themes tab to install one.</div>}
              {tab === "all" && themes?.length > 0 && <div style={{ fontSize: 12 }}>All available themes are already installed.</div>}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 16 }}>
            {visibleItems.map(item => {
              const isInstalled  = installedSlugs.has(item.slug);
              const installedRec = installedBySlug[item.slug];
              const isBusy       = installing === item.slug;
              const accentColor  = slugColor(item.slug);

              return (
                <div key={item.slug} style={{
                  background: "var(--s3)", border: "0.5px solid var(--b1)", borderRadius: 14,
                  overflow: "hidden", display: "flex", flexDirection: "column", transition: "border-color .15s" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = "var(--b1)"}>

                  {/* Banner */}
                  <div style={{ aspectRatio: "2/1", position: "relative", flexShrink: 0,
                    background: item.banner_url ? "transparent" : `linear-gradient(135deg,${accentColor}22,${accentColor}08)` }}>
                    {item.banner_url && (
                      <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
                        <img src={item.banner_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                          onError={e => { e.target.parentElement.style.display = "none"; }}/>
                      </div>
                    )}
                    {/* Logo */}
                    <div style={{ position: "absolute", bottom: -20, left: 16, width: 48, height: 48, borderRadius: 12,
                      background: item.logo_url ? "var(--bg)" : accentColor + "18",
                      border: "2px solid var(--s3)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                      {item.logo_url
                        ? <img src={item.logo_url} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            onError={e => { e.target.style.display = "none"; }}/>
                        : <i className="fa-solid fa-palette" style={{ fontSize: 20, color: accentColor }}/>}
                    </div>
                    {/* Installed badge */}
                    {isInstalled && (
                      <div style={{ position: "absolute", top: 10, right: 10, display: "flex", gap: 6 }}>
                        {installedRec?.has_update && (
                          <div style={{ fontSize: 10, fontWeight: 500, padding: "2px 8px", borderRadius: 20,
                            background: "rgba(251,146,60,0.15)", border: "0.5px solid rgba(251,146,60,0.4)", color: "#fb923c",
                            display: "flex", alignItems: "center", gap: 4 }}>
                            <i className="fa-solid fa-arrow-up" style={{ fontSize: 9 }}/>Update
                          </div>
                        )}
                        <div style={{ fontSize: 10, fontWeight: 500, padding: "2px 8px", borderRadius: 20,
                          background: "rgba(52,211,153,0.15)", border: "0.5px solid rgba(52,211,153,0.3)", color: "#34d399",
                          display: "flex", alignItems: "center", gap: 4 }}>
                          <i className="fa-solid fa-check" style={{ fontSize: 9 }}/>Installed
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Card body */}
                  <div style={{ padding: "28px 16px 16px", flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 15, fontWeight: 500, color: "var(--t1)", lineHeight: 1.2 }}>{item.name}</div>
                      {(item.installed_version || item.version) && (
                        <div style={{ fontSize: 11, color: "var(--t5)", flexShrink: 0 }}>
                          v{(item.installed_version || item.version || "").replace(/^v/, "")}
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--t5)" }}>by {item.author || "unknown"}</div>
                    {item.description && (
                      <div style={{ fontSize: 13, color: "var(--t3)", lineHeight: 1.55, flex: 1 }}>
                        {item.description.slice(0, 120)}{item.description.length > 120 ? "…" : ""}
                      </div>
                    )}

                    {/* Mode assignment pills — only for installed themes */}
                    {isInstalled && installedRec && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                        <button onClick={() => activate(installedRec, "dark")}
                          style={{ fontSize: 11, padding: "4px 10px", borderRadius: 20, cursor: "pointer", fontFamily: "inherit",
                            background: installedRec.active_dark ? "var(--ac-bg)" : "transparent",
                            color: installedRec.active_dark ? "var(--ac)" : "var(--t4)",
                            border: `0.5px solid ${installedRec.active_dark ? "var(--ac-border)" : "var(--b2)"}` }}>
                          <i className="fa-solid fa-moon" style={{ marginRight: 4, fontSize: 10 }}/>Dark
                        </button>
                        <button onClick={() => activate(installedRec, "light")}
                          style={{ fontSize: 11, padding: "4px 10px", borderRadius: 20, cursor: "pointer", fontFamily: "inherit",
                            background: installedRec.active_light ? "var(--ac-bg)" : "transparent",
                            color: installedRec.active_light ? "var(--ac)" : "var(--t4)",
                            border: `0.5px solid ${installedRec.active_light ? "var(--ac-border)" : "var(--b2)"}` }}>
                          <i className="fa-solid fa-sun" style={{ marginRight: 4, fontSize: 10 }}/>Light
                        </button>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div style={{ display: "flex", gap: 8, marginTop: 4, alignItems: "center" }}>
                      {item.homepage && (
                        <a href={item.homepage} target="_blank" rel="noopener"
                          style={{ fontSize: 12, color: "var(--t4)", display: "flex", alignItems: "center", gap: 5, textDecoration: "none" }}
                          onClick={e => e.stopPropagation()}>
                          <i className="fa-brands fa-github" style={{ fontSize: 12 }}/>GitHub
                        </a>
                      )}
                      <div style={{ flex: 1 }}/>
                      {isInstalled ? (
                        <>
                          {installedRec?.has_update && (
                            <button onClick={() => updateTheme(installedRec)}
                              style={{ fontSize: 12, padding: "5px 14px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
                                background: "rgba(251,146,60,0.08)", color: "#fb923c", border: "0.5px solid rgba(251,146,60,0.3)" }}>
                              Update
                            </button>
                          )}
                          <button onClick={() => uninstall(installedRec)}
                            style={{ fontSize: 12, padding: "5px 14px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
                              background: "rgba(248,113,113,0.06)", color: "var(--red)", border: "0.5px solid rgba(248,113,113,0.2)" }}>
                            Uninstall
                          </button>
                        </>
                      ) : (
                        <button className="btn-primary"
                          style={{ fontSize: 13, padding: "7px 20px", flexShrink: 0, opacity: isBusy ? 0.6 : 1 }}
                          disabled={isBusy}
                          onClick={() => installFromStore(item)}>
                          {isBusy ? "Installing…" : "Install"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
