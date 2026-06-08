// ─────────────────────────────────────────────
// GET CURRENT SITE SHORT NAME
// When app runs inside Webflow Designer, window.location.href looks like:
// https://katemo-1151928af19843819a-e1dbee751426b.design.webflow.com/?...
// We extract: "katemo-1151928af19843819a-e1dbee751426b"
// This matches the siteUrl in sites.json
// ─────────────────────────────────────────────

function getSiteShortName() {
  // document.referrer inside the iframe = Webflow Designer URL
  // e.g. https://katemo-1151928af19843819a-e1dbee751426b.design.webflow.com/
  const referrer = document.referrer;
  const match = referrer.match(/https?:\/\/([^.]+)\.design\.webflow\.com/);

  if (match && match[1]) {
    console.log("SITE SHORT NAME:", match[1]);
    return match[1];
  }

  console.warn("Could not detect site. Referrer:", referrer);
  return null;
}

const currentSiteShortName = getSiteShortName();

// ─────────────────────────────────────────────
// DOM ELEMENTS
// ─────────────────────────────────────────────

const assetAuditBtn = document.getElementById("assetAuditBtn");
const cmsAuditBtn = document.getElementById("cmsAuditBtn");
const generateBtn = document.getElementById("generateBtn");
const seoAuditBtn = document.getElementById("seoAuditBtn");
const speedAuditBtn = document.getElementById("speedAuditBtn");
const results = document.getElementById("results");

// ─────────────────────────────────────────────
// CACHE
// ─────────────────────────────────────────────
const auditCache = {
  asset: null,
  cms: null,
  seo: null,
  speed: null,
};

const auditTimestamp = {
  asset: null,
  cms: null,
  seo: null,
  speed: null,
};

function getTimeAgo(timestamp) {
  if (!timestamp) return "";
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  return `${Math.floor(hours / 24)} day${Math.floor(hours / 24) > 1 ? "s" : ""} ago`;
}

function renderRefreshHeader(auditType, onRefresh) {
  const timeAgo = getTimeAgo(auditTimestamp[auditType]);
  const header = document.createElement("div");
  header.style.cssText = `
    display:flex;
    justify-content:space-between;
    align-items:flex-start;
    padding:10px 0;
    margin-bottom:12px;
    border-bottom:1px solid #e5e5e5;
  `;
  header.innerHTML = `
    <div style="font-size:12px;color:#888;">
      <div>Last updated</div>
      <div style="font-weight:600;color:#333;">${timeAgo}</div>
    </div>
    <button id="refreshBtn" style="
      background:none;
      border:1px solid #e5e5e5;
      border-radius:6px;
      padding:4px 8px;
      cursor:pointer;
      font-size:14px;
    ">🔄</button>
  `;
  header.querySelector("#refreshBtn").addEventListener("click", onRefresh);
  return header;
}

// ─────────────────────────────────────────────
// GUARD — if site not detected, show error
// ─────────────────────────────────────────────

if (!currentSiteShortName) {
  results.innerHTML = `
    <p style="color:red;">
      ⚠️ Could not detect the current Webflow site.<br/>
      Please make sure you are opening this app inside Webflow Designer.
    </p>
  `;
}

// ─────────────────────────────────────────────
// ASSET AUDIT
// ─────────────────────────────────────────────

assetAuditBtn.addEventListener("click", async () => {
  if (auditCache.asset) {
    renderAssetReport(auditCache.asset);
    return;
  }
  await runAssetAudit();
});

async function runAssetAudit() {
  assetAuditBtn.disabled = true;
  results.innerHTML = "<p>Running Audit...</p>";

  try {
    const response = await fetch(`/assets?siteShortName=${currentSiteShortName}`);
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.message || "Server error");
    }
    const data = await response.json();
    auditCache.asset = data;
    auditTimestamp.asset = Date.now();
    renderAssetReport(data);
  } catch (error) {
    console.log(error);
    results.innerHTML = `<p>Error running audit: ${error.message}</p>`;
  } finally {
    assetAuditBtn.disabled = false;
    assetAuditBtn.textContent = "Run Asset Audit";
  }
}

function renderAssetReport(data) {
  const assets = data.assets;
  const missingAlt = assets.filter((asset) => !asset.altText);

  results.innerHTML = `
    <h2>❌ Missing Alt Text (${missingAlt.length})</h2>
    <button id="saveAllBtn">Save All Alt Text</button>
    <div class="card-grid"></div>
  `;

 const header = renderRefreshHeader("asset", () => {
  auditCache.asset = null;
  auditTimestamp.asset = null;
  runAssetAudit();
});
  results.insertBefore(header, results.firstChild);

  const cardGrid = document.querySelector(".card-grid");
  missingAlt.forEach((asset) => {
    cardGrid.innerHTML += `
      <div class="card">
        <img src="${asset.hostedUrl}" />
        <h3>${asset.displayName}</h3>
        <p id="status-${asset.id}">Missing alt text</p>
        <input type="text" placeholder="Enter alt text" id="input-${asset.id}" />
        <button onclick="saveAltText('${asset.id}')">Save</button>
      </div>
    `;
  });
}

// ─────────────────────────────────────────────
// SAVE SINGLE ALT TEXT
// ─────────────────────────────────────────────

async function saveAltText(assetId) {
  const input = document.getElementById(`input-${assetId}`);
  const status = document.getElementById(`status-${assetId}`);
  const altText = input.value;

  if (!altText) {
    status.textContent = "⚠️ Please enter alt text";
    status.style.color = "#f97316";
    return;
  }

  try {
    status.textContent = "Saving...";
    status.style.color = "#888";

    const response = await fetch(
      `/update-alt?siteShortName=${currentSiteShortName}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId, altText }),
      },
    );

    const data = await response.json();
    status.textContent = "✅ Alt text saved";
    status.style.color = "#22c55e";
  } catch (error) {
    console.log(error);
    status.textContent = "❌ Error saving";
    status.style.color = "#ef4444";
  }
}

// ─────────────────────────────────────────────
// GENERATE AI ALT TEXT (Ollama)
// ─────────────────────────────────────────────

generateBtn.addEventListener("click", async () => {
  const cards = document.querySelectorAll(".card");

  if (cards.length === 0) {
    alert("Please run Asset Audit first.");
    return;
  }

  for (const card of cards) {
    const fileName = card.querySelector("h3").innerText;
    const imageUrl = card.querySelector("img").src;
    const input = card.querySelector("input");

    input.value = "Generating...";

    try {
      const response = await fetch("/generate-alt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName, imageUrl }),
      });

      const data = await response.json();
      input.value = data.altText;
    } catch (error) {
      console.log(error);
      input.value = "Error generating";
    }
  }
});

// ─────────────────────────────────────────────
// SAVE ALL ALT TEXT
// ─────────────────────────────────────────────

document.addEventListener("click", async (e) => {
  if (e.target.id === "saveAllBtn") {
    const cards = document.querySelectorAll(".card");

    for (const card of cards) {
      const saveButton = card.querySelector("button[onclick]");
      if (saveButton) {
        saveButton.click();
      }
    }
  }
});

// ─────────────────────────────────────────────
// CMS AUDIT
// ─────────────────────────────────────────────

cmsAuditBtn.addEventListener("click", async () => {
  if (auditCache.cms) {
    renderCMSReport(auditCache.cms);
    return;
  }
  await runCMSAudit();
});

async function runCMSAudit() {
  cmsAuditBtn.disabled = true;
  results.innerHTML = `<p>Running CMS Audit...</p>`;

  try {
    const response = await fetch(`/unused-fields?siteShortName=${currentSiteShortName}`);
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.message || "Server error");
    }
    const data = await response.json();
    auditCache.cms = data;
    auditTimestamp.cms = Date.now();
    renderCMSReport(data);
  } catch (error) {
    console.log(error);
    results.innerHTML = `<p>Error running CMS audit: ${error.message}</p>`;
  } finally {
    cmsAuditBtn.disabled = false;
    cmsAuditBtn.textContent = "Run CMS Audit";
  }
}

function renderCMSReport(data) {
  const rows = data.report.map((item) => `
    <tr>
      <td>${item.collectionName}</td>
      <td>${item.fieldName}</td>
      <td>${item.type}</td>
      <td class="${item.status === "Used" ? "status-used" : "status-unused"}">
        ${item.status}
      </td>
    </tr>
  `).join("");

  results.innerHTML = `
    <div class="cms-report-wrapper">
      <div class="table-wrapper">
        <table class="report-table">
          <thead>
            <tr>
              <th>Collection</th>
              <th>Field</th>
              <th>Type</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;

  const header = renderRefreshHeader("cms", () => {
    auditCache.cms = null;
    auditTimestamp.cms = null;
    runCMSAudit();
  });
  results.insertBefore(header, results.firstChild);
}

// ─────────────────────────────────────────────
// SEO AUDIT
// ─────────────────────────────────────────────

seoAuditBtn.addEventListener("click", async () => {
  if (auditCache.seo) {
    renderSEOReport(auditCache.seo);
    return;
  }
  await runSEOAudit();
});

async function runSEOAudit() {
  seoAuditBtn.disabled = true;
  results.innerHTML = `<p>Running SEO Audit... This may take a moment.</p>`;

  try {
    const response = await fetch(`/seo-audit?siteShortName=${currentSiteShortName}`);
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.message || "Server error");
    }
    const data = await response.json();
    auditCache.seo = data;
    auditTimestamp.seo = Date.now();
    renderSEOReport(data);
  } catch (error) {
    console.log(error);
    results.innerHTML = `<p>Error running SEO audit: ${error.message}</p>`;
  } finally {
    seoAuditBtn.disabled = false;
    seoAuditBtn.textContent = "Run SEO Audit";
  }
}

function renderSEOReport(data) {
  const sw = data.siteWide;

  function siteWideIcon(val) { return val ? "✅" : "❌"; }
  function icon(status) {
    if (status === "pass") return "✅";
    if (status === "warning") return "⚠️";
    return "❌";
  }

  let html = `
    <div class="seo-report">
      <div class="seo-sitewide">
        <h2>Site-wide</h2>
        <div class="sitewide-grid">
          <div class="sitewide-item">
            ${siteWideIcon(sw.sitemap)} <span>Sitemap.xml</span>
            ${sw.sitemap ? `<span style="font-size:11px;color:${sw.sitemapValid ? '#22c55e' : '#ef4444'}">(${sw.sitemapIssue})</span>` : ""}
          </div>
          <div class="sitewide-item">
            ${siteWideIcon(sw.robotsTxt)} <span>Robots.txt</span>
            ${sw.robotsTxt && !sw.robotsTxtValid ? `<span style="color:#ef4444;font-size:11px;">(${sw.robotsTxtIssue})</span>` : ""}
          </div>
          <div class="sitewide-item">
            ${siteWideIcon(sw.llmsTxt)} <span>LLMs.txt</span>
            ${sw.llmsTxt ? `<span style="font-size:11px;color:${sw.llmsTxtValid ? '#22c55e' : '#ef4444'}">(${sw.llmsTxtIssue})</span>` : `<span style="font-size:11px;color:#ef4444">(${sw.llmsTxtIssue})</span>`}
          </div>
        </div>
      </div>
      <h2>Pages (${data.pages.length})</h2>
  `;

  data.pages.forEach((page, index) => {
    const checks = page.checks;
    const issues = Object.values(checks).filter(
      (c) => c.status === "fail" || c.status === "warning"
    ).length + page.imagesWithoutAlt.length + page.linksWithoutAnchor.length + page.brokenLinks.length + page.duplicateTitleWith.length + page.duplicateDescWith.length;

    html += `
      <div class="seo-page-card">
        <div class="seo-page-header" onclick="togglePage(${index})">
          <span class="seo-page-name">${page.pageName}</span>
          ${issues > 0
            ? `<span class="seo-issue-count">${issues} issue${issues > 1 ? "s" : ""}</span>`
            : `<span class="seo-no-issues">✅ No issues</span>`
          }
          <span class="seo-toggle" id="toggle-icon-${index}">▼</span>
        </div>
        <div class="seo-page-body" id="page-body-${index}" style="display:none;">
          <table class="seo-table">
            <thead><tr><th>Check</th><th>Status</th><th>Details</th></tr></thead>
            <tbody>
              <tr><td>Meta Title</td><td>${icon(checks.metaTitle.status)}</td><td>${checks.metaTitle.message}</td></tr>
              <tr><td>Meta Description</td><td>${icon(checks.metaDescription.status)}</td><td>${checks.metaDescription.message}</td></tr>
              <tr><td>OG Title</td><td>${icon(checks.ogTitle.status)}</td><td>${checks.ogTitle.message}</td></tr>
              <tr><td>OG Description</td><td>${icon(checks.ogDescription.status)}</td><td>${checks.ogDescription.message}</td></tr>
              <tr><td>OG Image</td><td>${icon(checks.ogImage.status)}</td><td>${checks.ogImage.message}</td></tr>
              <tr><td>H1</td><td>${icon(checks.h1.status)}</td><td>${checks.h1.message}</td></tr>
              <tr><td>Heading Hierarchy</td><td>${icon(checks.headingHierarchy.status)}</td><td>${checks.headingHierarchy.message}</td></tr>
              <tr><td>Canonical</td><td>${icon(checks.canonical.status)}</td><td>${checks.canonical.message}</td></tr>
              <tr><td>Noindex</td><td>${icon(checks.noindex.status)}</td><td>${checks.noindex.message}</td></tr>
              <tr><td>Structured Data</td><td>${icon(checks.structuredData.status)}</td><td>${checks.structuredData.message}</td></tr>
              ${page.duplicateTitleWith.length > 0 ? `<tr><td>Duplicate Title</td><td>❌</td><td>Same title as: ${page.duplicateTitleWith.join(", ")}</td></tr>` : ""}
              ${page.duplicateDescWith.length > 0 ? `<tr><td>Duplicate Description</td><td>❌</td><td>Same description as: ${page.duplicateDescWith.join(", ")}</td></tr>` : ""}
            </tbody>
          </table>

          ${page.imagesWithoutAlt.length > 0 ? `
            <div class="seo-sub-section">
              <h4>❌ Images Without Alt Text (${page.imagesWithoutAlt.length})</h4>
              <div class="seo-image-grid">
                ${page.imagesWithoutAlt.map((img) => `
                  <div class="seo-image-item">
                    <a href="${img.src}" target="_blank"><img src="${img.src}" /></a>
                  </div>
                `).join("")}
              </div>
            </div>
          ` : ""}

          ${page.linksWithoutAnchor.length > 0 ? `
            <div class="seo-sub-section">
              <h4>❌ Links Without Anchor Text (${page.linksWithoutAnchor.length})</h4>
              <table class="seo-table">
                <thead><tr><th>URL</th><th>Page</th></tr></thead>
                <tbody>
                  ${page.linksWithoutAnchor.map((link) => `
                    <tr><td>${link.url}</td><td>${link.page}</td></tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          ` : ""}

          ${page.brokenLinks.length > 0 ? `
            <div class="seo-sub-section">
              <h4>❌ Broken Links (${page.brokenLinks.length})</h4>
              <table class="seo-table">
                <thead><tr><th>URL</th><th>Type</th></tr></thead>
                <tbody>
                  ${page.brokenLinks.map((link) => `
                    <tr><td>${link.url}</td><td>${link.type}</td></tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          ` : ""}

        </div>
      </div>
    `;
  });

  html += `</div>`;
  results.innerHTML = html;

  const header = renderRefreshHeader("seo", () => {
    auditCache.seo = null;
    auditTimestamp.seo = null;
    runSEOAudit();
  });
  results.insertBefore(header, results.firstChild);
}

function togglePage(index) {
  const body = document.getElementById(`page-body-${index}`);
  const icon = document.getElementById(`toggle-icon-${index}`);

  if (body.style.display === "none") {
    body.style.display = "block";
    icon.textContent = "▲";
  } else {
    body.style.display = "none";
    icon.textContent = "▼";
  }
}

// ─────────────────────────────────────────────
// SPEED AUDIT
// ─────────────────────────────────────────────

speedAuditBtn.addEventListener("click", async () => {
  if (auditCache.speed) {
    renderSpeedReport(auditCache.speed);
    return;
  }
  await runSpeedAudit();
});

async function runSpeedAudit() {
  speedAuditBtn.disabled = true;
  results.innerHTML = `<p>Running Speed Audit... This may take a few minutes.</p>`;

  try {
    const response = await fetch(`/speed-audit?siteShortName=${currentSiteShortName}`);
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.message || "Server error");
    }
    const data = await response.json();
    auditCache.speed = data;
    auditTimestamp.speed = Date.now();
    renderSpeedReport(data);
  } catch (error) {
    console.log(error);
    results.innerHTML = `<p>Error running speed audit: ${error.message}</p>`;
  } finally {
    speedAuditBtn.disabled = false;
    speedAuditBtn.textContent = "Run Speed Audit";
  }
}

function renderSpeedReport(data) {
  function scoreColor(score) {
    if (score >= 90) return "#22c55e";
    if (score >= 50) return "#f97316";
    return "#ef4444";
  }

  function scoreCircle(score) {
    return `<span style="
      display:inline-block;
      width:36px;height:36px;
      border-radius:50%;
      background:${scoreColor(score)};
      color:white;font-size:11px;
      font-weight:700;line-height:36px;
      text-align:center;
    ">${score}</span>`;
  }

  const sw = data.siteWide;

  let html = `
    <div class="speed-report">
      <div class="seo-sitewide">
        <h2>Site-wide Average</h2>
        <div style="display:grid;grid-template-columns:1fr;gap:16px;margin-top:10px;">
          <div>
            <h4 style="font-size:13px;margin:0 0 8px 0;">📱 Mobile</h4>
            <div class="speed-circles">
              <div class="speed-circle-item">${scoreCircle(sw.mobile.performance)}<span>Performance</span></div>
              <div class="speed-circle-item">${scoreCircle(sw.mobile.accessibility)}<span>Accessibility</span></div>
              <div class="speed-circle-item">${scoreCircle(sw.mobile.bestPractices)}<span>Best Practices</span></div>
              <div class="speed-circle-item">${scoreCircle(sw.mobile.seo)}<span>SEO</span></div>
            </div>
          </div>
          <div>
            <h4 style="font-size:13px;margin:0 0 8px 0;">🖥️ Desktop</h4>
            <div class="speed-circles">
              <div class="speed-circle-item">${scoreCircle(sw.desktop.performance)}<span>Performance</span></div>
              <div class="speed-circle-item">${scoreCircle(sw.desktop.accessibility)}<span>Accessibility</span></div>
              <div class="speed-circle-item">${scoreCircle(sw.desktop.bestPractices)}<span>Best Practices</span></div>
              <div class="speed-circle-item">${scoreCircle(sw.desktop.seo)}<span>SEO</span></div>
            </div>
          </div>
        </div>
      </div>
      <h2>Pages (${data.pages.length})</h2>
  `;

  data.pages.forEach((page, index) => {
    const m = page.mobile;
    const d = page.desktop;
    if (!m && !d) return;

    html += `
      <div class="seo-page-card">
        <div class="seo-page-header" onclick="togglePage(${index})">
          <span class="seo-page-name">${page.pageName}</span>
          ${m ? `<span style="font-size:11px;">📱 ${m.performance}</span>` : ""}
          ${d ? `<span style="font-size:11px;">🖥️ ${d.performance}</span>` : ""}
          <span class="seo-toggle" id="toggle-icon-${index}">▼</span>
        </div>
        <div class="seo-page-body" id="page-body-${index}" style="display:none;">
          <div class="speed-scores-grid">
            ${m ? `
              <div class="speed-device-section">
                <h4>📱 Mobile</h4>
                <div class="speed-circles">
                  <div class="speed-circle-item">${scoreCircle(m.performance)}<span>Performance</span></div>
                  <div class="speed-circle-item">${scoreCircle(m.accessibility)}<span>Accessibility</span></div>
                  <div class="speed-circle-item">${scoreCircle(m.bestPractices)}<span>Best Practices</span></div>
                  <div class="speed-circle-item">${scoreCircle(m.seo)}<span>SEO</span></div>
                </div>
                <table class="seo-table" style="margin-top:10px;">
                  <thead><tr><th>Metric</th><th>Value</th></tr></thead>
                  <tbody>
                    <tr><td>LCP</td><td>${m.lcp}</td></tr>
                    <tr><td>CLS</td><td>${m.cls}</td></tr>
                    <tr><td>FCP</td><td>${m.fcp}</td></tr>
                    <tr><td>TTFB</td><td>${m.ttfb}</td></tr>
                    <tr><td>TBT</td><td>${m.tbt}</td></tr>
                  </tbody>
                </table>
                ${m.opportunities.length > 0 ? `
                  <div class="seo-sub-section" style="margin-top:10px;">
                    <h4>⚠️ Opportunities to improve</h4>
                    <table class="seo-table">
                      <thead><tr><th>Issue</th><th>Impact</th></tr></thead>
                      <tbody>
                        ${m.opportunities.map((o) => `
                          <tr>
                            <td><strong>${o.title}</strong><br/>
                            <span style="font-size:11px;color:#888;">${o.description.slice(0, 100)}...</span></td>
                            <td>${o.displayValue}</td>
                          </tr>
                        `).join("")}
                      </tbody>
                    </table>
                  </div>
                ` : `<p style="color:#22c55e;font-size:12px;margin-top:8px;">✅ No opportunities found</p>`}
              </div>
            ` : ""}

            ${d ? `
              <div class="speed-device-section">
                <h4>🖥️ Desktop</h4>
                <div class="speed-circles">
                  <div class="speed-circle-item">${scoreCircle(d.performance)}<span>Performance</span></div>
                  <div class="speed-circle-item">${scoreCircle(d.accessibility)}<span>Accessibility</span></div>
                  <div class="speed-circle-item">${scoreCircle(d.bestPractices)}<span>Best Practices</span></div>
                  <div class="speed-circle-item">${scoreCircle(d.seo)}<span>SEO</span></div>
                </div>
                <table class="seo-table" style="margin-top:10px;">
                  <thead><tr><th>Metric</th><th>Value</th></tr></thead>
                  <tbody>
                    <tr><td>LCP</td><td>${d.lcp}</td></tr>
                    <tr><td>CLS</td><td>${d.cls}</td></tr>
                    <tr><td>FCP</td><td>${d.fcp}</td></tr>
                    <tr><td>TTFB</td><td>${d.ttfb}</td></tr>
                    <tr><td>TBT</td><td>${d.tbt}</td></tr>
                  </tbody>
                </table>
                ${d.opportunities.length > 0 ? `
                  <div class="seo-sub-section" style="margin-top:10px;">
                    <h4>⚠️ Opportunities to improve</h4>
                    <table class="seo-table">
                      <thead><tr><th>Issue</th><th>Impact</th></tr></thead>
                      <tbody>
                        ${d.opportunities.map((o) => `
                          <tr>
                            <td><strong>${o.title}</strong><br/>
                            <span style="font-size:11px;color:#888;">${o.description.slice(0, 100)}...</span></td>
                            <td>${o.displayValue}</td>
                          </tr>
                        `).join("")}
                      </tbody>
                    </table>
                  </div>
                ` : `<p style="color:#22c55e;font-size:12px;margin-top:8px;">✅ No opportunities found</p>`}
              </div>
            ` : ""}
          </div>
        </div>
      </div>
    `;
  });

  html += `</div>`;
  results.innerHTML = html;

  const header = renderRefreshHeader("speed", () => {
    auditCache.speed = null;
    auditTimestamp.speed = null;
    runSpeedAudit();
  });
  results.insertBefore(header, results.firstChild);
}
