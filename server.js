import express from "express";

const app = express();

app.use(express.json({ limit: "50mb" }));

const PORT = process.env.PORT || 3000;

app.post("/v1/chat/completions", async (req, res) => {
  try {
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

    // Forward the API key supplied by JanitorAI directly to Vercel
    const authorization = req.headers.authorization;

    if (!authorization) {
      return res.status(401).json({
        error: {
          message: "Missing Authorization header",
          type: "authentication_error",
        },
      });
    }

    const response = await fetch(
      "https://ai-gateway.vercel.sh/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": authorization,
        },
        body: JSON.stringify(body),
      }
    );

    res.status(response.status);

    // Forward streaming responses
    if (body.stream) {
      res.setHeader(
        "Content-Type",
        response.headers.get("content-type") || "text/event-stream"
      );

      res.setHeader("Cache-Control", "no-cache");

      if (!response.body) {
        return res.end();
      }

      const reader = response.body.getReader();

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        res.write(Buffer.from(value));
      }

      res.end();
      return;
    }

    // Forward normal JSON responses
    const data = await response.json();
    res.json(data);

  } catch (error) {
    console.error("Gateway error:", error);

    res.status(500).json({
      error: {
        message: error.message,
        type: "proxy_error",
      },
    });
  }
});

app.get("/", (req, res) => {
  res.json({
    status: "ok",
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
