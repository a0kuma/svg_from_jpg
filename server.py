#!/usr/bin/env python3
"""
Web UI for Entropy Rate Superpixel -> SVG conversion.

  input : the user uploads a raster image (jpeg/png/...)
  output: the user downloads an SVG (superpixels vectorised, mean-colour fill)
  logic : ers.segment()  ->  svgize.to_svg()

Single-origin server, stdlib only.  Serves the page at GET / and does the
conversion at POST /convert (raw image bytes in the body, parameters in the
query string) returning JSON {svg, w, h, k, ms, sw, sh}.
"""
import io
import os
import json
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import numpy as np
from PIL import Image

import ers
import svgize

HOST, PORT = "0.0.0.0", 48489
MAX_UPLOAD = 40 * 1024 * 1024        # 40 MB
MAXDIM_CAP = 400                     # hard cap on segmentation resolution
EDITOR_JS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "editor.js")


def _clampi(v, lo, hi, d):
    try:
        return max(lo, min(hi, int(float(v))))
    except (TypeError, ValueError):
        return d


def _clampf(v, lo, hi, d):
    try:
        return max(lo, min(hi, float(v)))
    except (TypeError, ValueError):
        return d


def convert(img_bytes, q):
    nseg = _clampi(q.get("nseg", ["250"])[0], 2, 4000, 250)
    lam = _clampf(q.get("lam", ["0.5"])[0], 0.0, 5.0, 0.5)
    conn = 8 if q.get("conn", ["8"])[0] == "8" else 4
    maxdim = _clampi(q.get("maxdim", ["200"])[0], 48, MAXDIM_CAP, 200)
    stroke = q.get("stroke", ["0"])[0] == "1"
    strokecol = q.get("strokecol", ["#333333"])[0]
    if not (len(strokecol) in (4, 7) and strokecol.startswith("#")):
        strokecol = "#333333"
    sw_lw = _clampf(q.get("sw", ["0.6"])[0], 0.05, 5.0, 0.6)
    smooth = _clampf(q.get("smooth", ["0.9"])[0], 0.0, 3.0, 0.9)

    im = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    W0, H0 = im.size
    scale = maxdim / float(max(W0, H0))
    if scale < 1.0:
        sw, sh = max(1, int(round(W0 * scale))), max(1, int(round(H0 * scale)))
        proc = im.resize((sw, sh), Image.LANCZOS)
    else:
        sw, sh, proc = W0, H0, im
    arr = np.asarray(proc, dtype=np.uint8)

    t0 = time.time()
    labels, K = ers.segment(arr, nseg=nseg, lam=lam, conn=conn)
    svg = svgize.to_svg(labels, arr, K, orig_size=(W0, H0),
                        stroke=(strokecol if stroke else None), stroke_width=sw_lw,
                        smooth=smooth)
    ms = int((time.time() - t0) * 1000)
    return {"svg": svg, "w": W0, "h": H0, "k": int(K), "ms": ms, "sw": sw, "sh": sh}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body, ctype="application/json"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            self._send(200, PAGE, "text/html; charset=utf-8")
        elif path == "/editor.js":
            try:
                with open(EDITOR_JS, "rb") as f:
                    self._send(200, f.read(), "application/javascript; charset=utf-8")
            except OSError:
                self._send(404, json.dumps({"error": "not found"}))
        else:
            self._send(404, json.dumps({"error": "not found"}))

    def do_POST(self):
        path = urlparse(self.path).path
        if path != "/convert":
            self._send(404, json.dumps({"error": "not found"}))
            return
        try:
            n = int(self.headers.get("Content-Length", "0"))
            if n <= 0:
                self._send(400, json.dumps({"error": "empty body"}))
                return
            if n > MAX_UPLOAD:
                self._send(413, json.dumps({"error": "image too large (max 40MB)"}))
                return
            body = self.rfile.read(n)
            q = parse_qs(urlparse(self.path).query)
            out = convert(body, q)
            self._send(200, json.dumps(out))
        except Exception as e:
            traceback.print_exc()
            self._send(400, json.dumps({"error": "%s: %s" % (type(e).__name__, e)}))


PAGE = r"""<!doctype html>
<html lang="zh-Hant"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ERS · 影像轉 SVG</title>
<style>
:root{--bg:#0f1216;--pan:#171c23;--pan2:#1e242d;--line:#2a323d;--fg:#e8edf2;--mut:#93a1b0;--acc:#37d0a6;--acc2:#2aa4ff}
*{box-sizing:border-box}
body{margin:0;font:14px/1.5 system-ui,-apple-system,"Noto Sans TC",sans-serif;background:var(--bg);color:var(--fg)}
header{padding:16px 22px;border-bottom:1px solid var(--line);display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
h1{font-size:18px;margin:0;font-weight:650}
header .sub{color:var(--mut);font-size:12.5px}
.wrap{display:flex;gap:18px;padding:18px 22px;align-items:flex-start;flex-wrap:wrap}
.panel{background:var(--pan);border:1px solid var(--line);border-radius:12px;padding:16px}
.controls{width:300px;flex:0 0 300px}
.stage{flex:1 1 460px;min-width:340px}
label.f{display:block;margin:12px 0 4px;color:var(--mut);font-size:12.5px;font-weight:600}
.row{display:flex;justify-content:space-between;align-items:center;gap:8px}
.val{color:var(--acc);font-variant-numeric:tabular-nums;font-weight:650}
input[type=range]{width:100%;accent-color:var(--acc)}
select,input[type=color]{background:var(--pan2);color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:6px 8px}
.seg{display:flex;gap:6px}
.seg button{flex:1;background:var(--pan2);color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:7px;cursor:pointer}
.seg button.on{background:var(--acc);color:#04120d;border-color:var(--acc);font-weight:700}
.drop{border:1.5px dashed var(--line);border-radius:12px;padding:18px;text-align:center;color:var(--mut);cursor:pointer;transition:.15s}
.drop.hot{border-color:var(--acc);color:var(--fg);background:#141c1a}
.btn{width:100%;margin-top:14px;padding:11px;border:0;border-radius:10px;background:var(--acc);color:#04120d;font-weight:750;font-size:14.5px;cursor:pointer}
.btn:disabled{opacity:.5;cursor:default}
.btn.ghost{background:var(--pan2);color:var(--fg);border:1px solid var(--line);margin-top:8px}
.chk{display:flex;align-items:center;gap:8px;margin-top:10px}
.view{background:conic-gradient(#0000 90deg,#0002 0) 0 0/18px 18px,var(--pan2);border:1px solid var(--line);border-radius:10px;min-height:360px;display:flex;align-items:center;justify-content:center;overflow:auto;padding:10px}
.view svg,.view img{max-width:100%;max-height:70vh;height:auto;display:block}
.tabs{display:flex;gap:6px;margin-bottom:10px}
.tabs button{background:var(--pan2);color:var(--mut);border:1px solid var(--line);border-radius:8px;padding:6px 12px;cursor:pointer}
.tabs button.on{color:var(--fg);border-color:var(--acc)}
.stat{display:flex;gap:16px;flex-wrap:wrap;color:var(--mut);font-size:12.5px;margin-top:10px}
.stat b{color:var(--fg);font-variant-numeric:tabular-nums}
.err{color:#ff7a7a;margin-top:10px;font-size:13px;white-space:pre-wrap}
.spin{display:inline-block;width:14px;height:14px;border:2px solid #04120d55;border-top-color:#04120d;border-radius:50%;animation:s .7s linear infinite;vertical-align:-2px;margin-right:6px}
@keyframes s{to{transform:rotate(360deg)}}
.hint{color:var(--mut);font-size:11.5px;margin-top:4px}
</style></head>
<body>
<header>
  <h1>Entropy Rate Superpixel → SVG</h1>
  <span class="sub">上傳影像 (JPEG/PNG…) · 熵率超像素分割 · 下載向量 SVG</span>
</header>
<div class="wrap">
  <div class="panel controls">
    <div id="drop" class="drop">點此或拖曳影像到這裡<br><span class="hint">jpg / png / webp / bmp · ≤40MB</span></div>
    <input id="file" type="file" accept="image/*" style="display:none">

    <label class="f row"><span>超像素數量 nseg</span><span class="val" id="vseg">250</span></label>
    <input id="nseg" type="range" min="20" max="1200" step="10" value="250">
    <div class="hint">越大 → 區塊越多、越貼合細節</div>

    <label class="f row"><span>平衡權重 λ</span><span class="val" id="vlam">0.5</span></label>
    <input id="lam" type="range" min="0" max="2" step="0.05" value="0.5">
    <div class="hint">越大 → 超像素大小越均勻</div>

    <label class="f">連通性</label>
    <div class="seg" id="conn">
      <button data-v="4">4-鄰</button><button data-v="8" class="on">8-鄰</button>
    </div>

    <label class="f row"><span>分割解析度 (長邊)</span><span class="val" id="vmax">200</span></label>
    <input id="maxdim" type="range" min="96" max="400" step="8" value="200">
    <div class="hint">只影響分割精細度與耗時；SVG 仍以原尺寸輸出</div>

    <label class="f row"><span>邊界平滑 (去鋸齒)</span><span class="val" id="vsm">0.9</span></label>
    <input id="smooth" type="range" min="0" max="2" step="0.1" value="0.9">
    <div class="hint">0 = 逐像素方塊邊界；越大 → 階梯轉為斜線、越平滑(接合處仍緊密不留縫)</div>

    <div class="chk"><input id="stroke" type="checkbox"><label for="stroke">畫出區塊邊線</label>
      <input id="strokecol" type="color" value="#222222"></div>

    <button id="go" class="btn" disabled>轉換成 SVG</button>
    <button id="dl" class="btn ghost" disabled>下載 SVG</button>
    <button id="edit" class="btn ghost" disabled>編輯 SVG(裁切線以上色塊)</button>
    <div id="err" class="err"></div>
  </div>

  <div class="panel stage">
    <div class="tabs">
      <button id="tsvg" class="on">SVG 結果</button>
      <button id="tsrc">原圖</button>
    </div>
    <div class="view" id="view"><span style="color:var(--mut)">尚未有結果 — 先選一張圖再按「轉換成 SVG」</span></div>
    <div class="stat">
      <span>超像素 <b id="sk">–</b></span>
      <span>耗時 <b id="sms">–</b> ms</span>
      <span>輸出尺寸 <b id="sdim">–</b></span>
      <span>分割解析度 <b id="sres">–</b></span>
      <span>SVG 大小 <b id="ssz">–</b></span>
    </div>
  </div>
</div>
<script>
const $=id=>document.getElementById(id);
let file=null, svgText=null, srcURL=null, tab='svg';
function bind(sl,out,f){const e=$(sl),o=$(out);const u=()=>o.textContent=f?f(e.value):e.value;e.addEventListener('input',u);u();}
bind('nseg','vseg'); bind('lam','vlam',v=>(+v).toFixed(2)); bind('maxdim','vmax');
bind('smooth','vsm',v=>(+v).toFixed(1));
let conn='8';
document.querySelectorAll('#conn button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('#conn button').forEach(x=>x.classList.remove('on'));
  b.classList.add('on'); conn=b.dataset.v;});

const drop=$('drop');
drop.onclick=()=>$('file').click();
$('file').onchange=e=>{ if(e.target.files[0]) setFile(e.target.files[0]); };
['dragover','dragenter'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('hot');}));
['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('hot');}));
drop.addEventListener('drop',e=>{ if(e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); });
function setFile(f){
  if(!f.type.startsWith('image/')){ $('err').textContent='請選擇影像檔'; return; }
  file=f; $('err').textContent=''; $('go').disabled=false;
  if(srcURL) URL.revokeObjectURL(srcURL);
  srcURL=URL.createObjectURL(f);
  drop.innerHTML='已選：'+f.name+'<br><span class="hint">'+(f.size/1024|0)+' KB</span>';
  if(tab==='src') render();
}
$('tsvg').onclick=()=>{tab='svg';$('tsvg').classList.add('on');$('tsrc').classList.remove('on');render();};
$('tsrc').onclick=()=>{tab='src';$('tsrc').classList.add('on');$('tsvg').classList.remove('on');render();};
function render(){
  const v=$('view');
  if(tab==='src'){ v.innerHTML = srcURL?('<img src="'+srcURL+'">'):'<span style="color:var(--mut)">尚未選圖</span>'; }
  else { v.innerHTML = svgText || '<span style="color:var(--mut)">尚未有結果</span>'; }
}
$('go').onclick=async()=>{
  if(!file) return;
  $('err').textContent=''; $('go').disabled=true; $('dl').disabled=true;
  const q=new URLSearchParams({nseg:$('nseg').value,lam:$('lam').value,conn,
    maxdim:$('maxdim').value,smooth:$('smooth').value,
    stroke:$('stroke').checked?'1':'0',strokecol:$('strokecol').value});
  const old=$('go').innerHTML; $('go').innerHTML='<span class="spin"></span>分割中…';
  const t=performance.now();
  try{
    const r=await fetch('/convert?'+q.toString(),{method:'POST',body:file});
    const j=await r.json();
    if(!r.ok) throw new Error(j.error||('HTTP '+r.status));
    svgText=j.svg;
    $('sk').textContent=j.k; $('sms').textContent=j.ms;
    $('sdim').textContent=j.w+'×'+j.h; $('sres').textContent=j.sw+'×'+j.sh;
    $('ssz').textContent=(j.svg.length/1024).toFixed(1)+' KB';
    tab='svg'; $('tsvg').classList.add('on'); $('tsrc').classList.remove('on');
    render(); $('dl').disabled=false; $('edit').disabled=false;
  }catch(e){ $('err').textContent='錯誤：'+e.message; }
  finally{ $('go').disabled=false; $('go').innerHTML=old; }
};
$('edit').onclick=()=>{ if(svgText && window.SvgEditor) SvgEditor.open(svgText); };
$('dl').onclick=()=>{
  if(!svgText) return;
  const blob=new Blob([svgText],{type:'image/svg+xml'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=(file? file.name.replace(/\.[^.]+$/,'') : 'superpixels')+'.svg';
  a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
};
</script>
<script src="/editor.js"></script>
</body></html>"""


def main():
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    print("ERS SVG server on http://%s:%d" % (HOST, PORT))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        srv.shutdown()


if __name__ == "__main__":
    main()
