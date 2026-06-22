import React, { useState, useRef, useEffect } from "react";
import ReactDOM from "react-dom/client";
import "./style.css";

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

type AuditType = "asset" | "cms" | "seo" | "speed";

interface AuditCache {
  asset: any | null;
  cms: any | null;
  seo: any | null;
  speed: any | null;
}

interface AuditTimestamp {
  asset: number | null;
  cms: number | null;
  seo: number | null;
  speed: number | null;
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function getTimeAgo(timestamp: number | null): string {
  if (!timestamp) return "";
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  return `${Math.floor(hours / 24)} day${Math.floor(hours / 24) > 1 ? "s" : ""} ago`;
}

function scoreColor(score: number): string {
  if (score >= 90) return "#22c55e";
  if (score >= 50) return "#f97316";
  return "#ef4444";
}

// ─────────────────────────────────────────────
// APP
// ─────────────────────────────────────────────

const App: React.FC = () => {
  // const [siteShortName, setSiteShortName] = useState<string | null>(null);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<string>("home");
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openPages, setOpenPages] = useState<Set<number>>(new Set());

  const cacheRef = useRef<AuditCache>({
    asset: null,
    cms: null,
    seo: null,
    speed: null,
  });
  const timestampRef = useRef<AuditTimestamp>({
    asset: null,
    cms: null,
    seo: null,
    speed: null,
  });
  const [reportData, setReportData] = useState<any>(null);

  // ─── GET SITE ID VIA WEBFLOW API ───
  useEffect(() => {
    async function init() {
      // Wait for Webflow to be fully ready
      await new Promise((resolve) => setTimeout(resolve, 500));

      try {
        if (typeof webflow !== "undefined") {
          await (webflow as any).setExtensionSize({
            width: 500,
            height: 500,
          });
        }
      } catch (e) {
        console.warn("setExtensionSize failed", e);
      }

      try {
        const site = await (webflow as any).getSiteInfo();

        console.log("SITE INFO:", site);

        setSiteId(site.siteId);
      } catch (e) {
        console.error("Failed to get site info:", e);

        setError("Could not detect Webflow site. Please reopen the extension.");
      }
    }

    init();
  }, []);

  // ─── FETCH HELPER ───
  const SERVER_URL = "https://aim-pennant-legwarmer.ngrok-free.dev";

  async function apiFetch(path: string, options?: RequestInit) {
    const url = `${SERVER_URL}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",
        ...(options?.headers || {}),
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: "Server error" }));
      throw new Error(err.message || "Server error");
    }
    return res.json();
  }

  // ─── REFRESH HEADER ───
  function RefreshHeader({
    auditType,
    onRefresh,
  }: {
    auditType: AuditType;
    onRefresh: () => void;
  }) {
    const timeAgo = getTimeAgo(timestampRef.current[auditType]);
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          padding: "10px 0",
          marginBottom: "12px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div style={{ fontSize: "12px", color: "var(--text-dim)" }}>
          <div>Last updated</div>
          <div style={{ fontWeight: 600, color: "var(--text)" }}>{timeAgo}</div>
        </div>
        <button
          onClick={onRefresh}
          style={{
            background: "none",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            padding: "4px 8px",
            cursor: "pointer",
            fontSize: "14px",
          }}
        >
          🔄
        </button>
      </div>
    );
  }

  // ─── TOGGLE PAGE ───
  function togglePage(index: number) {
    setOpenPages((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  // ─────────────────────────────────────────────
  // ASSET AUDIT
  // ─────────────────────────────────────────────

  async function runAssetAudit() {
    setLoading("asset");
    setError(null);
    try {
      const data = await apiFetch(`/assets?siteId=${siteId}`);
      cacheRef.current.asset = data;
      timestampRef.current.asset = Date.now();
      setReportData(data);
      setActiveView("asset");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(null);
    }
  }

  function AssetReport({ data }: { data: any }) {
    const assets = data.assets || [];
    const missingAlt = assets.filter((a: any) => !a.altText);
    const [inputValues, setInputValues] = useState<Record<string, string>>({});
    const [statusValues, setStatusValues] = useState<
      Record<string, { text: string; color: string }>
    >({});

    async function saveAltText(assetId: string) {
      const altText = inputValues[assetId] || "";
      if (!altText) {
        setStatusValues((prev) => ({
          ...prev,
          [assetId]: { text: "⚠️ Please enter alt text", color: "#f97316" },
        }));
        return;
      }
      setStatusValues((prev) => ({
        ...prev,
        [assetId]: { text: "Saving...", color: "#888" },
      }));
      try {
        await apiFetch(`/update-alt?siteId=${siteId}`, {
          method: "POST",
          body: JSON.stringify({ assetId, altText }),
        });
        setStatusValues((prev) => ({
          ...prev,
          [assetId]: { text: "✅ Alt text saved", color: "var(--success)" },
        }));
      } catch (e) {
        setStatusValues((prev) => ({
          ...prev,
          [assetId]: { text: "❌ Error saving", color: "var(--danger)" },
        }));
      }
    }

    async function saveAllAltText() {
      for (const asset of missingAlt) {
        await saveAltText(asset.id);
      }
    }

    return (
      <div>
        <RefreshHeader
          auditType="asset"
          onRefresh={() => {
            cacheRef.current.asset = null;
            timestampRef.current.asset = null;
            runAssetAudit();
          }}
        />
        <h2>❌ MISSING ALT TEXT ({missingAlt.length})</h2>
        <div style={{ display: "grid", gap: "12px", margin: "12px 0px" }}>
          <button id="saveAllBtn" onClick={saveAllAltText} style={{ flex: 1 }}>
            Save All Alt Text
          </button>
        </div>
        <div className="card-grid">
          {missingAlt.map((asset: any) => (
            <div key={asset.id} className="card">
              <img src={asset.hostedUrl} alt="" />
              <h3>{asset.displayName}</h3>
              <p
                style={{
                  color: statusValues[asset.id]?.color || "var(--danger)",
                }}
              >
                {statusValues[asset.id]?.text || "Missing alt text"}
              </p>
              <input
                type="text"
                placeholder="Enter alt text"
                value={inputValues[asset.id] || ""}
                onChange={(e) =>
                  setInputValues((prev) => ({
                    ...prev,
                    [asset.id]: e.target.value,
                  }))
                }
              />
              <button onClick={() => saveAltText(asset.id)}>Save</button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────
  // CMS AUDIT
  // ─────────────────────────────────────────────

  async function runCMSAudit() {
    setLoading("cms");
    setError(null);

    try {
      const cmsData = await apiFetch(`/cms-audit?siteId=${siteId}`);

      const fieldUsageMap: Record<string, Set<string>> = {};

      for (const col of cmsData.collections) {
        fieldUsageMap[col.id] = new Set();
      }

      const pages = await (webflow as any).getAllPagesAndFolders();

      const actualPages: any[] = [];

      for (const page of pages) {
        try {
          const utilityType = await page.getUtilityPageType();

          if (utilityType !== null && utilityType !== undefined) {
            continue;
          }

          const isPublished = await page.isPublished?.();
          const pageType = page.type || (await page.getType?.());

          if (pageType === "CollectionPage" && isPublished === false) {
            continue;
          }

          actualPages.push(page);
        } catch {
          actualPages.push(page);
        }
      }

      // console.log(`📊 Total pages: ${actualPages.length}`);
      const homePage = actualPages.find(
        (page: any) =>
          page.slug === "home" || page.name?.toLowerCase() === "home",
      );

      // SCAN NORMAL PAGE ELEMENTS
      for (const page of actualPages) {
        try {
          await (webflow as any).switchPage(page);

          await new Promise((r) => setTimeout(r, 1500));

          const root = await (webflow as any).getRootElement();

          if (root) {
            await walkAndFindBindings(root, fieldUsageMap);
          }
        } catch {}
      }

      // SCAN COMPONENT PANEL
      console.log("🧩 Scanning Components Panel");

      const components = await (webflow as any).getAllComponents();

      console.log(`🧩 Found ${components.length} components`);

      for (const component of components) {
        try {
          console.log(`🧩 Component: ${component.name}`);

          await (webflow as any).openCanvas(component);

          await new Promise((r) => setTimeout(r, 1000));

          const root = await (webflow as any).getRootElement();

          if (root) {
            await walkAndFindBindings(root, fieldUsageMap);
          }
        } catch (e) {
          console.log(`❌ Failed component scan`, component.name, e);
        }
      }
      // RETURN TO HOME PAGE
      try {
        if (homePage) {
          console.log("🏠 Returning to Home page");

          await (webflow as any).switchPage(homePage);

          await new Promise((r) => setTimeout(r, 1500));
        }
      } catch (e) {
        console.log("❌ Failed to switch to Home page", e);
      }

      const report: any[] = [];

      for (const col of cmsData.collections) {
        for (const field of col.fields) {
          // Hide slug field
          if (field.name?.toLowerCase() === "slug") {
            continue;
          }

          const usedFields = fieldUsageMap[col.id] || new Set();

          report.push({
            collectionId: col.id,
            collectionName: col.name,
            fieldId: field.id,
            fieldName: field.name,
            type: field.type,
            status: usedFields.has(field.id) ? "Used" : "Unused",
          });
        }
      }

      const result = {
        report,
        collections: cmsData.collections,
      };

      cacheRef.current.cms = result;
      timestampRef.current.cms = Date.now();

      setReportData(result);
      setActiveView("cms");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(null);
    }
  }
  async function walkAndFindBindings(
    element: any,
    fieldUsageMap: Record<string, Set<string>>,
  ) {
    if (!element) return;

    // Components are scanned separately
    if (element.type === "ComponentInstance") {
      return;
    }

    try {
      const settings = await element.getSettings?.();

      if (settings) {
        scanForCmsBindings(settings, fieldUsageMap);
      }
    } catch {}

    try {
      const children = await element.getChildren?.();

      if (children) {
        for (const child of children) {
          await walkAndFindBindings(child, fieldUsageMap);
        }
      }
    } catch {}
  }

  function scanForCmsBindings(
    obj: any,
    fieldUsageMap: Record<string, Set<string>>,
  ) {
    if (!obj || typeof obj !== "object") return;
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val && typeof val === "object") {
        if (val.sourceType === "cms" && val.collectionId && val.fieldId) {
          if (fieldUsageMap[val.collectionId]) {
            fieldUsageMap[val.collectionId].add(val.fieldId);
          }
        }
        if (Array.isArray(val)) {
          for (const item of val) scanForCmsBindings(item, fieldUsageMap);
        } else {
          scanForCmsBindings(val, fieldUsageMap);
        }
      }
    }
  }

  function CMSReport({ data }: { data: any }) {
    const [filter, setFilter] = React.useState<"all" | "used" | "unused">(
      "all",
    );

    const filtered = data.report.filter((item: any) => {
      if (filter === "used") return item.status === "Used";
      if (filter === "unused") return item.status === "Unused";
      return true;
    });

    const usedCount = data.report.filter(
      (i: any) => i.status === "Used",
    ).length;
    const unusedCount = data.report.filter(
      (i: any) => i.status === "Unused",
    ).length;

    return (
      <div>
        <RefreshHeader
          auditType="cms"
          onRefresh={() => {
            cacheRef.current.cms = null;
            timestampRef.current.cms = null;
            runCMSAudit();
          }}
        />

        {/* Summary */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
          <div
            style={{
              flex: 1,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              padding: "10px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: "20px",
                fontWeight: 700,
                color: "var(--success)",
              }}
            >
              {usedCount}
            </div>
            <div style={{ fontSize: "11px", color: "var(--text-dim)" }}>
              Used
            </div>
          </div>
          <div
            style={{
              flex: 1,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              padding: "10px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: "20px",
                fontWeight: 700,
                color: "var(--danger)",
              }}
            >
              {unusedCount}
            </div>
            <div style={{ fontSize: "11px", color: "var(--text-dim)" }}>
              Unused
            </div>
          </div>
          <div
            style={{
              flex: 1,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              padding: "10px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: "20px",
                fontWeight: 700,
                color: "var(--text)",
              }}
            >
              {data.report.length}
            </div>
            <div style={{ fontSize: "11px", color: "var(--text-dim)" }}>
              Total
            </div>
          </div>
        </div>

        {/* Filter tabs */}
        <div
          style={{
            display: "flex",
            gap: "4px",
            marginBottom: "12px",
            background: "#0f1320",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            padding: "3px",
          }}
        >
          {(["all", "used", "unused"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                flex: 1,
                padding: "6px",
                fontSize: "11px",
                fontWeight: 600,
                borderRadius: "6px",
                border: "none",
                cursor: "pointer",
                background:
                  filter === f
                    ? "linear-gradient(135deg, var(--brand), var(--brand-2))"
                    : "transparent",
                color: filter === f ? "#fff" : "var(--text-dim)",
              }}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="table-wrapper">
          <table className="report-table">
            <thead>
              <tr>
                <th>Collection</th>
                <th>Field</th>
                <th>Type</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item: any, i: number) => (
                <tr key={i}>
                  <td>{item.collectionName}</td>
                  <td>{item.fieldName}</td>
                  <td>{item.type}</td>
                  <td>
                    <span
                      className={
                        item.status === "Used" ? "status-used" : "status-unused"
                      }
                    >
                      {item.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  
  // ─────────────────────────────────────────────
  // SEO AUDIT
  // ─────────────────────────────────────────────

  async function runSEOAudit() {
    setLoading("seo");
    setError(null);
    try {
      const data = await apiFetch(`/seo-audit?siteId=${siteId}`);
      cacheRef.current.seo = data;
      timestampRef.current.seo = Date.now();
      setReportData(data);
      setActiveView("seo");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(null);
    }
  }

  function SEOReport({ data }: { data: any }) {
    const sw = data.siteWide;

    function siteWideIcon(val: boolean) {
      return val ? "✅" : "❌";
    }
    function icon(status: string) {
      if (status === "pass") return "✅";
      if (status === "warning") return "⚠️";
      return "❌";
    }

    return (
      <div>
        <RefreshHeader
          auditType="seo"
          onRefresh={() => {
            cacheRef.current.seo = null;
            timestampRef.current.seo = null;
            runSEOAudit();
          }}
        />
        <div className="seo-report">
          <div className="seo-sitewide">
            <h2>Site-wide</h2>
            <div className="sitewide-grid">
              <div className="sitewide-item">
                {siteWideIcon(sw.sitemap)} <span>Sitemap.xml</span>
                {sw.sitemap && (
                  <span
                    style={{
                      fontSize: "11px",
                      color: sw.sitemapValid ? "#22c55e" : "#ef4444",
                    }}
                  >
                    ({sw.sitemapIssue})
                  </span>
                )}
              </div>
              <div className="sitewide-item">
                {siteWideIcon(sw.robotsTxt)} <span>Robots.txt</span>
                {sw.robotsTxt && !sw.robotsTxtValid && (
                  <span style={{ color: "#ef4444", fontSize: "11px" }}>
                    ({sw.robotsTxtIssue})
                  </span>
                )}
              </div>
              <div className="sitewide-item">
                {siteWideIcon(sw.llmsTxt)} <span>LLMs.txt</span>
                <span
                  style={{
                    fontSize: "11px",
                    color: sw.llmsTxtValid ? "#22c55e" : "#ef4444",
                  }}
                >
                  ({sw.llmsTxtIssue})
                </span>
              </div>
            </div>
          </div>

          <h2>Pages ({data.pages.length})</h2>

          {data.pages.map((page: any, index: number) => {
            const checks = page.checks;
            const issues =
              Object.values(checks).filter(
                (c: any) => c.status === "fail" || c.status === "warning",
              ).length +
              page.imagesWithoutAlt.length +
              page.linksWithoutAnchor.length +
              page.brokenLinks.length +
              page.duplicateTitleWith.length +
              page.duplicateDescWith.length;
            const isOpen = openPages.has(index);

            return (
              <div key={index} className="seo-page-card">
                <div
                  className="seo-page-header"
                  onClick={() => togglePage(index)}
                >
                  <span className="seo-page-name">{page.pageName}</span>
                  {issues > 0 ? (
                    <span className="seo-issue-count">
                      {issues} issue{issues > 1 ? "s" : ""}
                    </span>
                  ) : (
                    <span className="seo-no-issues">✅ No issues</span>
                  )}
                  <span className="seo-toggle">{isOpen ? "▲" : "▼"}</span>
                </div>

                {isOpen && (
                  <div className="seo-page-body">
                    <table className="seo-table">
                      <thead>
                        <tr>
                          <th>Check</th>
                          <th>Status</th>
                          <th>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Meta Title</td>
                          <td>{icon(checks.metaTitle.status)}</td>
                          <td>{checks.metaTitle.message}</td>
                        </tr>
                        <tr>
                          <td>Meta Description</td>
                          <td>{icon(checks.metaDescription.status)}</td>
                          <td>{checks.metaDescription.message}</td>
                        </tr>
                        <tr>
                          <td>OG Title</td>
                          <td>{icon(checks.ogTitle.status)}</td>
                          <td>{checks.ogTitle.message}</td>
                        </tr>
                        <tr>
                          <td>OG Description</td>
                          <td>{icon(checks.ogDescription.status)}</td>
                          <td>{checks.ogDescription.message}</td>
                        </tr>
                        <tr>
                          <td>OG Image</td>
                          <td>{icon(checks.ogImage.status)}</td>
                          <td>{checks.ogImage.message}</td>
                        </tr>
                        <tr>
                          <td>H1</td>
                          <td>{icon(checks.h1.status)}</td>
                          <td>{checks.h1.message}</td>
                        </tr>
                        <tr>
                          <td>Heading Hierarchy</td>
                          <td>{icon(checks.headingHierarchy.status)}</td>
                          <td>{checks.headingHierarchy.message}</td>
                        </tr>
                        <tr>
                          <td>Canonical</td>
                          <td>{icon(checks.canonical.status)}</td>
                          <td>{checks.canonical.message}</td>
                        </tr>
                        <tr>
                          <td>Noindex</td>
                          <td>{icon(checks.noindex.status)}</td>
                          <td>{checks.noindex.message}</td>
                        </tr>
                        <tr>
                          <td>Structured Data</td>
                          <td>{icon(checks.structuredData.status)}</td>
                          <td>{checks.structuredData.message}</td>
                        </tr>
                        {page.duplicateTitleWith.length > 0 && (
                          <tr>
                            <td>Duplicate Title</td>
                            <td>❌</td>
                            <td>
                              Same title as:{" "}
                              {page.duplicateTitleWith.join(", ")}
                            </td>
                          </tr>
                        )}
                        {page.duplicateDescWith.length > 0 && (
                          <tr>
                            <td>Duplicate Description</td>
                            <td>❌</td>
                            <td>
                              Same description as:{" "}
                              {page.duplicateDescWith.join(", ")}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>

                    {page.imagesWithoutAlt.length > 0 && (
                      <div className="seo-sub-section">
                        <h4>
                          ❌ Images Without Alt Text (
                          {page.imagesWithoutAlt.length})
                        </h4>
                        <div className="seo-image-grid">
                          {page.imagesWithoutAlt.map((img: any, i: number) => (
                            <div key={i} className="seo-image-item">
                              <a
                                href={img.src}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <img src={img.src} alt="" />
                              </a>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {page.linksWithoutAnchor.length > 0 && (
                      <div className="seo-sub-section">
                        <h4>
                          ❌ Links Without Anchor Text (
                          {page.linksWithoutAnchor.length})
                        </h4>
                        <table className="seo-table">
                          <thead>
                            <tr>
                              <th>URL</th>
                              <th>Page</th>
                            </tr>
                          </thead>
                          <tbody>
                            {page.linksWithoutAnchor.map(
                              (link: any, i: number) => (
                                <tr key={i}>
                                  <td>{link.url}</td>
                                  <td>{link.page}</td>
                                </tr>
                              ),
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {page.brokenLinks.length > 0 && (
                      <div className="seo-sub-section">
                        <h4>❌ Broken Links ({page.brokenLinks.length})</h4>
                        <table className="seo-table">
                          <thead>
                            <tr>
                              <th>URL</th>
                              <th>Type</th>
                            </tr>
                          </thead>
                          <tbody>
                            {page.brokenLinks.map((link: any, i: number) => (
                              <tr key={i}>
                                <td>{link.url}</td>
                                <td>{link.type}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────
  // SPEED AUDIT
  // ─────────────────────────────────────────────

  async function runSpeedAudit() {
    setLoading("speed");
    setError(null);
    try {
      const data = await apiFetch(`/speed-audit?siteId=${siteId}`);
      cacheRef.current.speed = data;
      timestampRef.current.speed = Date.now();
      setReportData(data);
      setActiveView("speed");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(null);
    }
  }

  function ScoreCircle({ score }: { score: number }) {
    return (
      <span
        style={{
          display: "inline-block",
          width: "36px",
          height: "36px",
          borderRadius: "50%",
          background: scoreColor(score),
          color: "white",
          fontSize: "11px",
          fontWeight: 700,
          lineHeight: "36px",
          textAlign: "center",
        }}
      >
        {score}
      </span>
    );
  }

  function SpeedReport({ data }: { data: any }) {
    const sw = data.siteWide;

    return (
      <div>
        <RefreshHeader
          auditType="speed"
          onRefresh={() => {
            cacheRef.current.speed = null;
            timestampRef.current.speed = null;
            runSpeedAudit();
          }}
        />
        <div className="speed-report">
          <div className="seo-sitewide">
            <h2>Site-wide Average</h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "16px",
                marginTop: "10px",
              }}
            >
              <div>
                <h4 style={{ fontSize: "13px", margin: "0 0 8px 0" }}>
                  📱 Mobile
                </h4>
                <div className="speed-circles">
                  <div className="speed-circle-item">
                    <ScoreCircle score={sw.mobile.performance} />
                    <span>Performance</span>
                  </div>
                  <div className="speed-circle-item">
                    <ScoreCircle score={sw.mobile.accessibility} />
                    <span>Accessibility</span>
                  </div>
                  <div className="speed-circle-item">
                    <ScoreCircle score={sw.mobile.bestPractices} />
                    <span>Best Practices</span>
                  </div>
                  <div className="speed-circle-item">
                    <ScoreCircle score={sw.mobile.seo} />
                    <span>SEO</span>
                  </div>
                </div>
              </div>
              <div>
                <h4 style={{ fontSize: "13px", margin: "0 0 8px 0" }}>
                  🖥️ Desktop
                </h4>
                <div className="speed-circles">
                  <div className="speed-circle-item">
                    <ScoreCircle score={sw.desktop.performance} />
                    <span>Performance</span>
                  </div>
                  <div className="speed-circle-item">
                    <ScoreCircle score={sw.desktop.accessibility} />
                    <span>Accessibility</span>
                  </div>
                  <div className="speed-circle-item">
                    <ScoreCircle score={sw.desktop.bestPractices} />
                    <span>Best Practices</span>
                  </div>
                  <div className="speed-circle-item">
                    <ScoreCircle score={sw.desktop.seo} />
                    <span>SEO</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <h2>Pages ({data.pages.length})</h2>

          {data.pages.map((page: any, index: number) => {
            const m = page.mobile;
            const d = page.desktop;
            if (!m && !d) return null;
            const isOpen = openPages.has(index + 1000);

            return (
              <div key={index} className="seo-page-card">
                <div
                  className="seo-page-header"
                  onClick={() => togglePage(index + 1000)}
                >
                  <span className="seo-page-name">{page.pageName}</span>
                  {m && (
                    <span style={{ fontSize: "11px" }}>📱 {m.performance}</span>
                  )}
                  {d && (
                    <span style={{ fontSize: "11px" }}>🖥️ {d.performance}</span>
                  )}
                  <span className="seo-toggle">{isOpen ? "▲" : "▼"}</span>
                </div>

                {isOpen && (
                  <div className="seo-page-body">
                    <div className="speed-scores-grid">
                      {m && (
                        <div className="speed-device-section">
                          <h4>📱 Mobile</h4>
                          <div className="speed-circles">
                            <div className="speed-circle-item">
                              <ScoreCircle score={m.performance} />
                              <span>Performance</span>
                            </div>
                            <div className="speed-circle-item">
                              <ScoreCircle score={m.accessibility} />
                              <span>Accessibility</span>
                            </div>
                            <div className="speed-circle-item">
                              <ScoreCircle score={m.bestPractices} />
                              <span>Best Practices</span>
                            </div>
                            <div className="speed-circle-item">
                              <ScoreCircle score={m.seo} />
                              <span>SEO</span>
                            </div>
                          </div>
                          <table
                            className="seo-table"
                            style={{ marginTop: "10px" }}
                          >
                            <thead>
                              <tr>
                                <th>Metric</th>
                                <th>Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td>LCP</td>
                                <td>{m.lcp}</td>
                              </tr>
                              <tr>
                                <td>CLS</td>
                                <td>{m.cls}</td>
                              </tr>
                              <tr>
                                <td>FCP</td>
                                <td>{m.fcp}</td>
                              </tr>
                              <tr>
                                <td>TTFB</td>
                                <td>{m.ttfb}</td>
                              </tr>
                              <tr>
                                <td>TBT</td>
                                <td>{m.tbt}</td>
                              </tr>
                            </tbody>
                          </table>
                          {m.opportunities.length > 0 ? (
                            <div
                              className="seo-sub-section"
                              style={{ marginTop: "10px" }}
                            >
                              <h4>⚠️ Opportunities to improve</h4>
                              <table className="seo-table">
                                <thead>
                                  <tr>
                                    <th>Issue</th>
                                    <th>Impact</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {m.opportunities.map((o: any, i: number) => (
                                    <tr key={i}>
                                      <td>
                                        <strong>{o.title}</strong>
                                        <br />
                                        <span
                                          style={{
                                            fontSize: "11px",
                                            color: "#888",
                                          }}
                                        >
                                          {o.description.slice(0, 100)}...
                                        </span>
                                      </td>
                                      <td>{o.displayValue}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p
                              style={{
                                color: "#22c55e",
                                fontSize: "12px",
                                marginTop: "8px",
                              }}
                            >
                              ✅ No opportunities found
                            </p>
                          )}
                        </div>
                      )}
                      {d && (
                        <div className="speed-device-section">
                          <h4>🖥️ Desktop</h4>
                          <div className="speed-circles">
                            <div className="speed-circle-item">
                              <ScoreCircle score={d.performance} />
                              <span>Performance</span>
                            </div>
                            <div className="speed-circle-item">
                              <ScoreCircle score={d.accessibility} />
                              <span>Accessibility</span>
                            </div>
                            <div className="speed-circle-item">
                              <ScoreCircle score={d.bestPractices} />
                              <span>Best Practices</span>
                            </div>
                            <div className="speed-circle-item">
                              <ScoreCircle score={d.seo} />
                              <span>SEO</span>
                            </div>
                          </div>
                          <table
                            className="seo-table"
                            style={{ marginTop: "10px" }}
                          >
                            <thead>
                              <tr>
                                <th>Metric</th>
                                <th>Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td>LCP</td>
                                <td>{d.lcp}</td>
                              </tr>
                              <tr>
                                <td>CLS</td>
                                <td>{d.cls}</td>
                              </tr>
                              <tr>
                                <td>FCP</td>
                                <td>{d.fcp}</td>
                              </tr>
                              <tr>
                                <td>TTFB</td>
                                <td>{d.ttfb}</td>
                              </tr>
                              <tr>
                                <td>TBT</td>
                                <td>{d.tbt}</td>
                              </tr>
                            </tbody>
                          </table>
                          {d.opportunities.length > 0 ? (
                            <div
                              className="seo-sub-section"
                              style={{ marginTop: "10px" }}
                            >
                              <h4>⚠️ Opportunities to improve</h4>
                              <table className="seo-table">
                                <thead>
                                  <tr>
                                    <th>Issue</th>
                                    <th>Impact</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {d.opportunities.map((o: any, i: number) => (
                                    <tr key={i}>
                                      <td>
                                        <strong>{o.title}</strong>
                                        <br />
                                        <span
                                          style={{
                                            fontSize: "11px",
                                            color: "#888",
                                          }}
                                        >
                                          {o.description.slice(0, 100)}...
                                        </span>
                                      </td>
                                      <td>{o.displayValue}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p
                              style={{
                                color: "#22c55e",
                                fontSize: "12px",
                                marginTop: "8px",
                              }}
                            >
                              ✅ No opportunities found
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────
  // BUTTON CLICK HANDLERS
  // ─────────────────────────────────────────────

  function handleAuditClick(type: AuditType) {
    if (!siteId) {
      setError(
        "Site not detected yet. Please wait or reload inside Webflow Designer.",
      );
      return;
    }
    setOpenPages(new Set());
    if (cacheRef.current[type]) {
      setReportData(cacheRef.current[type]);
      setActiveView(type);
      return;
    }
    if (type === "asset") runAssetAudit();
    else if (type === "cms") runCMSAudit();
    else if (type === "seo") runSEOAudit();
    else if (type === "speed") runSpeedAudit();
  }

  // ─────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────

  function renderReport() {
    if (error) return <p style={{ color: "var(--danger)" }}>⚠️ {error}</p>;
    if (loading) return <p>Running {loading} audit...</p>;
    if (!reportData) return null;
    if (activeView === "asset") return <AssetReport data={reportData} />;
    if (activeView === "cms") return <CMSReport data={reportData} />;
    if (activeView === "seo") return <SEOReport data={reportData} />;
    if (activeView === "speed") return <SpeedReport data={reportData} />;
    return null;
  }

  return (
    <div className="popup">
      {activeView === "home" ? (
        <>
          <h1>Webflow SEO App 🚀</h1>
          <p>Smart SEO & CMS optimization for Webflow websites.</p>
          {siteId && (
            <p
              style={{
                fontSize: "12px",
                color: "var(--text-dim)",
                margin: "0 0 10px",
                display: "none",
              }}
            >
              🌐 Site: <strong>{siteId}</strong>
            </p>
          )}
          <div className="button-group">
            <button
              disabled={!!loading}
              onClick={() => handleAuditClick("asset")}
            >
              {loading === "asset" ? "Running..." : "Run Asset Audit"}
            </button>
            {/* <button
              disabled={!!loading}
              onClick={() => handleAuditClick("cms")}
            >
              {loading === "cms" ? "Running..." : "Run CMS Audit"}
            </button> */}
            <button
              disabled={!!loading}
              onClick={() => handleAuditClick("seo")}
            >
              {loading === "seo" ? "Running..." : "Run SEO Audit"}
            </button>
            <button
              disabled={!!loading}
              onClick={() => handleAuditClick("speed")}
            >
              {loading === "speed" ? "Running..." : "Run Page Speed Audit"}
            </button>
          </div>
          {loading && (
            <p
              style={{
                fontSize: "11.5px",
                color: "var(--text-dim)",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                padding: "10px 12px",
                margin: "0",
              }}
            >
              Running {loading} audit... please wait.
            </p>
          )}
          {error && <p style={{ color: "var(--danger)" }}>⚠️ {error}</p>}
        </>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 0",
              marginBottom: "10px",
              borderBottom: "1px solid var(--border)",
              flexShrink: 0,
              justifyContent: "space-between",
            }}
          >
            <button
              onClick={() => {
                setActiveView("home");
                setReportData(null);
                setError(null);
              }}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: "13px",
                padding: "4px 8px",
                borderRadius: "6px",
                color: "var(--text-dim)",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              ← Back
            </button>
            <span
              style={{
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--text)",
              }}
            >
              {activeView === "asset" && "Asset Audit"}
              {activeView === "cms" && "CMS Audit"}
              {activeView === "seo" && "SEO Audit"}
              {activeView === "speed" && "Speed Audit"}
            </span>
          </div>
          <div id="results">{renderReport()}</div>
        </>
      )}
    </div>
  );
};

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error('Could not find element with id "root"');
const root = ReactDOM.createRoot(rootEl);
root.render(<App />);
