const express = require("express");
const path = require("path");
const axios = require("axios");
const cors = require("cors");
const fs = require("fs");
const sharp = require("sharp");
const cheerio = require("cheerio");

const app = express();
app.use(express.json());
app.use(cors());

// ─────────────────────────────────────────────
// SITES.JSON HELPERS
// ─────────────────────────────────────────────

function getSavedSites() {
  try {
    const data = fs.readFileSync("sites.json", "utf8");
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

function saveSites(sites) {
  fs.writeFileSync("sites.json", JSON.stringify(sites, null, 2));
}

// ─────────────────────────────────────────────
// GET SITE CONFIG
// Reads ?siteShortName=xxx from the request
// Matches against siteUrl in sites.json
// e.g. siteShortName = "katemo-1151928af19843819a-e1dbee751426b"
// siteUrl in sites.json = "https://katemo-1151928af19843819a-e1dbee751426b.webflow.io"
// ─────────────────────────────────────────────

function getSiteConfig(req) {
  const siteShortName = req.query.siteShortName;

  if (!siteShortName) {
    throw new Error("Missing siteShortName query param");
  }

  const savedSites = getSavedSites();

  // Match by checking if siteUrl contains the short name
  const currentSite = savedSites.find((site) =>
    site.siteUrl.includes(siteShortName),
  );

  if (!currentSite) {
    throw new Error(`Site not found for shortName: ${siteShortName}`);
  }

  return {
    SITE_ID: currentSite.siteId,
    ACCESS_TOKEN: currentSite.accessToken,
    SITE_URL: currentSite.siteUrl.replace(/\/$/, ""), // remove trailing slash
  };
}

const PORT = 3000;

// Serve frontend files
app.use(express.static(path.join(__dirname)));

// Home route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ─────────────────────────────────────────────
// AUTH CALLBACK — saves new site to sites.json
// ─────────────────────────────────────────────

app.get("/auth/callback", async (req, res) => {
  const code = req.query.code;

  console.log("Authorization Code:", code);

  try {
    const params = new URLSearchParams();
    params.append(
      "client_id",
      "37cd60ca0779c15840e1f94fd81e8630d5e8a517ff6b0ae468f1200df0058bdc",
    );
    params.append(
      "client_secret",
      "85a0f6fbbec4f8335454b6e77bd1956ba3d1d4a0b18214f1e901f394ea898c86",
    );
    params.append("code", code);
    params.append("grant_type", "authorization_code");

    const response = await axios.post(
      "https://api.webflow.com/oauth/access_token",
      params,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );

    console.log("ACCESS TOKEN:", response.data.access_token);

    const accessToken = response.data.access_token;

    // FETCH CONNECTED SITES
    const sitesResponse = await axios.get("https://api.webflow.com/v2/sites", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        accept: "application/json",
      },
    });

    const fetchedSites = sitesResponse.data.sites || [];

    // LOAD OLD SAVED SITES
    const savedSites = getSavedSites();

    // LOOP AND SAVE / UPDATE
    fetchedSites.forEach((site) => {
      const existingSite = savedSites.find((s) => s.siteId === site.id);

      const siteData = {
        siteId: site.id,
        siteName: site.displayName,
        siteUrl: `https://${site.shortName}.webflow.io`,
        accessToken,
      };

      if (existingSite) {
        existingSite.accessToken = accessToken;
        existingSite.siteName = site.displayName;
        existingSite.siteUrl = `https://${site.shortName}.webflow.io`;
      } else {
        savedSites.push(siteData);
      }
    });

    saveSites(savedSites);

    console.log("SITES SAVED SUCCESSFULLY 🚀");

    // Get the first saved site's short name to redirect to designer
    const installedSite = fetchedSites[0];
    const shortName = installedSite.shortName;

    res.redirect(`https://${shortName}.design.webflow.com`);
  } catch (error) {
    console.log(JSON.stringify(error.response?.data, null, 2));
    res.send("Error getting access token");
  }
});

// ─────────────────────────────────────────────
// ASSETS
// ─────────────────────────────────────────────

app.get("/assets", async (req, res) => {
  try {
    const { SITE_ID, ACCESS_TOKEN } = getSiteConfig(req);

    const response = await axios.get(
      `https://api.webflow.com/v2/sites/${SITE_ID}/assets`,
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          accept: "application/json",
          "accept-version": "1.0.0",
        },
      },
    );

    console.log("Assets fetched for site:", SITE_ID);

    res.json(response.data);
  } catch (error) {
    console.log(error.response?.data || error.message);
    res.status(500).json({ message: error.message || "Error fetching assets" });
  }
});

// ─────────────────────────────────────────────
// GENERATE ALT TEXT (Ollama / llava)
// ─────────────────────────────────────────────

app.post("/generate-alt", async (req, res) => {
  const { fileName, imageUrl } = req.body;

  try {
    console.log("Generating alt text for:", fileName);

    let response;

    // SVG — use filename only (no vision needed)
    if (fileName.toLowerCase().endsWith(".svg")) {
      console.log("Using SVG text mode");

      response = await axios.post("http://localhost:11434/api/generate", {
        model: "llava",
        prompt: `Generate short SEO-friendly alt text for this SVG icon filename: ${fileName}. Keep under 8 words.`,
        stream: false,
      });
    } else {
      console.log("Using Vision AI mode");

      // Download and convert image to PNG
      const imageResponse = await axios.get(imageUrl, {
        responseType: "arraybuffer",
      });

      const pngBuffer = await sharp(imageResponse.data)
        .png()
        .resize({ width: 800 })
        .toBuffer();

      const base64Image = pngBuffer.toString("base64");

      response = await axios.post("http://localhost:11434/api/generate", {
        model: "llava",
        prompt:
          "You are an SEO assistant. Generate short descriptive alt text for this image. Keep under 12 words.",
        images: [base64Image],
        stream: false,
      });
    }

    const altText = response.data.response.replace(/"/g, "").trim();

    console.log("Generated Alt Text:", altText);

    res.json({ altText });
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ message: "Error generating alt text" });
  }
});

// ─────────────────────────────────────────────
// UPDATE ALT TEXT
// ─────────────────────────────────────────────

app.post("/update-alt", async (req, res) => {
  const { assetId, altText } = req.body;

  try {
    const { ACCESS_TOKEN } = getSiteConfig(req);

    await axios.patch(
      `https://api.webflow.com/v2/assets/${assetId}`,
      { altText: altText, isDecorative: false },
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          accept: "application/json",
          "Content-Type": "application/json",
          "accept-version": "1.0.0",
        },
      },
    );

    res.json({ message: "Alt text updated successfully 🚀" });
  } catch (error) {
    console.log("WEBFLOW UPDATE ERROR:");
    console.log(JSON.stringify(error.response?.data, null, 2));
    console.log(error.message);
    res.status(500).json({ message: "Error updating alt text" });
  }
});

// ─────────────────────────────────────────────
// CMS COLLECTIONS
// ─────────────────────────────────────────────

app.get("/cms", async (req, res) => {
  try {
    const { SITE_ID, ACCESS_TOKEN } = getSiteConfig(req);

    const collectionsResponse = await axios.get(
      `https://api.webflow.com/v2/sites/${SITE_ID}/collections`,
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          accept: "application/json",
          "accept-version": "1.0.0",
        },
      },
    );

    const collections = collectionsResponse.data.collections;
    const cmsData = [];

    for (const collection of collections) {
      const collectionResponse = await axios.get(
        `https://api.webflow.com/v2/collections/${collection.id}`,
        {
          headers: {
            Authorization: `Bearer ${ACCESS_TOKEN}`,
            accept: "application/json",
            "accept-version": "1.0.0",
          },
        },
      );

      const collectionData = collectionResponse.data;

      const fields = collectionData.fields.map((field) => ({
        id: field.id,
        displayName: field.displayName,
        slug: field.slug,
        type: field.type,
      }));

      cmsData.push({
        id: collection.id,
        displayName: collection.displayName,
        slug: collection.slug,
        fields: fields,
      });
    }

    res.json({ collections: cmsData });
  } catch (error) {
    console.log(error.response?.data || error.message);
    res.status(500).json({ message: "Error fetching CMS data" });
  }
});

// ─────────────────────────────────────────────
// PAGES
// ─────────────────────────────────────────────

app.get("/pages", async (req, res) => {
  try {
    const { SITE_ID, ACCESS_TOKEN } = getSiteConfig(req);

    const response = await axios.get(
      `https://api.webflow.com/v2/sites/${SITE_ID}/pages`,
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          accept: "application/json",
          "accept-version": "1.0.0",
        },
      },
    );

    res.json(response.data);
  } catch (error) {
    console.log(error.response?.data || error.message);
    res.status(500).json({ message: "Error fetching pages" });
  }
});

// ─────────────────────────────────────────────
// PAGE DOM
// ─────────────────────────────────────────────

app.get("/page-dom/:pageId", async (req, res) => {
  const { pageId } = req.params;

  try {
    const { ACCESS_TOKEN } = getSiteConfig(req);

    const response = await axios.get(
      `https://api.webflow.com/v2/pages/${pageId}/dom`,
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          accept: "application/json",
          "accept-version": "1.0.0",
        },
      },
    );

    res.json(response.data);
  } catch (error) {
    console.log(error.response?.data || error.message);
    res.status(500).json({ message: "Error fetching page DOM" });
  }
});

// ─────────────────────────────────────────────
// COMPONENTS
// ─────────────────────────────────────────────

app.get("/components", async (req, res) => {
  try {
    const { SITE_ID, ACCESS_TOKEN } = getSiteConfig(req);

    const response = await axios.get(
      `https://api.webflow.com/v2/sites/${SITE_ID}/components`,
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          accept: "application/json",
          "accept-version": "1.0.0",
        },
      },
    );

    const components = response.data.components || [];

    const cleanedComponents = components.map((component) => ({
      id: component.id,
      name: component.name,
      instanceCount: component.instanceCount || 0,
    }));

    res.json({ components: cleanedComponents });
  } catch (error) {
    console.log(error.response?.data || error.message);
    res.status(500).json({ message: "Error fetching components" });
  }
});

// ─────────────────────────────────────────────
// COMPONENT DOM
// ─────────────────────────────────────────────

app.get("/component-dom/:componentId", async (req, res) => {
  const { componentId } = req.params;

  try {
    const { ACCESS_TOKEN } = getSiteConfig(req);

    const response = await axios.get(
      `https://api.webflow.com/v2/components/${componentId}/dom`,
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          accept: "application/json",
          "accept-version": "1.0.0",
        },
      },
    );

    res.json(response.data);
  } catch (error) {
    console.log(error.response?.data || error.message);
    res.status(500).json({ message: "Error fetching component DOM" });
  }
});

// ─────────────────────────────────────────────
// UNUSED CMS FIELD DETECTOR
// ─────────────────────────────────────────────

app.get("/unused-fields", async (req, res) => {
  try {
    const { SITE_ID, ACCESS_TOKEN, SITE_URL } = getSiteConfig(req);

    // FETCH COLLECTIONS
    const collectionsResponse = await axios.get(
      `https://api.webflow.com/v2/sites/${SITE_ID}/collections`,
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          accept: "application/json",
          "accept-version": "1.0.0",
        },
      },
    );

    const collections = collectionsResponse.data.collections;

    // FETCH PAGES
    const pagesResponse = await axios.get(
      `https://api.webflow.com/v2/sites/${SITE_ID}/pages`,
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          accept: "application/json",
          "accept-version": "1.0.0",
        },
      },
    );

    const pages = pagesResponse.data.pages;

    const report = [];
    const referenceMap = {};
    const pageHtmlCache = {};

    // PASS 1 — BUILD GLOBAL REFERENCE MAP
    for (const collection of collections) {
      const itemsResponse = await axios.get(
        `https://api.webflow.com/v2/collections/${collection.id}/items`,
        {
          headers: {
            Authorization: `Bearer ${ACCESS_TOKEN}`,
            accept: "application/json",
            "accept-version": "1.0.0",
          },
        },
      );

      const items = itemsResponse.data.items || [];

      items.forEach((item) => {
        referenceMap[item.id] = item.fieldData?.name || "";
      });
    }

    // PASS 2 — UNUSED FIELD DETECTOR
    for (const collection of collections) {
      const collectionResponse = await axios.get(
        `https://api.webflow.com/v2/collections/${collection.id}`,
        {
          headers: {
            Authorization: `Bearer ${ACCESS_TOKEN}`,
            accept: "application/json",
            "accept-version": "1.0.0",
          },
        },
      );

      const collectionData = collectionResponse.data;

      const itemsResponse = await axios.get(
        `https://api.webflow.com/v2/collections/${collection.id}/items`,
        {
          headers: {
            Authorization: `Bearer ${ACCESS_TOKEN}`,
            accept: "application/json",
            "accept-version": "1.0.0",
          },
        },
      );

      const items = itemsResponse.data.items || [];

      for (const field of collectionData.fields) {
        // Skip system fields
        // if (field.slug === "name" || field.slug === "slug") {
        //   continue;
        // }
        // Skip system fields
        if (field.slug === "slug") {
          continue;
        }

        let hasAnyContent = false;
        let isUsed = false;

        for (const item of items) {
          const value = item.fieldData?.[field.slug];

          if (value === undefined || value === null || value === "") {
            continue;
          }

          hasAnyContent = true;

          let normalizedValue = "";

          const fieldType = field.type;

          if (
            fieldType === "PlainText" ||
            fieldType === "RichText" ||
            fieldType === "Email" ||
            fieldType === "Phone" ||
            fieldType === "Number" ||
            fieldType === "Option"
          ) {
            normalizedValue = String(value)
              .replace(/<[^>]*>/g, "")
              .replace(/\s+/g, " ")
              .trim()
              .toLowerCase();
          } else if (fieldType === "Image") {
            normalizedValue = value?.url?.split("?")[0].toLowerCase() || "";
          } else if (fieldType === "Link") {
            normalizedValue = String(value).toLowerCase();
          } else if (fieldType === "File") {
            normalizedValue = value?.url?.split("?")[0].toLowerCase() || "";
          } else if (fieldType === "VideoLink") {
            normalizedValue = String(value).toLowerCase();
          } else if (fieldType === "MultiImage") {
            normalizedValue = value
              .map((img) => img.url?.split("?")[0].toLowerCase())
              .join(" ");
          } else if (fieldType === "Reference") {
            normalizedValue = (referenceMap[value] || "").toLowerCase().trim();
          } else if (fieldType === "MultiReference") {
            normalizedValue = value
              .map((id) => (referenceMap[id] || "").toLowerCase().trim())
              .join(" ");
          } else if (fieldType === "DateTime") {
            normalizedValue = String(value).slice(0, 10).toLowerCase();
          }

          if (!normalizedValue) {
            continue;
          }

          // CHECK STATIC PAGES
          for (const page of pages) {
            let html = pageHtmlCache[page.id];

            if (!html) {
              // TRY PUBLISHED PAGE — FIX: no double slash
              const publishedPath = page.publishedPath
                ? page.publishedPath.replace(/^\//, "")
                : "";

              try {
                const htmlResponse = await axios.get(
                  `${SITE_URL}/${publishedPath}`,
                );

                html = htmlResponse.data.replace(/\s+/g, " ").toLowerCase();
              } catch (error) {
                // FALLBACK: TRY DESIGNER DOM
                try {
                  const domResponse = await axios.get(
                    `https://api.webflow.com/v2/pages/${page.id}/dom`,
                    {
                      headers: {
                        Authorization: `Bearer ${ACCESS_TOKEN}`,
                        accept: "application/json",
                        "accept-version": "1.0.0",
                      },
                    },
                  );

                  html = JSON.stringify(domResponse.data.nodes || [])
                    .replace(/\s+/g, " ")
                    .toLowerCase();
                } catch (domError) {
                  continue;
                }
              }

              pageHtmlCache[page.id] = html;
            }

            const $ = cheerio.load(html);
            const collectionLists = $(".w-dyn-list");

            for (const element of collectionLists.toArray()) {
              const collectionText = $(element)
                .text()
                .replace(/\s+/g, " ")
                .trim()
                .toLowerCase();

              let matched = false;

              if (
                fieldType === "PlainText" ||
                fieldType === "RichText" ||
                fieldType === "Email" ||
                fieldType === "Phone" ||
                fieldType === "Number" ||
                fieldType === "Option"
              ) {
                matched = collectionText.includes(normalizedValue);
              } else if (fieldType === "Image") {
                matched = html.toLowerCase().includes(normalizedValue);
              } else if (fieldType === "MultiImage") {
                matched = html.toLowerCase().includes(normalizedValue);
              } else if (fieldType === "Link") {
                const hrefs = $("a")
                  .map((i, el) => ($(el).attr("href") || "").toLowerCase())
                  .get();
                matched = hrefs.includes(normalizedValue);
              } else if (fieldType === "File") {
                const fileLinks = $("a")
                  .map((i, el) =>
                    ($(el).attr("href") || "").split("?")[0].toLowerCase(),
                  )
                  .get();
                matched = fileLinks.includes(normalizedValue);
              } else if (fieldType === "VideoLink") {
                const iframeSources = $("iframe")
                  .map((i, el) => ($(el).attr("src") || "").toLowerCase())
                  .get();
                matched = iframeSources.some((src) =>
                  src.includes(normalizedValue),
                );
              } else if (fieldType === "DateTime") {
                matched = collectionText.includes(normalizedValue.slice(0, 10));
              } else if (fieldType === "Reference") {
                matched = collectionText.includes(normalizedValue);
              } else if (fieldType === "MultiReference") {
                matched = normalizedValue
                  .split(" ")
                  .some((val) => collectionText.includes(val));
              }

              if (matched) {
                console.log(`MATCH FOUND → ${field.slug}`);
                isUsed = true;
                break;
              }
            }

            if (isUsed) break;
          }

          // CHECK TEMPLATE PAGE
          if (!isUsed) {
            const templatePage = pages.find(
              (page) => page.collectionId === collection.id,
            );

            if (templatePage) {
              try {
                const templatePath = templatePage.publishedPath
                  ? templatePage.publishedPath.replace(/^\//, "")
                  : "";

                const htmlResponse = await axios.get(
                  `${SITE_URL}/${templatePath}`,
                );

                const html = htmlResponse.data;

                if (html.toLowerCase().includes(normalizedValue)) {
                  isUsed = true;
                }
              } catch (error) {
                // Skip 404 template pages silently
              }
            }
          }

          if (isUsed) break;
        }

        report.push({
          collectionName: collection.displayName,
          fieldName: field.displayName,
          slug: field.slug,
          type: field.type,
          status: isUsed ? "Used" : "Unused",
        });
      }
    }

    res.json({ totalFields: report.length, report });
  } catch (error) {
    console.log(error.response?.data || error.message);
    res.status(500).json({ message: "Error detecting unused fields" });
  }
});

// ─────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
