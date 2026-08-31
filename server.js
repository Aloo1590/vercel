import express from "express";

const app = express();

app.use(express.json({ limit: "50mb" }));

const PORT = process.env.PORT || 3000;

// NOTE: This server never reads an API key from process.env.
// The key comes from whatever Authorization header JanitorAI sends,
// i.e. the key you paste into JanitorAI's "API key" field. This proxy
// just relays it straight through to Vercel AI Gateway on each request.

app.post("/v1/chat/completions", async (req, res) => {
  const authorization = req.headers.authorization;

  if (!authorization) {
    return res.status(401).json({
      error: {
        message: "Missing Authorization header (set your key in JanitorAI's API key field)",
        type: "authentication_error",
      },
    });
  }

  const body = req.body;

  // Keep the model selected in JanitorAI unchanged.
  // Add Vercel AI Gateway routing preferences.
  body.providerOptions = {
    ...(body.providerOptions || {}),
    gateway: {
      ...(body.providerOptions?.gateway || {}),
      sort: "cost",
    },
  };

  let upstream;
  try {
    upstream = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authorization, // forwarded as-is, never persisted
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error("Upstream fetch failed:", error);
    return res.status(502).json({
      error: { message: "Failed to reach upstream gateway", type: "proxy_error" },
    });
  }

  res.status(upstream.status);

  // Streaming responses
  if (body.stream) {
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");

    if (!upstream.body) {
      return res.end();
    }

    const reader = upstream.body.getReader();

    // If the client disconnects, stop pulling from upstream.
    let aborted = false;
    req.on("close", () => {
      aborted = true;
      reader.cancel().catch(() => {});
    });

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done || aborted) break;
        res.write(Buffer.from(value));
      }
    } catch (error) {
      console.error("Stream error:", error);
      // Response is likely already partially sent; just end it.
    } finally {
      if (!res.writableEnded) res.end();
    }
    return;
  }

  // Non-streaming responses: handle non-JSON upstream bodies safely
  const text = await upstream.text();
  try {
    return res.send(JSON.parse(text));
  } catch {
    return res.send(text);
  }
});

app.get("/", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

