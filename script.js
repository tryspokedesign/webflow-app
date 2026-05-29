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
const generateBtn = document.getElementById("generateBtn"); // ← was missing before
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
    alert(data.message);
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
