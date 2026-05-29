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
const results = document.getElementById("results");

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
  results.innerHTML = "<p>Running Audit...</p>";

  try {
    const response = await fetch(
      `/assets?siteShortName=${currentSiteShortName}`,
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.message || "Server error");
    }

    const data = await response.json();
    const assets = data.assets;

    // Filter assets with missing alt text
    const missingAlt = assets.filter((asset) => !asset.altText);

    results.innerHTML = `
      <h2>❌ Missing Alt Text (${missingAlt.length})</h2>
      <button id="saveAllBtn">Save All Alt Text</button>
      <div class="card-grid"></div>
    `;

    const cardGrid = document.querySelector(".card-grid");

    missingAlt.forEach((asset) => {
      cardGrid.innerHTML += `
        <div class="card">
          <img src="${asset.hostedUrl}" />
          <h3>${asset.displayName}</h3>
          <p>Missing alt text</p>
          <input
            type="text"
            placeholder="Enter alt text"
            id="input-${asset.id}"
          />
          <button onclick="saveAltText('${asset.id}')">Save</button>
        </div>
      `;
    });
  } catch (error) {
    console.log(error);
    results.innerHTML = `<p>Error running audit: ${error.message}</p>`;
  }
});

// ─────────────────────────────────────────────
// SAVE SINGLE ALT TEXT
// ─────────────────────────────────────────────

async function saveAltText(assetId) {
  const input = document.getElementById(`input-${assetId}`);
  const altText = input.value;

  if (!altText) {
    alert("Please enter alt text");
    return;
  }

  try {
    const response = await fetch(
      `/update-alt?siteShortName=${currentSiteShortName}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId, altText }),
      },
    );

    const data = await response.json();
    // alert(data.message);
    alert("All alt texts saved 🚀");
  } catch (error) {
    console.log(error);
    alert("Error updating alt text");
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
      // Target the Save button specifically (has onclick attribute)
      const saveButton = card.querySelector("button[onclick]");
      if (saveButton) {
        saveButton.click();
      }
    }

    alert("All alt texts saved 🚀");
  }
});

// ─────────────────────────────────────────────
// CMS AUDIT
// ─────────────────────────────────────────────

cmsAuditBtn.addEventListener("click", async () => {
  results.innerHTML = `<p>Running CMS Audit...</p>`;

  try {
    const response = await fetch(
      `/unused-fields?siteShortName=${currentSiteShortName}`,
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.message || "Server error");
    }

    const data = await response.json();

    const usedCount = data.report.filter(
      (item) => item.status === "Used",
    ).length;
    const unusedCount = data.report.filter(
      (item) => item.status === "Unused",
    ).length;

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
            <tbody id="report-body"></tbody>
          </table>
        </div>
      </div>
    `;

    const reportBody = document.getElementById("report-body");

    data.report.forEach((item) => {
      const row = document.createElement("tr");

      row.innerHTML = `
        <td>${item.collectionName}</td>
        <td>${item.fieldName}</td>
        <td>${item.type}</td>
        <td class="${item.status === "Used" ? "status-used" : "status-unused"}">
          ${item.status}
        </td>
      `;

      reportBody.appendChild(row);
    });
  } catch (error) {
    console.log(error);
    results.innerHTML = `<p>Error running CMS audit: ${error.message}</p>`;
  }
});

// ─────────────────────────────────────────────
// SEO AUDIT
// ─────────────────────────────────────────────

seoAuditBtn.addEventListener("click", async () => {
  results.innerHTML = `<p>Running SEO Audit... This may take a moment.</p>`;

  try {
    const response = await fetch(
      `/seo-audit?siteShortName=${currentSiteShortName}`,
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.message || "Server error");
    }

    const data = await response.json();

    const sw = data.siteWide;

    function siteWideIcon(val) {
      return val ? "✅" : "❌";
    }

    let html = `
      <div class="seo-report">
        <div class="seo-sitewide">
          <h2>Site-wide</h2>
          <div class="sitewide-grid">
            <div class="sitewide-item">${siteWideIcon(sw.sitemap)} <span>Sitemap.xml</span>
            ${sw.sitemap ? `<span style="font-size:11px; color:${sw.sitemapValid ? "#22c55e" : "#ef4444"}">(${sw.sitemapIssue})</span>` : ""}</div>
            <div class="sitewide-item">${siteWideIcon(sw.robotsTxt)} <span>Robots.txt</span>
            ${sw.robotsTxt && !sw.robotsTxtValid ? `<span style="color:#ef4444; font-size:11px;">(${sw.robotsTxtIssue})</span>` : ""}</div>
           <div class="sitewide-item">${siteWideIcon(sw.llmsTxt)} <span>LLMs.txt</span>
           ${
             sw.llmsTxt
               ? `<span style="font-size:11px; color:${sw.llmsTxtValid ? "#22c55e" : "#ef4444"}">(${sw.llmsTxtIssue})</span>`
               : `
           <span style="font-size:11px; color:#ef4444">(${sw.llmsTxtIssue})</span>`
           }</div>
          </div>
        </div>
        <h2>Pages (${data.pages.length})</h2>
    `;

    data.pages.forEach((page, index) => {
      const checks = page.checks;

      function icon(status) {
        if (status === "pass") return "✅";
        if (status === "warning") return "⚠️";
        return "❌";
      }

      const issues =
        Object.values(checks).filter(
          (c) => c.status === "fail" || c.status === "warning",
        ).length +
        page.imagesWithoutAlt.length +
        page.linksWithoutAnchor.length;

      html += `
        <div class="seo-page-card">
          <div class="seo-page-header" onclick="togglePage(${index})">
            <span class="seo-page-name">${page.pageName}</span>
            ${
              issues > 0
                ? `<span class="seo-issue-count">${issues} issue${issues > 1 ? "s" : ""}</span>`
                : `<span class="seo-no-issues">✅ No issues</span>`
            }
            <span class="seo-toggle" id="toggle-icon-${index}">▼</span>
          </div>
          <div class="seo-page-body" id="page-body-${index}" style="display:none;">
            <table class="seo-table">
              <thead>
                <tr><th>Check</th><th>Status</th><th>Details</th></tr>
              </thead>
              <tbody>
                <tr><td>Meta Title</td><td>${icon(checks.metaTitle.status)}</td><td>${checks.metaTitle.message}</td></tr>
                <tr><td>Meta Description</td><td>${icon(checks.metaDescription.status)}</td><td>${checks.metaDescription.message}</td></tr>
                <tr><td>OG Title</td><td>${icon(checks.ogTitle.status)}</td><td>${checks.ogTitle.message}</td></tr>
                <tr><td>OG Description</td><td>${icon(checks.ogDescription.status)}</td><td>${checks.ogDescription.message}</td></tr>
                <tr><td>H1</td><td>${icon(checks.h1.status)}</td><td>${checks.h1.message}</td></tr>
                <tr><td>Heading Hierarchy</td><td>${icon(checks.headingHierarchy.status)}</td><td>${checks.headingHierarchy.message}</td></tr>
                <tr><td>Canonical</td><td>${icon(checks.canonical.status)}</td><td>${checks.canonical.message}</td></tr>
                <tr><td>Noindex</td><td>${icon(checks.noindex.status)}</td><td>${checks.noindex.message}</td></tr>
                <tr><td>OG Image</td><td>${icon(checks.ogImage.status)}</td><td>${checks.ogImage.message}</td></tr>
                <tr><td>Structured Data</td><td>${icon(checks.structuredData.status)}</td><td>${checks.structuredData.message}</td></tr>
                ${
                  page.duplicateTitleWith.length > 0
                    ? `
                <tr><td>Duplicate Title</td>
                <td>❌</td>
                <td>Same title as: ${page.duplicateTitleWith.join(", ")}</td>
                </tr>
                 `
                    : ""
                }
                ${
                  page.duplicateDescWith.length > 0
                    ? `
                <tr>
                <td>Duplicate Description</td>
                <td>❌</td> 
                <td>Same description as: ${page.duplicateDescWith.join(", ")}</td>
                </tr>
                `
                    : ""
                }
              </tbody>
            </table>

            ${
              page.imagesWithoutAlt.length > 0
                ? `
              <div class="seo-sub-section">
                <h4>❌ Images Without Alt Text (${page.imagesWithoutAlt.length})</h4>
                <div class="seo-image-grid">
                  ${page.imagesWithoutAlt
                    .map(
                      (img) => `
                    <div class="seo-image-item"><a href="${img.src}" target="_blank">
                    <img src="${img.src}" /></a></div>
                  `,
                    )
                    .join("")}
                </div>
              </div>
            `
                : ""
            }

            ${
              page.linksWithoutAnchor.length > 0
                ? `
              <div class="seo-sub-section">
                <h4>❌ Links Without Anchor Text (${page.linksWithoutAnchor.length})</h4>
                <table class="seo-table">
                  <thead><tr><th>URL</th><th>Page</th></tr></thead>
                  <tbody>
                    ${page.linksWithoutAnchor
                      .map(
                        (link) => `
                      <tr><td>${link.url}</td><td>${link.page}</td></tr>
                    `,
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>
            `
                : ""
            }

            ${
              page.brokenLinks.length > 0
                ? `
              <div class="seo-sub-section">
               <h4>❌ Broken Links (${page.brokenLinks.length})</h4>
               <table class="seo-table">
               <thead><tr><th>URL</th><th>Type</th></tr></thead>
               <tbody>
            ${page.brokenLinks
              .map(
                (link) => `
               <tr>
                <td>${link.url}</td>
                <td>${link.type}</td>
               </tr>
            `,
              )
              .join("")}
            </tbody>
          </table>
         </div>
         `
                : ""
            }
          </div>
        </div>
      `;
    });

    html += `</div>`;
    results.innerHTML = html;
  } catch (error) {
    console.log(error);
    results.innerHTML = `<p>Error running SEO audit: ${error.message}</p>`;
  }
});

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
