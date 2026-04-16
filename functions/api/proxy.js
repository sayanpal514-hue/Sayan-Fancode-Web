export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('u');

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing "u" query parameter' }), {
      status: 400,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }

  try {
    // Decode the target URL
    const decodedUrl = decodeURIComponent(targetUrl);

    // Fetch from origin with appropriate headers
    const originResponse = await fetch(decodedUrl, {
      method: request.method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://www.fancode.com',
        'Referer': 'https://www.fancode.com/',
      },
      redirect: 'follow',
    });

    // Get response body
    const contentType = originResponse.headers.get('Content-Type') || 'application/octet-stream';
    let body = await originResponse.arrayBuffer();

    // For HLS manifests (.m3u8), rewrite segment URLs to also go through proxy
    if (decodedUrl.includes('.m3u8') || contentType.includes('mpegurl') || contentType.includes('m3u8')) {
      const text = new TextDecoder().decode(body);
      const baseUrl = decodedUrl.substring(0, decodedUrl.lastIndexOf('/') + 1);
      const proxyBase = url.origin + url.pathname;

      const rewritten = text.split('\n').map(line => {
        const trimmed = line.trim();
        // Skip empty lines and comments/tags
        if (!trimmed || trimmed.startsWith('#')) {
          // But rewrite URI= attributes inside tags (for key URLs, etc.)
          if (trimmed.includes('URI="')) {
            return trimmed.replace(/URI="([^"]+)"/g, (match, uri) => {
              const absoluteUri = uri.startsWith('http') ? uri : baseUrl + uri;
              return `URI="${proxyBase}?u=${encodeURIComponent(absoluteUri)}"`;
            });
          }
          return line;
        }
        // Rewrite segment/playlist URLs
        if (trimmed.startsWith('http')) {
          return `${proxyBase}?u=${encodeURIComponent(trimmed)}`;
        }
        // Relative URL — make absolute then proxy
        const absoluteUrl = baseUrl + trimmed;
        return `${proxyBase}?u=${encodeURIComponent(absoluteUrl)}`;
      }).join('\n');

      body = new TextEncoder().encode(rewritten);
    }

    // Build response
    const responseHeaders = {
      ...corsHeaders(),
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    };

    // Preserve content length for segments
    if (!decodedUrl.includes('.m3u8') && !contentType.includes('mpegurl')) {
      responseHeaders['Content-Length'] = body.byteLength.toString();
    }

    return new Response(body, {
      status: originResponse.status,
      headers: responseHeaders,
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Proxy fetch failed', details: err.message }), {
      status: 502,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': '*',
    'Access-Control-Max-Age': '86400',
  };
}
