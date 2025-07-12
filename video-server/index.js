// index.js
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const youtubedl = require("youtube-dl-exec");

const app = express();
const PORT = process.env.PORT || 4000;

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

app.get("/", (req, res) => {
  res.send("🎬 Trailer proxy backend is running!");
});

// 🎯 Unified DASH endpoint (video + audio)
// index.js (excerpt)
app.get("/api/trailer-hls/:videoId", async (req, res) => {
  const { videoId } = req.params;
  const info = await youtubedl(`https://www.youtube.com/watch?v=${videoId}`, {
    dumpSingleJson: true,
    noCheckCertificates: true,
    addHeader: ["referer:youtube.com", "user-agent:googlebot"],
  });

  const formats = info.formats || [];

  // 1) Collect all video-only MP4s, sorted by height descending
  const videoOptions = formats
    .filter(
      (f) => f.ext === "mp4" && f.vcodec !== "none" && f.acodec === "none"
    )
    .sort((a, b) => (b.height || 0) - (a.height || 0))
    .map((f) => ({
      resolution: `${f.height}`,
      url: `http://localhost:${PORT}/proxy/manifest?url=${encodeURIComponent(
        f.url
      )}`,
    }));

  // 2) Pick best audio-only URL as the base
  const bestAudio = formats
    .filter(
      (f) =>
        (f.ext === "m4a" || f.ext === "mp4") &&
        f.vcodec === "none" &&
        f.acodec !== "none"
    )
    .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];

  if (!videoOptions.length || !bestAudio) {
    return res.status(404).json({ error: "No streams found" });
  }

  const audioManifestBase = `http://localhost:${PORT}/proxy/manifest?url=${encodeURIComponent(
    bestAudio.url
  )}`;

  // 3) Return the FULL list plus the audio base
  res.json({ videoOptions, audioManifestBase });
});

// Proxy HLS or DASH manifest
app.get("/proxy/manifest", async (req, res) => {
  const manifestUrl = req.query.url;
  if (!manifestUrl)
    return res.status(400).json({ error: "Missing manifest URL" });

  try {
    console.log("📡 Fetching manifest:", manifestUrl);
    const response = await axios.get(manifestUrl);
    let manifest = response.data;

    // Rewrite all segment URLs to go through proxy
    const server = `http://localhost:${PORT}`;
    manifest = manifest.replace(/(https?:\/\/[^\s"'\n]+)/g, (match) => {
      return `${server}/proxy/segment?url=${encodeURIComponent(match)}`;
    });

    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.send(manifest);
  } catch (err) {
    console.error("❌ Manifest Proxy Error:", err.message);
    return res.status(500).json({ error: "Failed to fetch manifest" });
  }
});

// Proxy video segments
app.get("/proxy/segment", async (req, res) => {
  const segmentUrl = req.query.url;
  if (!segmentUrl)
    return res.status(400).json({ error: "Missing segment URL" });

  try {
    console.log("📼 Proxying segment:", segmentUrl);
    const segment = await axios.get(segmentUrl, { responseType: "stream" });
    segment.data.pipe(res);
  } catch (err) {
    console.error("❌ Segment Proxy Error:", err.message);
    return res.status(500).json({ error: "Failed to fetch segment" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Trailer Proxy running at http://localhost:${PORT}`);
});
