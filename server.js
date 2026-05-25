const express = require("express");
const path = require("path");
const axios = require("axios");
const { GoogleGenAI } = require("@google/genai");

const app = express();
app.use(express.json());

const PORT = 3000;

// YOUR GeminiAI API KEY
const ai = new GoogleGenAI({
  apiKey: "AIzaSyA2R0cRWIPm1alMLyzVovpGnJMpHajjatY",
});

// YOUR ACCESS TOKEN
const ACCESS_TOKEN =
  "ea3b5118b058ad8bc11fe302e42d91bcbd2a9d452f807fc602c361aaa2e7e197";

// Serve frontend files
app.use(express.static(path.join(__dirname)));

// Home route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Fetch Webflow sites
app.get("/sites", async (req, res) => {
  try {
    const response = await axios.get("https://api.webflow.com/v2/sites", {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        accept: "application/json",
        "accept-version": "1.0.0",
      },
    });

    console.log(response.data);

    res.json(response.data);
  } catch (error) {
    console.log(error.response?.data || error.message);

    res.send("Error fetching sites");
  }
});

app.get("/auth/callback", async (req, res) => {
  const code = req.query.code;

  console.log("Authorization Code:", code);

  try {
    const params = new URLSearchParams();

    params.append(
      "client_id",
      "ff4db4dc6d95be1a115f0647ac47e5de5eeaae26077c2f3e5faa8d912b250453",
    );
    params.append(
      "client_secret",
      "7c1f51fb972bec45a8ddb432a5807d562c1d50b73138a618266ffd035fdaab9a",
    );
    params.append("code", code);
    params.append("grant_type", "authorization_code");

    const response = await axios.post(
      "https://api.webflow.com/oauth/access_token",
      params,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    );

    console.log("ACCESS TOKEN:", response.data.access_token);

    res.send(`
      <h1>Webflow Connected Successfully 🚀</h1>
      <p>Access Token Generated.</p>
    `);
  } catch (error) {
    console.log(JSON.stringify(error.response?.data, null, 2));

    res.send("Error getting access token");
  }
});

app.get("/assets", async (req, res) => {
  try {
    const response = await axios.get(
      "https://api.webflow.com/v2/sites/692144f55f2d12d21f475b55/assets",
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          accept: "application/json",
          "accept-version": "1.0.0",
        },
      },
    );

    console.log(response.data);

    res.json(response.data);
  } catch (error) {
    console.log(error.response?.data || error.message);

    res.send("Error fetching assets");
  }
});

app.post("/update-alt", async (req, res) => {
  const { assetId, altText } = req.body;

  try {
    await axios.patch(
      `https://api.webflow.com/v2/assets/${assetId}`,
      {
        altText: altText,
        isDecorative: false,
      },
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          accept: "application/json",
          "Content-Type": "application/json",
          "accept-version": "1.0.0",
        },
      },
    );

    res.json({
      message: "Alt text updated successfully 🚀",
    });
  } catch (error) {
    console.log(error.response?.data || error.message);

    res.status(500).json({
      message: "Error updating alt text",
    });
  }
});

app.post("/generate-alt", async (req, res) => {
  const { fileName } = req.body;

  try {
    console.log("Generating alt text for:", fileName);

    const prompt = `
Generate short SEO-friendly alt text
for this image filename:

${fileName}

Keep it under 12 words.
`;

    const result = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
    });

    const altText = result.text;

    console.log("Generated Alt Text:", altText);

    res.json({
      altText,
    });
  } catch (error) {
    console.log("GEMINI ERROR:");

    console.log(error.response?.data || error.message || error);

    res.status(500).json({
      message: "Error generating alt text",
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
