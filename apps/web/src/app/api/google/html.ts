/** A tiny page for the Google connect flow, readable on a phone. */
export function page(message: string, status = 200): Response {
  const safe = message.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DILO</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0e0f11;color:#f2efe9;font:18px/1.5 system-ui,sans-serif;padding:24px;box-sizing:border-box;text-align:center}
b{color:#f0a54a;font-size:28px;display:block;margin-bottom:12px}</style></head><body><div><b>DILO</b>${safe}</div></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
