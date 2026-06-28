/**
 * Public embed.js — served at /api/embed?c={channelId}.
 * Mounts a floating button + iframe widget on any 3rd-party site.
 *
 * Usage:
 *   <script src="https://app.orchester.io/api/embed?c=CHANNEL_ID" async></script>
 *
 * Optional params: locale (en|es|pt), position (right|left), color (#rrggbb)
 */
import { NextResponse } from "next/server";

type Position = "right" | "left";

interface EmbedOpts {
  locale: string;
  position: Position;
  color: string;
}

function buildScript(channelId: string, base: string, opts: EmbedOpts): string {
  const side = opts.position;
  const iframeSrc = `${base}/widget/${channelId}?locale=${encodeURIComponent(opts.locale)}`;
  return `(function(){
  if (window.__OrchesterMounted) return;
  window.__OrchesterMounted = true;

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var iconSvg = document.createElementNS(SVG_NS, 'svg');
  iconSvg.setAttribute('width', '22');
  iconSvg.setAttribute('height', '22');
  iconSvg.setAttribute('viewBox', '0 0 24 24');
  iconSvg.setAttribute('fill', 'none');
  iconSvg.setAttribute('stroke', 'currentColor');
  iconSvg.setAttribute('stroke-width', '2.2');
  iconSvg.setAttribute('stroke-linecap', 'round');
  iconSvg.setAttribute('stroke-linejoin', 'round');
  var path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z');
  iconSvg.appendChild(path);

  var btn = document.createElement('button');
  btn.setAttribute('aria-label', 'Open chat');
  btn.style.cssText = 'position:fixed;bottom:20px;${side}:20px;width:56px;height:56px;border-radius:50%;background:${opts.color};color:white;border:none;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,0.18);z-index:2147483646;display:flex;align-items:center;justify-content:center;';
  btn.appendChild(iconSvg);

  var iframe = document.createElement('iframe');
  iframe.src = '${iframeSrc}';
  iframe.style.cssText = 'position:fixed;bottom:90px;${side}:20px;width:380px;max-width:calc(100vw - 40px);height:600px;max-height:calc(100vh - 120px);border:0;border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,0.22);z-index:2147483647;display:none;background:#0a0a0a;';
  iframe.setAttribute('allow', 'clipboard-write');
  iframe.title = 'Orchester chat';

  var open = false;
  function toggle() {
    open = !open;
    iframe.style.display = open ? 'block' : 'none';
  }
  btn.addEventListener('click', toggle);

  document.body.appendChild(iframe);
  document.body.appendChild(btn);

  window.Orchester = {
    open: function(){ if(!open) toggle(); },
    close: function(){ if(open) toggle(); },
    toggle: toggle
  };
})();`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const channelId = url.searchParams.get("c") ?? "";
  if (!channelId) return new NextResponse("// missing ?c=channelId", { status: 400 });

  const locale = url.searchParams.get("locale") ?? "es";
  const rawPos = url.searchParams.get("position") ?? "right";
  const position: Position = rawPos === "left" ? "left" : "right";
  const color = url.searchParams.get("color") ?? "#8b5cf6";

  const base = `${url.protocol}//${url.host}`;
  const body = buildScript(channelId, base, { locale, position, color });
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}
