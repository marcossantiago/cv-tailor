/**
 * CV Tailor — Cloudflare Worker
 *
 * POST /
 * Body (JSON): { apiKey, systemPrompt, jobPosition, currentCV }
 * Returns: SSE stream from OpenAI Chat Completions
 */

import { ALLOWED_ORIGINS } from './config.js';

function corsHeaders(origin) {
  const allowed =
    ALLOWED_ORIGINS.includes(origin) ||
    origin?.startsWith('http://localhost') ||
    origin?.startsWith('http://127.0.0.1') ||
    origin?.startsWith('file://');

  return {
    'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin),
      });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    const { apiKey, systemPrompt, jobPosition, currentCV } = body;

    if (!apiKey)      return jsonError('apiKey is required', 400, origin);
    if (!jobPosition) return jsonError('jobPosition is required', 400, origin);
    if (!currentCV)   return jsonError('currentCV is required', 400, origin);

    const messages = [
      {
        role: 'system',
        content: systemPrompt?.trim() ||
          'You are an expert CV writer. Rewrite the provided CV to best match the given job position, highlighting relevant skills and experience. Keep it professional and ATS-friendly. Return only the rewritten CV text with no additional commentary.',
      },
      {
        role: 'user',
        content: `Job Position:\n${jobPosition}\n\nCurrent CV:\n${currentCV}`,
      },
    ];

    let openaiResponse;
    try {
      openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages,
          stream: true,
          temperature: 0.7,
          max_tokens: 4096,
        }),
      });
    } catch (err) {
      return jsonError(`Failed to reach OpenAI: ${err.message}`, 502, origin);
    }

    if (!openaiResponse.ok) {
      const errBody = await openaiResponse.json().catch(() => ({}));
      const msg = errBody?.error?.message || `OpenAI returned ${openaiResponse.status}`;
      return jsonError(msg, openaiResponse.status, origin);
    }

    // Pipe OpenAI SSE stream directly to the client
    return new Response(openaiResponse.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
        ...corsHeaders(origin),
      },
    });
  },
};

function jsonError(message, status, origin) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}
