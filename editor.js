/* SvgEditor — a self-contained front-end plugin.
 *
 *   SvgEditor.open(svgText)
 *
 * 1. renders the SVG onto an HTML5 canvas (zoom + pan), full-screen, hiding all
 *    other page UI/text/buttons;
 * 2. lets the user draw one freehand line on the canvas;
 * 3. removes every closed colour region whose centroid lies ABOVE that line
 *    (smaller y / screen-up);
 * 4. downloads the edited SVG.
 *
 * No dependencies; parses/serialises the SVG via the browser DOM so the exported
 * file keeps the original viewBox, attributes and seal strokes minus the removed
 * <path> elements.
 */
(function () {
  "use strict";

  var dom, svgEl, vb, paths, removed, line, mode, view, dragging, lastPt, dpr;
  var elOverlay, elCanvas, ctx, elCount, elModeBtn;

  // ---- geometry helpers -------------------------------------------------
  function parsePoints(d) {
    // our paths are "M x y x y ... Z [M ...Z]" -> array of loops (arrays of [x,y])
    var loops = [];
    d.split("M").forEach(function (chunk) {
      chunk = chunk.trim();
      if (!chunk) return;
      var nums = chunk.replace(/Z/g, " ").match(/-?\d*\.?\d+(?:e-?\d+)?/gi);
      if (!nums || nums.length < 6) return;
      var pts = [];
      for (var i = 0; i + 1 < nums.length; i += 2) pts.push([+nums[i], +nums[i + 1]]);
      loops.push(pts);
    });
    return loops;
  }

  function centroid(loops) {
    var totA = 0, cx = 0, cy = 0, n = 0, sx = 0, sy = 0;
    loops.forEach(function (pts) {
      var a = 0, gx = 0, gy = 0;
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i], q = pts[(i + 1) % pts.length];
        var cr = p[0] * q[1] - q[0] * p[1];
        a += cr; gx += (p[0] + q[0]) * cr; gy += (p[1] + q[1]) * cr;
        sx += p[0]; sy += p[1]; n++;
      }
      a *= 0.5;
      if (a !== 0) { totA += a; cx += (gx / (6 * a)) * a; cy += (gy / (6 * a)) * a; }
    });
    if (totA !== 0) return [cx / totA, cy / totA];
    return n ? [sx / n, sy / n] : [0, 0];   // fallback: vertex average
  }

  function pointInPoly(x, y, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  function abovePolygon() {
    // close the drawn line into a polygon covering everything ABOVE it, extended
    // horizontally to the viewBox left/right edges and up to the top.
    if (line.length < 2) return null;
    var left = vb[0], right = vb[0] + vb[2], top = vb[1];
    var poly = [[left, line[0][1]]];
    for (var i = 0; i < line.length; i++) poly.push(line[i]);
    poly.push([right, line[line.length - 1][1]]);
    poly.push([right, top]);
    poly.push([left, top]);
    return poly;
  }

  function regionsAbove() {
    var poly = abovePolygon();
    if (!poly) return [];
    return paths.filter(function (p) {
      return !removed.has(p) && pointInPoly(p.c[0], p.c[1], poly);
    });
  }

  // ---- view / coordinates ----------------------------------------------
  function toSvg(sx, sy) { return [(sx - view.tx) / view.scale, (sy - view.ty) / view.scale]; }

  function fitView() {
    var cw = elCanvas.clientWidth, ch = elCanvas.clientHeight;
    var s = Math.min(cw / vb[2], ch / vb[3]) * 0.92;
    view.scale = s;
    view.tx = (cw - vb[2] * s) / 2 - vb[0] * s;
    view.ty = (ch - vb[3] * s) / 2 - vb[1] * s;
  }

  function render() {
    var cw = elCanvas.clientWidth, ch = elCanvas.clientHeight;
    if (elCanvas.width !== cw * dpr || elCanvas.height !== ch * dpr) {
      elCanvas.width = cw * dpr; elCanvas.height = ch * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0b0e12"; ctx.fillRect(0, 0, cw, ch);
    // page/white sheet behind the artwork
    var s = view.scale;
    ctx.setTransform(s * dpr, 0, 0, s * dpr, view.tx * dpr, view.ty * dpr);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(vb[0], vb[1], vb[2], vb[3]);

    var seal = 0.75 / s;
    for (var i = 0; i < paths.length; i++) {
      var p = paths[i];
      if (removed.has(p)) continue;
      ctx.fillStyle = p.fill;
      ctx.fill(p.p2d, p.rule);
      ctx.strokeStyle = p.fill; ctx.lineWidth = seal; ctx.stroke(p.p2d);  // seal seams
    }

    // preview: tint regions that the current line would remove
    var prev = regionsAbove();
    if (prev.length) {
      ctx.fillStyle = "rgba(255,45,60,0.45)";
      for (var k = 0; k < prev.length; k++) ctx.fill(prev[k].p2d, prev[k].rule);
    }

    // the drawn line
    if (line.length) {
      ctx.strokeStyle = "#ff2d3c"; ctx.lineWidth = 2 / s;
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(line[0][0], line[0][1]);
      for (var m = 1; m < line.length; m++) ctx.lineTo(line[m][0], line[m][1]);
      ctx.stroke();
    }
    elCount.textContent = prev.length ? (prev.length + " 個色塊將被移除") :
      (removed.size ? ("已移除 " + removed.size + " 個") : "在畫面上由左至右畫一條線");
  }

  // ---- actions ----------------------------------------------------------
  function commit() {
    var prev = regionsAbove();
    prev.forEach(function (p) { removed.add(p); });
    line = [];
    render();
  }
  function resetAll() { removed = new Set(); line = []; render(); }

  function download() {
    var clone = dom.documentElement.cloneNode(true);
    var cps = clone.querySelectorAll("path");
    for (var i = 0; i < paths.length; i++) if (removed.has(paths[i])) cps[i].parentNode.removeChild(cps[i]);
    var out = new XMLSerializer().serializeToString(clone);
    if (out.indexOf("xmlns") === -1) out = out.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
    var blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + out], { type: "image/svg+xml" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "edited.svg"; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  function setMode(m) {
    mode = m;
    elModeBtn.textContent = (m === "draw") ? "✏️ 畫線中" : "🖐 移動/縮放";
    elModeBtn.classList.toggle("on", m === "draw");
    elCanvas.style.cursor = (m === "draw") ? "crosshair" : "grab";
  }

  // ---- input ------------------------------------------------------------
  function bindInput() {
    elCanvas.addEventListener("wheel", function (e) {
      e.preventDefault();
      var rect = elCanvas.getBoundingClientRect();
      var sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      var pre = toSvg(sx, sy);
      var f = Math.exp(-e.deltaY * 0.0015);
      view.scale *= f;
      view.tx = sx - pre[0] * view.scale;
      view.ty = sy - pre[1] * view.scale;
      render();
    }, { passive: false });

    elCanvas.addEventListener("mousedown", function (e) {
      var rect = elCanvas.getBoundingClientRect();
      var sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      dragging = true; lastPt = [sx, sy];
      if (mode === "draw") { line = [toSvg(sx, sy)]; render(); }
      else elCanvas.style.cursor = "grabbing";
    });
    window.addEventListener("mousemove", function (e) {
      if (!dragging) return;
      var rect = elCanvas.getBoundingClientRect();
      var sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      if (mode === "draw") { line.push(toSvg(sx, sy)); }
      else { view.tx += sx - lastPt[0]; view.ty += sy - lastPt[1]; }
      lastPt = [sx, sy];
      render();
    });
    window.addEventListener("mouseup", function () {
      if (dragging && mode !== "draw") elCanvas.style.cursor = "grab";
      dragging = false;
    });
    window.addEventListener("keydown", function (e) {
      if (elOverlay.style.display === "none") return;
      if (e.key === "Escape") close();
      else if (e.key === "d" || e.key === "D") setMode(mode === "draw" ? "pan" : "draw");
    });
    window.addEventListener("resize", function () {
      if (elOverlay.style.display !== "none") render();
    });
  }

  // ---- overlay ----------------------------------------------------------
  function ensureOverlay() {
    if (elOverlay) return;
    var css = document.createElement("style");
    css.textContent =
      "#svged{position:fixed;inset:0;z-index:2000;background:#0b0e12;display:none}" +
      "#svged canvas{position:absolute;inset:0;width:100%;height:100%;display:block}" +
      "#svged .bar{position:absolute;top:14px;left:50%;transform:translateX(-50%);display:flex;gap:8px;" +
      "background:rgba(20,26,33,.92);border:1px solid #2a323d;border-radius:12px;padding:8px 10px;" +
      "box-shadow:0 6px 24px #0008;align-items:center}" +
      "#svged .bar button{background:#1e242d;color:#e8edf2;border:1px solid #2a323d;border-radius:8px;" +
      "padding:8px 12px;font:13px system-ui,sans-serif;cursor:pointer;white-space:nowrap}" +
      "#svged .bar button:hover{border-color:#37d0a6}" +
      "#svged .bar button.on{background:#37d0a6;color:#04120d;border-color:#37d0a6;font-weight:700}" +
      "#svged .bar button.p{background:#ff2d3c;color:#fff;border-color:#ff2d3c;font-weight:700}" +
      "#svged .bar .sep{width:1px;height:22px;background:#2a323d;margin:0 2px}" +
      "#svged .cnt{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);color:#93a1b0;" +
      "background:rgba(20,26,33,.9);border:1px solid #2a323d;border-radius:8px;padding:6px 12px;font:12.5px system-ui}";
    document.head.appendChild(css);

    elOverlay = document.createElement("div");
    elOverlay.id = "svged";
    elOverlay.innerHTML =
      '<canvas></canvas>' +
      '<div class="bar">' +
      '<button data-a="mode">🖐 移動/縮放</button>' +
      '<button data-a="fit">⤢ 適配</button>' +
      '<div class="sep"></div>' +
      '<button data-a="cut" class="p">✂️ 移除線以上</button>' +
      '<button data-a="reset">↺ 復原全部</button>' +
      '<div class="sep"></div>' +
      '<button data-a="dl" class="on">⬇️ 下載 SVG</button>' +
      '<button data-a="close">✕ 關閉</button>' +
      '</div>' +
      '<div class="cnt">—</div>';
    document.body.appendChild(elOverlay);
    elCanvas = elOverlay.querySelector("canvas");
    ctx = elCanvas.getContext("2d");
    elCount = elOverlay.querySelector(".cnt");
    elModeBtn = elOverlay.querySelector('[data-a="mode"]');
    elOverlay.querySelector(".bar").addEventListener("click", function (e) {
      var a = e.target.getAttribute("data-a");
      if (a === "mode") setMode(mode === "draw" ? "pan" : "draw");
      else if (a === "fit") { fitView(); render(); }
      else if (a === "cut") commit();
      else if (a === "reset") resetAll();
      else if (a === "dl") download();
      else if (a === "close") close();
    });
    bindInput();
  }

  function open(svgText) {
    ensureOverlay();
    dom = new DOMParser().parseFromString(svgText, "image/svg+xml");
    svgEl = dom.documentElement;
    var vbAttr = (svgEl.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
    if (vbAttr.length === 4 && vbAttr.every(function (x) { return !isNaN(x); })) vb = vbAttr;
    else vb = [0, 0, +svgEl.getAttribute("width") || 100, +svgEl.getAttribute("height") || 100];

    paths = Array.prototype.map.call(dom.querySelectorAll("path"), function (el) {
      var d = el.getAttribute("d") || "";
      return { el: el, fill: el.getAttribute("fill") || "#000",
               rule: el.getAttribute("fill-rule") === "evenodd" ? "evenodd" : "nonzero",
               p2d: new Path2D(d), c: centroid(parsePoints(d)) };
    });
    removed = new Set(); line = []; dragging = false;
    dpr = window.devicePixelRatio || 1;
    view = { scale: 1, tx: 0, ty: 0 };
    elOverlay.style.display = "block";
    setMode("draw");
    fitView();
    render();
  }

  function close() { if (elOverlay) elOverlay.style.display = "none"; }

  window.SvgEditor = { open: open, close: close };
})();
