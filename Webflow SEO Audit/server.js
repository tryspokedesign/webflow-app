require("dotenv").config();
const express = require("express");
const path = require("path");
const axios = require("axios");
const cors = require("cors");
const fs = require("fs");
const cheerio = require("cheerio");
const { createClient } = require("@supabase/supabase-js");
const PAGESPEED_API_KEY = process.env.PAGESPEED_API_KEY;
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
);

async function saveSiteToSupabase(siteData) {
  const { error } = await supabase.from("sites").upsert(
    {
      site_id: siteData.siteId,
      site_name: siteData.siteName,
      access_token: siteData.accessToken,
      staging_domain: siteData.stagingDomain,
      production_domain: siteData.productionDomain,
    },
    {
      onConflict: "site_id",
    },
  );

  if (error) {
    console.error("Supabase Save Error:", error.message);
  } else {
    console.log("Saved to Supabase:", siteData.siteName);
  }
}

const app = express();
app.use(express.json());

const corsOptions = {
  origin: function (origin, callback) {
    console.log("[CORS] Request from origin:", origin);
    if (!origin) return callback(null, true);
    const allowed =
      /\.webflow\.com$/.test(origin) ||
      /\.webflow\.io$/.test(origin) ||
      /\.ngrok-free\.app$/.test(origin) ||
      /\.ngrok-free\.dev$/.test(origin) ||
      /\.yourdomain\.com$/.test(origin) ||
      /\.ngrok\.io$/.test(origin) ||
      /\.ngrok\.app$/.test(origin) ||
      /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
      /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin);
    if (allowed) return callback(null, true);
    console.warn("[CORS] Blocked origin:", origin);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
};
app.use(cors(corsOptions));

app.get("/__webflow", (req, res) => {
  res.setHeader("ngrok-skip-browser-warning", "true");
  res.json({ status: "ok" });
});

// ─── NGROK BYPASS + WEBFLOW SDK HANDSHAKE
// Webflow Designer hits /__webflow on your extension server to verify it's
// alive. When using ngrok, the browser-warning interstitial blocks this with
// a missing CORS header. This route bypasses that by responding directly
// with the ngrok-skip header so the SDK handshake succeeds.
app.get("/__webflow", (req, res) => {
  res.setHeader("ngrok-skip-browser-warning", "true");
  res.json({ status: "ok" });
});

app.use(express.static(path.join(__dirname, "public")));

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
// Reads ?siteId=xxx from the request
// Matches directly against siteId in storage
// Example:
// siteId = "688db0f113fc35776598f452"
// stored siteId = "688db0f113fc35776598f452"
// ─────────────────────────────────────────────

async function getSiteConfig(req) {
  const siteId = req.query.siteId;

  if (!siteId) {
    throw new Error("Missing siteId query param");
  }

  const { data: currentSite, error } = await supabase
    .from("sites")
    .select("*")
    .eq("site_id", siteId)
    .single();

  if (error || !currentSite) {
    throw new Error(`Site not found for siteId: ${siteId}`);
  }

  return {
    SITE_ID: currentSite.site_id,
    ACCESS_TOKEN: currentSite.access_token,
    SITE_NAME: currentSite.site_name,
    STAGING_DOMAIN: currentSite.staging_domain,
    PRODUCTION_DOMAIN: currentSite.production_domain,
  };
}

const PORT = 3000;

// Serve frontend files
// app.use(express.static(path.join(__dirname)));

// Home route
// app.get("/", (req, res) => {
//   res.sendFile(path.join(__dirname, "index.html"));
// });

// ─────────────────────────────────────────────
// AUTH CALLBACK — saves new site to sites.json
// ─────────────────────────────────────────────

app.get("/auth/callback", async (req, res) => {
  const code = req.query.code;

  console.log("Authorization Code:", code);

  try {
    const params = new URLSearchParams();
    params.append("client_id", process.env.WEBFLOW_CLIENT_ID);
    params.append("client_secret", process.env.WEBFLOW_CLIENT_SECRET);
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
    for (const site of fetchedSites) {
      const existingSite = savedSites.find((s) => s.siteId === site.id);

      const siteDetailsResponse = await axios.get(
        `https://api.webflow.com/v2/sites/${site.id}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            accept: "application/json",
          },
        },
      );
      console.log(
        "SITE DETAILS:",
        JSON.stringify(siteDetailsResponse.data, null, 2),
      );
      const domains = siteDetailsResponse.data.domains || [];

      console.log(
        `Domains for ${site.displayName}:`,
        JSON.stringify(domains, null, 2),
      );

      const siteData = {
        siteId: site.id,
        siteName: site.displayName,
        stagingDomain: `${site.shortName}.webflow.io`,
        productionDomain: null,
        accessToken,
      };

      if (existingSite) {
        existingSite.accessToken = accessToken;
        existingSite.siteName = site.displayName;
        existingSite.stagingDomain = `${site.shortName}.webflow.io`;
      } else {
        savedSites.push(siteData);
      }
      await saveSiteToSupabase(siteData);
    }

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
    const { SITE_ID, ACCESS_TOKEN } = await getSiteConfig(req);

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
// UPDATE ALT TEXT
// ─────────────────────────────────────────────

app.post("/update-alt", async (req, res) => {
  const { assetId, altText } = req.body;

  try {
    const { ACCESS_TOKEN } = await getSiteConfig(req);

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
    const { SITE_ID, ACCESS_TOKEN } = await getSiteConfig(req);

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
    const { SITE_ID, ACCESS_TOKEN } = await getSiteConfig(req);

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
    const { ACCESS_TOKEN } = await getSiteConfig(req);

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
    const { SITE_ID, ACCESS_TOKEN } = await getSiteConfig(req);

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
    const { ACCESS_TOKEN } = await getSiteConfig(req);

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
// CMS AUDIT DATA
// ─────────────────────────────────────────────

app.get("/cms-audit", async (req, res) => {
  try {
    const { SITE_ID, ACCESS_TOKEN } = await getSiteConfig(req);

    const collectionsResponse = await axios.get(
      `https://api.webflow.com/v2/sites/${SITE_ID}/collections`,
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          accept: "application/json",
          "accept-version": "1.0.0",
        },
      }
    );

    const collections = collectionsResponse.data.collections || [];

    const result = [];

    for (const collection of collections) {
      const collectionResponse = await axios.get(
        `https://api.webflow.com/v2/collections/${collection.id}`,
        {
          headers: {
            Authorization: `Bearer ${ACCESS_TOKEN}`,
            accept: "application/json",
            "accept-version": "1.0.0",
          },
        }
      );

      const collectionData = collectionResponse.data;

      result.push({
        id: collectionData.id,
        name: collectionData.displayName,
        slug: collectionData.slug,
        fields: (collectionData.fields || []).map((field) => ({
          id: field.id,
          name: field.displayName,
          slug: field.slug,
          type: field.type,
        })),
      });
    }

    res.json({
      totalCollections: result.length,
      collections: result,
    });
  } catch (error) {
    console.error(error.response?.data || error.message);

    res.status(500).json({
      message: "Failed to load CMS audit data",
    });
  }
});

// ─────────────────────────────────────────────
// SEO AUDIT
// ─────────────────────────────────────────────

app.get("/seo-audit", async (req, res) => {
  try {
    const { SITE_ID, ACCESS_TOKEN, STAGING_DOMAIN, PRODUCTION_DOMAIN } =
      await getSiteConfig(req);

    const SITE_URL = PRODUCTION_DOMAIN
      ? `https://${PRODUCTION_DOMAIN}`
      : `https://${STAGING_DOMAIN}`;

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

    const allPages = pagesResponse.data.pages || [];

    // ORDER: home → static → template
    const homePage = allPages.filter((p) => p.slug === null || p.slug === "");
    const staticPages = allPages.filter(
      (p) => p.slug !== null && p.slug !== "" && !p.collectionId,
    );
    const templatePages = allPages.filter((p) => p.collectionId);
    const pages = [...homePage, ...staticPages, ...templatePages];

    const pageReports = [];

    // SITE-WIDE CHECKS
    const siteWide = {
      sitemap: false,
      robotsTxt: false,
      robotsTxtValid: false,
      robotsTxtIssue: "",
      llmsTxt: false,
    };

    // SITEMAP — existence + validation
    try {
      const r = await axios.get(`${SITE_URL}/sitemap.xml`);
      siteWide.sitemap = r.status === 200;

      if (siteWide.sitemap) {
        const sitemapXml = r.data || "";

        // CHECK VALID XML
        if (
          !sitemapXml.includes("<urlset") &&
          !sitemapXml.includes("<sitemapindex")
        ) {
          siteWide.sitemapValid = false;
          siteWide.sitemapIssue = "Invalid XML structure";
        } else {
          // EXTRACT ALL URLS FROM SITEMAP
          const urlMatches = sitemapXml.match(/<loc>(.*?)<\/loc>/g) || [];
          const sitemapUrls = urlMatches.map((u) =>
            u.replace("<loc>", "").replace("</loc>", "").trim(),
          );

          siteWide.sitemapUrlCount = sitemapUrls.length;

          // CHECK ALL PUBLISHED NON-DRAFT PAGES ARE IN SITEMAP
          const missingFromSitemap = [];
          for (const page of pages) {
            if (page.draft) continue;
            if (page.slug === "404" || page.slug === "401") continue;
            if (page.collectionId) continue;

            const pageFullUrl = `${SITE_URL}${page.publishedPath}`;
            const inSitemap = sitemapUrls.some(
              (u) => u === pageFullUrl || u === pageFullUrl + "/",
            );

            if (!inSitemap) {
              missingFromSitemap.push(page.publishedPath);
            }
          }

          if (missingFromSitemap.length > 0) {
            siteWide.sitemapValid = false;
            siteWide.sitemapIssue = `${missingFromSitemap.length} page(s) missing from sitemap: ${missingFromSitemap.join(", ")}`;
          } else {
            siteWide.sitemapValid = true;
            siteWide.sitemapIssue = `All pages included (${sitemapUrls.length} URLs)`;
          }
        }
      }
    } catch (e) {
      siteWide.sitemap = false;
      siteWide.sitemapValid = false;
      siteWide.sitemapIssue = "Sitemap not found";
    }

    // ROBOTS.TXT — check existence and validity
    try {
      const r = await axios.get(`${SITE_URL}/robots.txt`);
      siteWide.robotsTxt = r.status === 200;
      const robotsContent = r.data || "";

      // Check for common issues
      if (
        robotsContent.includes("Disallow: /\n") ||
        robotsContent.trim() === "User-agent: *\nDisallow: /"
      ) {
        siteWide.robotsTxtValid = false;
        siteWide.robotsTxtIssue = "Blocking entire site with Disallow: /";
      } else if (!robotsContent.includes("User-agent:")) {
        siteWide.robotsTxtValid = false;
        siteWide.robotsTxtIssue = "Missing User-agent directive";
      } else {
        siteWide.robotsTxtValid = true;
        siteWide.robotsTxtIssue = "";
      }
    } catch (e) {
      siteWide.robotsTxt = false;
      siteWide.robotsTxtValid = false;
    }

    // LLMS.TXT — existence + validation
    try {
      const r = await axios.get(`${SITE_URL}/llms.txt`);
      siteWide.llmsTxt = r.status === 200;

      if (siteWide.llmsTxt) {
        const llmsContent = r.data || "";

        if (!llmsContent || llmsContent.trim() === "") {
          siteWide.llmsTxtValid = false;
          siteWide.llmsTxtIssue = "Empty file";
        } else if (!llmsContent.includes("#")) {
          siteWide.llmsTxtValid = false;
          siteWide.llmsTxtIssue = "Missing site title (# heading)";
        } else if (!llmsContent.includes(">")) {
          siteWide.llmsTxtValid = false;
          siteWide.llmsTxtIssue = "Missing site description (> section)";
        } else {
          siteWide.llmsTxtValid = true;
          siteWide.llmsTxtIssue = "Valid";
        }
      } else {
        siteWide.llmsTxtValid = false;
        siteWide.llmsTxtIssue = "llms.txt not found";
      }
    } catch (e) {
      siteWide.llmsTxt = false;
      siteWide.llmsTxtValid = false;
      siteWide.llmsTxtIssue = "llms.txt not found";
    }

    // COLLECT ALL META TITLES AND DESCRIPTIONS FOR DUPLICATE CHECK
    const allMetaTitles = {};
    const allMetaDescs = {};

    // LINK CHECK CACHE — avoid rechecking same URL
    const linkCache = {};

    async function checkLink(url) {
      if (linkCache[url] !== undefined) return linkCache[url];
      try {
        const r = await axios.head(url, { timeout: 3000 });
        linkCache[url] = r.status < 400;
        return linkCache[url];
      } catch (e) {
        // Try GET if HEAD fails
        try {
          const r = await axios.get(url, { timeout: 3000 });
          linkCache[url] = r.status < 400;
          return linkCache[url];
        } catch (e2) {
          linkCache[url] = false;
          return false;
        }
      }
    }

    // PER PAGE AUDIT
    for (const page of pages) {
      // Skip drafts
      if (page.draft) continue;

      // Skip 404 and password pages
      if (page.slug === "404" || page.slug === "401") continue;

      const pageReport = {
        pageId: page.id,
        pageName: page.title || page.slug,
        pageUrl: page.publishedPath || "/",
        checks: {
          metaTitle: { status: "fail", value: "", message: "" },
          metaDescription: { status: "fail", value: "", message: "" },
          ogTitle: { status: "fail", value: "", message: "" },
          ogDescription: { status: "fail", value: "", message: "" },
          ogImage: { status: "fail", message: "" },
          h1: { status: "fail", value: "", message: "" },
          headingHierarchy: { status: "pass", message: "" },
          canonical: { status: "fail", message: "" },
          noindex: { status: "pass", message: "" },
          structuredData: { status: "fail", message: "" },
        },
        imagesWithoutAlt: [],
        linksWithoutAnchor: [],
        brokenLinks: [],
        duplicateTitleWith: [],
        duplicateDescWith: [],
      };

      // WEBFLOW API — meta/OG/structured data
      try {
        const pageDetailRes = await axios.get(
          `https://api.webflow.com/v2/pages/${page.id}`,
          {
            headers: {
              Authorization: `Bearer ${ACCESS_TOKEN}`,
              accept: "application/json",
              "accept-version": "1.0.0",
            },
          },
        );

        const seo = pageDetailRes.data.seo || {};
        const openGraph = pageDetailRes.data.openGraph || {};

        // META TITLE
        const metaTitle = seo.title || pageDetailRes.data.title || "";
        if (!metaTitle) {
          pageReport.checks.metaTitle = {
            status: "fail",
            value: "",
            message: "Missing meta title",
          };
        } else if (metaTitle.length < 30) {
          pageReport.checks.metaTitle = {
            status: "warning",
            value: metaTitle,
            message: `Too short (${metaTitle.length} chars, min 30)`,
          };
        } else if (metaTitle.length > 60) {
          pageReport.checks.metaTitle = {
            status: "warning",
            value: metaTitle,
            message: `Too long (${metaTitle.length} chars, max 60)`,
          };
        } else {
          pageReport.checks.metaTitle = {
            status: "pass",
            value: metaTitle,
            message: `Good (${metaTitle.length} chars)`,
          };
        }

        // STORE FOR DUPLICATE CHECK
        if (metaTitle) {
          if (!allMetaTitles[metaTitle]) allMetaTitles[metaTitle] = [];
          allMetaTitles[metaTitle].push({
            pageId: page.id,
            pageName: page.title,
            pageUrl: page.publishedPath,
          });
        }

        // META DESCRIPTION
        const metaDesc = seo.description || "";
        if (!metaDesc) {
          pageReport.checks.metaDescription = {
            status: "fail",
            value: "",
            message: "Missing meta description",
          };
        } else if (metaDesc.length < 70) {
          pageReport.checks.metaDescription = {
            status: "warning",
            value: metaDesc,
            message: `Too short (${metaDesc.length} chars, min 70)`,
          };
        } else if (metaDesc.length > 160) {
          pageReport.checks.metaDescription = {
            status: "warning",
            value: metaDesc,
            message: `Too long (${metaDesc.length} chars, max 160)`,
          };
        } else {
          pageReport.checks.metaDescription = {
            status: "pass",
            value: metaDesc,
            message: `Good (${metaDesc.length} chars)`,
          };
        }

        // STORE FOR DUPLICATE CHECK
        if (metaDesc) {
          if (!allMetaDescs[metaDesc]) allMetaDescs[metaDesc] = [];
          allMetaDescs[metaDesc].push({
            pageId: page.id,
            pageName: page.title,
            pageUrl: page.publishedPath,
          });
        }

        // OG TITLE
        const ogTitle =
          openGraph.title || (openGraph.titleCopied ? seo.title : "");
        pageReport.checks.ogTitle = !ogTitle
          ? { status: "warning", value: "", message: "Missing OG title" }
          : { status: "pass", value: ogTitle, message: `OG title: ${ogTitle}` };

        // OG DESCRIPTION
        const ogDesc =
          openGraph.description ||
          (openGraph.descriptionCopied ? seo.description : "");
        pageReport.checks.ogDescription = !ogDesc
          ? { status: "warning", value: "", message: "Missing OG description" }
          : {
              status: "pass",
              value: ogDesc,
              message: "OG description present",
            };

        // OG IMAGE
        const ogImage = openGraph.image || openGraph.imageUrl || null;
        pageReport.checks.ogImage = !ogImage
          ? { status: "warning", message: "Missing OG image" }
          : { status: "pass", message: "OG image present" };
      } catch (e) {
        console.log("Error fetching page SEO details:", e.message);
      }

      // CRAWL LIVE PAGE
      try {
        const publishedPath = page.publishedPath
          ? page.publishedPath.replace(/^\//, "")
          : "";
        const htmlResponse = await axios.get(`${SITE_URL}/${publishedPath}`);
        const $ = cheerio.load(htmlResponse.data);

        // H1
        const h1s = $("h1");
        if (h1s.length === 0) {
          pageReport.checks.h1 = {
            status: "fail",
            value: "",
            message: "No H1 found",
          };
        } else if (h1s.length > 1) {
          pageReport.checks.h1 = {
            status: "warning",
            value: h1s.first().text().trim(),
            message: `Multiple H1s found (${h1s.length})`,
          };
        } else {
          pageReport.checks.h1 = {
            status: "pass",
            value: h1s.first().text().trim(),
            message: "H1 present",
          };
        }

        // HEADING HIERARCHY
        const headings = [];
        ["h1", "h2", "h3", "h4", "h5", "h6"].forEach((tag) => {
          $(tag).each((i, el) => {
            headings.push(parseInt(tag[1]));
          });
        });

        let hierarchyBroken = false;
        let brokenMessage = "";
        for (let i = 1; i < headings.length; i++) {
          if (headings[i] - headings[i - 1] > 1) {
            hierarchyBroken = true;
            brokenMessage = `H${headings[i - 1]} jumps to H${headings[i]}`;
            break;
          }
        }
        pageReport.checks.headingHierarchy = hierarchyBroken
          ? { status: "warning", message: `Broken hierarchy: ${brokenMessage}` }
          : { status: "pass", message: "Heading hierarchy is correct" };

        // CANONICAL
        const canonical = $('link[rel="canonical"]').attr("href");
        pageReport.checks.canonical = !canonical
          ? { status: "warning", message: "No canonical tag found" }
          : { status: "pass", message: `Canonical: ${canonical}` };

        // NOINDEX
        const robotsMeta = $('meta[name="robots"]').attr("content") || "";
        pageReport.checks.noindex = robotsMeta.includes("noindex")
          ? { status: "fail", message: "Page is set to noindex" }
          : { status: "pass", message: "Page is indexable" };

        // STRUCTURED DATA
        const schemaScripts = $('script[type="application/ld+json"]');
        if (schemaScripts.length === 0) {
          pageReport.checks.structuredData = {
            status: "warning",
            message: "No structured data found",
          };
        } else {
          let validSchema = false;
          let schemaTypes = [];
          schemaScripts.each((i, el) => {
            try {
              const json = JSON.parse($(el).html());
              validSchema = true;
              const type =
                json["@type"] ||
                (Array.isArray(json)
                  ? json.map((j) => j["@type"]).join(", ")
                  : "Unknown");
              schemaTypes.push(type);
            } catch (e) {
              // Invalid JSON in schema
            }
          });

          if (validSchema) {
            pageReport.checks.structuredData = {
              status: "pass",
              message: `Schema found: ${schemaTypes.join(", ")}`,
            };
          } else {
            pageReport.checks.structuredData = {
              status: "fail",
              message: "Structured data found but invalid JSON",
            };
          }
        }

        // OG IMAGE — also check from HTML meta tag if API missed it
        if (pageReport.checks.ogImage.status !== "pass") {
          const ogImageMeta = $('meta[property="og:image"]').attr("content");
          if (ogImageMeta) {
            pageReport.checks.ogImage = {
              status: "pass",
              message: "OG image present",
            };
          }
        }

        // IMAGES WITHOUT ALT
        $("img").each((i, el) => {
          const alt = $(el).attr("alt");
          const src = $(el).attr("src") || "";
          if ((!alt || alt.trim() === "") && src && !src.startsWith("data:")) {
            pageReport.imagesWithoutAlt.push({ src });
          }
        });

        // LINKS WITHOUT ANCHOR TEXT
        $("a").each((i, el) => {
          const text = $(el).text().trim();
          const href = $(el).attr("href") || "";
          const hasImage = $(el).find("img").length > 0;
          const hasSvg = $(el).find("svg").length > 0;
          const ariaLabel = $(el).attr("aria-label") || "";

          if (!text && !hasImage && !hasSvg && !ariaLabel) {
            pageReport.linksWithoutAnchor.push({
              url: href,
              page: page.publishedPath || "/",
            });
          }
        });

        // BROKEN LINKS — collect all links first
        const allLinks = [];
        $("a[href]").each((i, el) => {
          const href = $(el).attr("href") || "";
          if (
            !href.startsWith("mailto:") &&
            !href.startsWith("tel:") &&
            !href.startsWith("javascript:") &&
            !href.startsWith("#") &&
            href !== ""
          ) {
            // Resolve relative URLs
            const fullUrl = href.startsWith("http")
              ? href
              : `${SITE_URL}${href.startsWith("/") ? "" : "/"}${href}`;
            allLinks.push({ href, fullUrl });
          }
        });

        // SPLIT internal and external
        const internalLinks = allLinks.filter((l) =>
          l.fullUrl.includes(
            SITE_URL.replace("https://", "").replace("http://", ""),
          ),
        );
        const externalLinks = allLinks
          .filter(
            (l) =>
              !l.fullUrl.includes(
                SITE_URL.replace("https://", "").replace("http://", ""),
              ),
          )
          .slice(0, 10);

        // CHECK INTERNAL LINKS
        for (const link of internalLinks) {
          const isOk = await checkLink(link.fullUrl);
          if (!isOk) {
            pageReport.brokenLinks.push({ url: link.href, type: "internal" });
          }
        }

        // CHECK EXTERNAL LINKS IN PARALLEL
        const externalChecks = externalLinks.map(async (link) => {
          const isOk = await checkLink(link.fullUrl);
          if (!isOk) {
            pageReport.brokenLinks.push({ url: link.href, type: "external" });
          }
        });
        await Promise.all(externalChecks);
      } catch (e) {
        // If page returns 404 it has no published content — skip entirely
        if (e.response?.status === 404) {
          continue;
        }
        console.log(`Error crawling page ${page.publishedPath}:`, e.message);
      }

      pageReports.push(pageReport);
    }

    // DUPLICATE META TITLE CHECK
    for (const [title, pagesWithTitle] of Object.entries(allMetaTitles)) {
      if (pagesWithTitle.length > 1) {
        pagesWithTitle.forEach(({ pageId }) => {
          const report = pageReports.find((r) => r.pageId === pageId);
          if (report) {
            report.duplicateTitleWith = pagesWithTitle
              .filter((p) => p.pageId !== pageId)
              .map((p) => p.pageUrl);
          }
        });
      }
    }

    // DUPLICATE META DESCRIPTION CHECK
    for (const [desc, pagesWithDesc] of Object.entries(allMetaDescs)) {
      if (pagesWithDesc.length > 1) {
        pagesWithDesc.forEach(({ pageId }) => {
          const report = pageReports.find((r) => r.pageId === pageId);
          if (report) {
            report.duplicateDescWith = pagesWithDesc
              .filter((p) => p.pageId !== pageId)
              .map((p) => p.pageUrl);
          }
        });
      }
    }

    res.json({ siteWide, pages: pageReports });
  } catch (error) {
    console.log(error.response?.data || error.message);
    res.status(500).json({ message: "Error running SEO audit" });
  }
});

// ─────────────────────────────────────────────
// SPEED AUDIT
// ─────────────────────────────────────────────

app.get("/speed-audit", async (req, res) => {
  try {
    const { SITE_ID, ACCESS_TOKEN, STAGING_DOMAIN, PRODUCTION_DOMAIN } =
      await getSiteConfig(req);

    const SITE_URL = `https://${STAGING_DOMAIN}`;
    
    // FETCH ALL PAGES
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

    const allPages = pagesResponse.data.pages || [];

    // Remove duplicate pages caused by multiple locales
    const seenSlugs = new Set();
    const uniquePages = allPages.filter((page) => {
      const key = page.slug ?? "home";
      if (seenSlugs.has(key)) return false;
      seenSlugs.add(key);
      return true;
    });

    const homePage = uniquePages.filter(
      (p) => p.slug === null || p.slug === "",
    );
    const staticPages = uniquePages.filter(
      (p) => p.slug !== null && p.slug !== "" && !p.collectionId,
    );
    const templatePages = uniquePages.filter((p) => p.collectionId);
    const pages = [...homePage, ...staticPages, ...templatePages];

    const results = [];

    for (const page of pages) {
      // Skip drafts, 404, password
      if (page.draft) continue;
      if (page.slug === "404" || page.slug === "401") continue;

      const pageUrl = `${SITE_URL}${page.publishedPath || "/"}`;

      // Check if page exists before running PageSpeed
      try {
        const checkRes = await axios.get(pageUrl, { timeout: 5000 });
        if (checkRes.status === 404) continue;
      } catch (e) {
        if (e.response?.status === 404) continue;
        console.log(`Skipping ${pageUrl}:`, e.message);
        continue;
      }

      console.log(`Checking speed for: ${pageUrl}`);

      const pageResult = {
        pageName: page.title || page.slug,
        pageUrl: page.publishedPath || "/",
        mobile: null,
        desktop: null,
      };

      // MOBILE + DESKTOP IN PARALLEL
      try {
        const [mobileRes, desktopRes] = await Promise.all([
          axios.get(
            `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(pageUrl)}&key=${PAGESPEED_API_KEY}&strategy=mobile&category=performance&category=seo&category=accessibility&category=best-practices`,
          ),
          axios.get(
            `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(pageUrl)}&key=${PAGESPEED_API_KEY}&strategy=desktop&category=performance&category=seo&category=accessibility&category=best-practices`,
          ),
        ]);
        // PARSE MOBILE
        const mobileData = mobileRes.data;
        const mobileCategories = mobileData.lighthouseResult?.categories || {};
        const mobileLcp =
          mobileData.lighthouseResult?.audits?.["largest-contentful-paint"];
        const mobileCls =
          mobileData.lighthouseResult?.audits?.["cumulative-layout-shift"];
        const mobileFcp =
          mobileData.lighthouseResult?.audits?.["first-contentful-paint"];
        const mobileTtfb =
          mobileData.lighthouseResult?.audits?.["server-response-time"];
        const mobileTbt =
          mobileData.lighthouseResult?.audits?.["total-blocking-time"];

        // MOBILE OPPORTUNITIES (what's causing low score)
        const mobileOpportunities = [];
        const audits = mobileData.lighthouseResult?.audits || {};
        const opportunityKeys = [
          "render-blocking-resources",
          "unused-css-rules",
          "unused-javascript",
          "uses-optimized-images",
          "uses-webp-images",
          "uses-text-compression",
          "uses-responsive-images",
          "efficient-animated-content",
          "uses-long-cache-ttl",
          "total-byte-weight",
        ];

        opportunityKeys.forEach((key) => {
          const audit = audits[key];
          if (audit && audit.score !== null && audit.score < 1) {
            mobileOpportunities.push({
              title: audit.title,
              description: audit.description,
              score: audit.score,
              displayValue: audit.displayValue || "",
            });
          }
        });

        pageResult.mobile = {
          performance: Math.round(
            (mobileCategories.performance?.score || 0) * 100,
          ),
          seo: Math.round((mobileCategories.seo?.score || 0) * 100),
          accessibility: Math.round(
            (mobileCategories.accessibility?.score || 0) * 100,
          ),
          bestPractices: Math.round(
            (mobileCategories["best-practices"]?.score || 0) * 100,
          ),
          lcp: mobileLcp?.displayValue || "N/A",
          cls: mobileCls?.displayValue || "N/A",
          fcp: mobileFcp?.displayValue || "N/A",
          ttfb: mobileTtfb?.displayValue || "N/A",
          tbt: mobileTbt?.displayValue || "N/A",
          opportunities: mobileOpportunities,
        };

        // PARSE DESKTOP
        const desktopData = desktopRes.data;
        const desktopCategories =
          desktopData.lighthouseResult?.categories || {};
        const desktopLcp =
          desktopData.lighthouseResult?.audits?.["largest-contentful-paint"];
        const desktopCls =
          desktopData.lighthouseResult?.audits?.["cumulative-layout-shift"];
        const desktopFcp =
          desktopData.lighthouseResult?.audits?.["first-contentful-paint"];
        const desktopTtfb =
          desktopData.lighthouseResult?.audits?.["server-response-time"];
        const desktopTbt =
          desktopData.lighthouseResult?.audits?.["total-blocking-time"];

        const desktopOpportunities = [];
        const desktopAudits = desktopData.lighthouseResult?.audits || {};
        opportunityKeys.forEach((key) => {
          const audit = desktopAudits[key];
          if (audit && audit.score !== null && audit.score < 1) {
            desktopOpportunities.push({
              title: audit.title,
              description: audit.description,
              score: audit.score,
              displayValue: audit.displayValue || "",
            });
          }
        });

        pageResult.desktop = {
          performance: Math.round(
            (desktopCategories.performance?.score || 0) * 100,
          ),
          seo: Math.round((desktopCategories.seo?.score || 0) * 100),
          accessibility: Math.round(
            (desktopCategories.accessibility?.score || 0) * 100,
          ),
          bestPractices: Math.round(
            (desktopCategories["best-practices"]?.score || 0) * 100,
          ),
          lcp: desktopLcp?.displayValue || "N/A",
          cls: desktopCls?.displayValue || "N/A",
          fcp: desktopFcp?.displayValue || "N/A",
          ttfb: desktopTtfb?.displayValue || "N/A",
          tbt: desktopTbt?.displayValue || "N/A",
          opportunities: desktopOpportunities,
        };
      } catch (e) {
        console.log(`Error checking speed for ${pageUrl}:`, e.message);
      }

      results.push(pageResult);
    }

    // SITE-WIDE AVERAGE
    const validPages = results.filter((p) => p.mobile && p.desktop);

    const siteWide = {
      mobile: {
        performance: Math.round(
          validPages.reduce((sum, p) => sum + p.mobile.performance, 0) /
            (validPages.length || 1),
        ),
        seo: Math.round(
          validPages.reduce((sum, p) => sum + p.mobile.seo, 0) /
            (validPages.length || 1),
        ),
        accessibility: Math.round(
          validPages.reduce((sum, p) => sum + p.mobile.accessibility, 0) /
            (validPages.length || 1),
        ),
        bestPractices: Math.round(
          validPages.reduce((sum, p) => sum + p.mobile.bestPractices, 0) /
            (validPages.length || 1),
        ),
      },
      desktop: {
        performance: Math.round(
          validPages.reduce((sum, p) => sum + p.desktop.performance, 0) /
            (validPages.length || 1),
        ),
        seo: Math.round(
          validPages.reduce((sum, p) => sum + p.desktop.seo, 0) /
            (validPages.length || 1),
        ),
        accessibility: Math.round(
          validPages.reduce((sum, p) => sum + p.desktop.accessibility, 0) /
            (validPages.length || 1),
        ),
        bestPractices: Math.round(
          validPages.reduce((sum, p) => sum + p.desktop.bestPractices, 0) /
            (validPages.length || 1),
        ),
      },
    };

    res.json({ siteWide, pages: results });
  } catch (error) {
    console.log(error.response?.data || error.message);
    res.status(500).json({ message: "Error running speed audit" });
  }
});


// ─────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
