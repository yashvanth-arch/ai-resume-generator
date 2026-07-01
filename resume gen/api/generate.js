// /api/generate.js
//
// Vercel Serverless Function (Node.js runtime).
// Keeps the Gemini API key on the server (read from the GEMINI_API_KEY
// environment variable in your Vercel project settings) and proxies
// resume-generation requests from the browser to Google's Gemini API.
//
// The browser never sees the API key — it only talks to this endpoint.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'Server is not configured: GEMINI_API_KEY environment variable is missing.'
    });
  }

  let body = req.body;
  // On some Vercel runtimes req.body may arrive as a raw string.
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON body.' });
    }
  }

  const { systemPrompt, userPrompt, schema } = body || {};

  if (!systemPrompt || !userPrompt) {
    return res.status(400).json({ error: 'systemPrompt and userPrompt are required.' });
  }

  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' +
    encodeURIComponent(apiKey);

  try {
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
          responseSchema: schema
        }
      })
    });

    const data = await geminiRes.json().catch(() => null);

    if (!geminiRes.ok) {
      const msg =
        (data && data.error && data.error.message) ||
        `Gemini request failed (${geminiRes.status}).`;
      return res.status(geminiRes.status).json({ error: msg });
    }

    const candidate = data && data.candidates && data.candidates[0];
    if (!candidate) {
      return res.status(502).json({ error: 'No response returned by the model.' });
    }
    if (candidate.finishReason === 'SAFETY') {
      return res.status(422).json({
        error: "The response was blocked by Gemini's safety filters. Try rephrasing your input."
      });
    }

    const parts = (candidate.content && candidate.content.parts) || [];
    const text = parts.map((p) => p.text || '').join('\n');
    if (!text) {
      return res.status(502).json({ error: 'Empty response from model.' });
    }

    let cleaned = text
      .trim()
      .replace(/^```json/i, '')
      .replace(/^```/, '')
      .replace(/```$/, '')
      .trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      cleaned = cleaned.slice(start, end + 1);
    }

    let resumeData;
    try {
      resumeData = JSON.parse(cleaned);
    } catch (e) {
      return res.status(502).json({ error: 'Model returned invalid JSON.' });
    }

    return res.status(200).json({ resume: resumeData });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reach Gemini: ' + err.message });
  }
}
