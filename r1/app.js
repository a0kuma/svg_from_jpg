(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  function clampi(v, lo, hi, d) {
    const n = Number(v);
    if (!Number.isFinite(n)) return d;
    return Math.max(lo, Math.min(hi, Math.trunc(n)));
  }
  function clampf(v, lo, hi, d) {
    const n = Number(v);
    if (!Number.isFinite(n)) return d;
    return Math.max(lo, Math.min(hi, n));
  }

  class MinHeap {
    constructor(items = []) {
      this.a = items;
      if (this.a.length) {
        for (let i = (this.a.length >> 1) - 1; i >= 0; i--) this._down(i);
      }
    }
    size() { return this.a.length; }
    peek() { return this.a[0]; }
    push(it) {
      const a = this.a;
      a.push(it);
      this._up(a.length - 1);
    }
    pop() {
      const a = this.a;
      if (!a.length) return null;
      const top = a[0];
      const last = a.pop();
      if (a.length) {
        a[0] = last;
        this._down(0);
      }
      return top;
    }
    _up(i) {
      const a = this.a;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p][0] <= a[i][0]) break;
        [a[p], a[i]] = [a[i], a[p]];
        i = p;
      }
    }
    _down(i) {
      const a = this.a;
      const n = a.length;
      for (;;) {
        let l = i * 2 + 1;
        if (l >= n) break;
        let r = l + 1;
        let m = (r < n && a[r][0] < a[l][0]) ? r : l;
        if (a[i][0] <= a[m][0]) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
  }

  function buildEdges(rgb01, W, H, conn) {
    const eu = [];
    const ev = [];
    const ecost2 = [];

    function addEdge(a, b) {
      eu.push(a); ev.push(b);
      const a3 = a * 3, b3 = b * 3;
      const dr = rgb01[a3] - rgb01[b3];
      const dg = rgb01[a3 + 1] - rgb01[b3 + 1];
      const db = rgb01[a3 + 2] - rgb01[b3 + 2];
      ecost2.push(dr * dr + dg * dg + db * db);
    }

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (x + 1 < W) addEdge(i, i + 1);
        if (y + 1 < H) addEdge(i, i + W);
        if (conn === 8) {
          if (x + 1 < W && y + 1 < H) addEdge(i, i + W + 1);
          if (x - 1 >= 0 && y + 1 < H) addEdge(i, i + W - 1);
        }
      }
    }
    return {
      eu: Int32Array.from(eu),
      ev: Int32Array.from(ev),
      ecost2: Float64Array.from(ecost2)
    };
  }

  function segmentERS(rgb8, W, H, nseg = 250, lam = 0.5, conn = 8, sigma = null) {
    const N = W * H;
    const K = Math.max(1, Math.min(Math.trunc(nseg), N));

    const rgb01 = new Float64Array(N * 3);
    for (let i = 0; i < rgb8.length; i++) rgb01[i] = rgb8[i] / 255.0;

    const { eu, ev, ecost2 } = buildEdges(rgb01, W, H, conn);
    const M = eu.length;

    let sigma2;
    if (sigma == null) {
      let sum = 0;
      for (let i = 0; i < M; i++) sum += ecost2[i];
      const mean = M ? sum / M : 0;
      sigma2 = mean > 1e-12 ? mean : 1e-6;
    } else {
      sigma2 = Number(sigma) * Number(sigma);
    }

    const ew = new Float64Array(M);
    for (let i = 0; i < M; i++) {
      const e = Math.exp(-ecost2[i] / (2.0 * sigma2));
      ew[i] = Math.max(e, 1e-9);
    }

    const w = new Float64Array(N);
    for (let i = 0; i < M; i++) {
      const u = eu[i], v = ev[i], e = ew[i];
      w[u] += e; w[v] += e;
    }
    let wT = 0;
    for (let i = 0; i < N; i++) {
      if (w[i] < 1e-12) w[i] = 1e-12;
      wT += w[i];
    }

    const invN = 1.0 / N;
    const invWT = 1.0 / wT;

    function dHVec(wv, e) {
      const b = wv - e;
      let g = -e * Math.log(e / wv);
      if (b > 0) g += b * Math.log(b / wv);
      return g;
    }

    const p1 = invN;
    const t1 = p1 * Math.log(p1);
    const p2 = 2.0 * invN;
    const dHz11 = 2.0 * t1 - p2 * Math.log(p2);

    const items = new Array(M);
    for (let i = 0; i < M; i++) {
      const gh = (dHVec(w[eu[i]], ew[i]) + dHVec(w[ev[i]], ew[i])) * invWT;
      const gb = lam * (dHz11 + 1.0);
      items[i] = [-(gh + gb), i];
    }
    const heap = new MinHeap(items);

    const s = new Float64Array(N);
    const parent = new Int32Array(N);
    const csize = new Int32Array(N);
    for (let i = 0; i < N; i++) { parent[i] = i; csize[i] = 1; }

    function find(x) {
      let root = x;
      while (parent[root] !== root) root = parent[root];
      while (parent[x] !== root) {
        const p = parent[x];
        parent[x] = root;
        x = p;
      }
      return root;
    }

    let ncomp = N;
    while (ncomp > K && heap.size()) {
      const top = heap.pop();
      if (!top) break;
      const k = top[1];
      const i = eu[k], j = ev[k];
      let ri = find(i), rj = find(j);
      if (ri === rj) continue;

      const e = ew[k];
      const wi = w[i], ai = wi - s[i], bi = ai - e;
      let gh = -e * Math.log(e / wi);
      if (ai > 0) gh += ai * Math.log(ai / wi);
      if (bi > 0) gh -= bi * Math.log(bi / wi);

      const wj = w[j], aj = wj - s[j], bj = aj - e;
      let gh2 = -e * Math.log(e / wj);
      if (aj > 0) gh2 += aj * Math.log(aj / wj);
      if (bj > 0) gh2 -= bj * Math.log(bj / wj);

      let na = csize[ri], nb = csize[rj];
      const pa = na * invN, pb = nb * invN, pab = (na + nb) * invN;
      const dhz = pa * Math.log(pa) + pb * Math.log(pb) - pab * Math.log(pab);
      const g = (gh + gh2) * invWT + lam * (dhz + 1.0);

      const peek = heap.peek();
      if (peek && (-g) > peek[0]) {
        heap.push([-g, k]);
        continue;
      }

      if (na < nb) {
        [ri, rj] = [rj, ri];
        [na, nb] = [nb, na];
      }
      parent[rj] = ri;
      csize[ri] = na + nb;
      s[i] += e;
      s[j] += e;
      ncomp--;
    }

    const labels = new Int32Array(N);
    const rootToLabel = new Map();
    let next = 0;
    for (let i = 0; i < N; i++) {
      const r = find(i);
      let id = rootToLabel.get(r);
      if (id == null) {
        id = next++;
        rootToLabel.set(r, id);
      }
      labels[i] = id;
    }
    return { labels, K: next };
  }

  function regionColors(labels, rgb8, K) {
    const cols = new Float64Array(K * 3);
    const cnt = new Float64Array(K);
    for (let i = 0; i < labels.length; i++) {
      const l = labels[i];
      cnt[l] += 1;
      const i3 = i * 3;
      cols[l * 3] += rgb8[i3];
      cols[l * 3 + 1] += rgb8[i3 + 1];
      cols[l * 3 + 2] += rgb8[i3 + 2];
    }
    const out = new Uint8Array(K * 3);
    for (let l = 0; l < K; l++) {
      const c = cnt[l] || 1;
      out[l * 3] = Math.round(cols[l * 3] / c);
      out[l * 3 + 1] = Math.round(cols[l * 3 + 1] / c);
      out[l * 3 + 2] = Math.round(cols[l * 3 + 2] / c);
    }
    return out;
  }

  function edgeMapPush(map, k, edge) {
    let arr = map.get(k);
    if (!arr) {
      arr = [];
      map.set(k, arr);
    }
    arr.push(edge);
  }

  function boundaryEdges(labels, W, H) {
    const edges = new Map();
    const idx = (x, y) => y * W + x;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const l = labels[idx(x, y)];
        if (y === 0 || labels[idx(x, y - 1)] !== l) edgeMapPush(edges, l, [x + 1, y, x, y]);
        if (x === 0 || labels[idx(x - 1, y)] !== l) edgeMapPush(edges, l, [x, y, x, y + 1]);
        if (y === H - 1 || labels[idx(x, y + 1)] !== l) edgeMapPush(edges, l, [x, y + 1, x + 1, y + 1]);
        if (x === W - 1 || labels[idx(x + 1, y)] !== l) edgeMapPush(edges, l, [x + 1, y + 1, x + 1, y]);
      }
    }
    return edges;
  }

  function traceLoops(edgeList) {
    const adj = new Map();
    const key = (x, y) => `${x},${y}`;
    for (const [ax, ay, bx, by] of edgeList) {
      const k = key(ax, ay);
      let arr = adj.get(k);
      if (!arr) { arr = []; adj.set(k, arr); }
      arr.push([bx, by]);
    }

    const loops = [];
    for (const startK of adj.keys()) {
      let arr = adj.get(startK);
      while (arr && arr.length) {
        const [sx, sy] = startK.split(",").map(Number);
        const start = [sx, sy];
        const loop = [start];
        let cur = arr.pop();
        loop.push(cur);
        while (cur[0] !== sx || cur[1] !== sy) {
          const ck = key(cur[0], cur[1]);
          const nxts = adj.get(ck);
          if (!nxts || !nxts.length) break;
          cur = nxts.pop();
          loop.push(cur);
        }
        loops.push(loop);
        arr = adj.get(startK);
      }
    }
    return loops;
  }

  function anchorGrid(labels, W, H) {
    const PW = W + 2;
    const PH = H + 2;
    const P = new Int32Array(PW * PH);
    P.fill(-1);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) P[(y + 1) * PW + (x + 1)] = labels[y * W + x];
    }
    const AW = W + 1;
    const AH = H + 1;
    const anc = new Uint8Array(AW * AH);
    for (let y = 0; y <= H; y++) {
      for (let x = 0; x <= W; x++) {
        const tl = P[y * PW + x];
        const tr = P[y * PW + (x + 1)];
        const bl = P[(y + 1) * PW + x];
        const br = P[(y + 1) * PW + (x + 1)];
        const m = (tr !== tl) ? tr : (bl !== tl ? bl : br);
        const le2 = ((tr === tl) || (tr === m)) && ((bl === tl) || (bl === m)) && ((br === tl) || (br === m));
        let v = !le2;
        if ((tl === br) && (tr === bl) && (tl !== tr)) v = true;
        anc[y * AW + x] = v ? 1 : 0;
      }
    }
    anc[0] = 1;
    anc[W] = 1;
    anc[H * AW] = 1;
    anc[H * AW + W] = 1;
    return { anc, AW };
  }

  function simplifyLoop(loop, anchorInfo) {
    const pts = (loop.length > 1 && loop[0][0] === loop[loop.length - 1][0] && loop[0][1] === loop[loop.length - 1][1])
      ? loop.slice(0, -1)
      : loop.slice();
    const n = pts.length;
    if (n <= 2) return pts;
    const out = [];
    for (let i = 0; i < n; i++) {
      const [ax, ay] = pts[(i + n - 1) % n];
      const [bx, by] = pts[i];
      const [cx, cy] = pts[(i + 1) % n];
      let keep = (bx - ax !== cx - bx) || (by - ay !== cy - by);
      if (anchorInfo) {
        const { anc, AW } = anchorInfo;
        if (anc[by * AW + bx]) keep = true;
      }
      if (keep) out.push([bx, by]);
    }
    return out;
  }

  function dp(points, tol) {
    const n = points.length;
    if (n <= 2) return points.slice();
    const keep = new Uint8Array(n);
    keep[0] = 1; keep[n - 1] = 1;
    const stack = [[0, n - 1]];
    const t2 = tol * tol;

    while (stack.length) {
      const [i, j] = stack.pop();
      const [ax, ay] = points[i];
      const [bx, by] = points[j];
      const dx = bx - ax, dy = by - ay;
      const seg2 = dx * dx + dy * dy;
      let dmax = -1, idx = -1;

      for (let k = i + 1; k < j; k++) {
        const [px, py] = points[k];
        let d2;
        if (seg2 === 0) {
          const ex = px - ax, ey = py - ay;
          d2 = ex * ex + ey * ey;
        } else {
          const cross = (px - ax) * dy - (py - ay) * dx;
          d2 = (cross * cross) / seg2;
        }
        if (d2 > dmax) {
          dmax = d2;
          idx = k;
        }
      }
      if (dmax > t2 && idx > 0) {
        keep[idx] = 1;
        stack.push([i, idx], [idx, j]);
      }
    }

    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
    return out;
  }

  function pointCmp(a, b) {
    if (a[0] !== b[0]) return a[0] - b[0];
    return a[1] - b[1];
  }

  function dpCanon(run, tol) {
    const rev = pointCmp(run[0], run[run.length - 1]) > 0;
    const simp = dp(rev ? run.slice().reverse() : run, tol);
    return rev ? simp.reverse() : simp;
  }

  function smoothLoop(sp, anchorInfo, tol) {
    const n = sp.length;
    const ancIdx = [];
    const { anc, AW } = anchorInfo;
    for (let i = 0; i < n; i++) {
      const [x, y] = sp[i];
      if (anc[y * AW + x]) ancIdx.push(i);
    }

    if (!ancIdx.length) {
      let start = 0;
      for (let i = 1; i < n; i++) if (pointCmp(sp[i], sp[start]) < 0) start = i;
      let rot = sp.slice(start).concat(sp.slice(0, start));
      if (rot.length > 2 && pointCmp(rot[1], rot[rot.length - 1]) > 0) {
        rot = [rot[0]].concat(rot.slice(1).reverse());
      }
      const out = dp(rot.concat([rot[0]]), tol);
      if (out.length > 1) {
        const a = out[0], b = out[out.length - 1];
        if (a[0] === b[0] && a[1] === b[1]) return out.slice(0, -1);
      }
      return out;
    }

    const out = [];
    let a = ancIdx[0];
    for (const b0 of ancIdx.slice(1).concat([ancIdx[0] + n])) {
      const run = [];
      for (let s = 0; s <= b0 - a; s++) run.push(sp[(a + s) % n]);
      const simp = dpCanon(run, tol);
      out.push(...simp.slice(0, -1));
      a = b0 % n;
    }
    return out;
  }

  function toSvg(labels, rgb8, W, H, K, opts = {}) {
    const {
      origSize = [W, H],
      stroke = null,
      strokeWidth = 0.6,
      precision = 2,
      background = null,
      smooth = 0.9
    } = opts;

    const cols = regionColors(labels, rgb8, K);
    const edges = boundaryEdges(labels, W, H);
    const anchorInfo = smooth > 0 ? anchorGrid(labels, W, H) : null;

    function num(v) {
      if (precision <= 0) return String(Math.round(v));
      let s = Number(v).toFixed(precision);
      if (s.includes(".")) s = s.replace(/\.0+$/, "").replace(/(\.[0-9]*?)0+$/, "$1");
      return s;
    }

    const parts = [];
    const [W0, H0] = origSize;
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${num(W0)}" height="${num(H0)}" viewBox="0 0 ${W} ${H}" shape-rendering="geometricPrecision">`);
    if (background) parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${background}"/>`);

    const borderAttr = stroke ? ` stroke="${stroke}" stroke-width="${num(strokeWidth)}" stroke-linejoin="round"` : "";

    for (let l = 0; l < K; l++) {
      const el = edges.get(l);
      if (!el || !el.length) continue;
      const dParts = [];
      for (const loop of traceLoops(el)) {
        let sp = simplifyLoop(loop, anchorInfo);
        if (sp.length < 3) continue;
        if (smooth > 0) {
          sp = smoothLoop(sp, anchorInfo, smooth);
          if (sp.length < 3) continue;
        }
        const d = `M${sp.map(([x, y]) => `${num(x)} ${num(y)}`).join(" ")}Z`;
        dParts.push(d);
      }
      if (!dParts.length) continue;
      const r = cols[l * 3], g = cols[l * 3 + 1], b = cols[l * 3 + 2];
      const hexc = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
      const sattr = borderAttr || ` stroke="${hexc}" stroke-width="0.75"`;
      parts.push(`<path fill="${hexc}"${sattr} fill-rule="evenodd" d="${dParts.join("")}"/>`);
    }

    parts.push("</svg>");
    return parts.join("\n");
  }

  async function fileToRgb(file, maxdim) {
    const bmp = await createImageBitmap(file);
    const W0 = bmp.width, H0 = bmp.height;
    const scale = maxdim / Math.max(W0, H0);
    const sw = scale < 1 ? Math.max(1, Math.round(W0 * scale)) : W0;
    const sh = scale < 1 ? Math.max(1, Math.round(H0 * scale)) : H0;

    const cv = document.createElement("canvas");
    cv.width = sw;
    cv.height = sh;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = "high";
    cx.drawImage(bmp, 0, 0, sw, sh);
    bmp.close?.();

    const rgba = cx.getImageData(0, 0, sw, sh).data;
    const rgb = new Uint8Array(sw * sh * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4) {
      rgb[j++] = rgba[i];
      rgb[j++] = rgba[i + 1];
      rgb[j++] = rgba[i + 2];
    }
    return { rgb, sw, sh, W0, H0 };
  }

  async function convertLocal(file, params) {
    const { rgb, sw, sh, W0, H0 } = await fileToRgb(file, params.maxdim);
    await new Promise((r) => setTimeout(r, 0));
    const t0 = performance.now();
    const { labels, K } = segmentERS(rgb, sw, sh, params.nseg, params.lam, params.conn);
    const svg = toSvg(labels, rgb, sw, sh, K, {
      origSize: [W0, H0],
      stroke: params.stroke ? params.strokecol : null,
      strokeWidth: 0.6,
      smooth: params.smooth,
    });
    const ms = Math.round(performance.now() - t0);
    return { svg, w: W0, h: H0, k: K, ms, sw, sh };
  }

  let file = null, svgText = null, srcURL = null, tab = "svg";

  function bind(sl, out, f) {
    const e = $(sl), o = $(out);
    const u = () => { o.textContent = f ? f(e.value) : e.value; };
    e.addEventListener("input", u);
    u();
  }

  bind("nseg", "vseg");
  bind("lam", "vlam", (v) => (+v).toFixed(2));
  bind("maxdim", "vmax");
  bind("smooth", "vsm", (v) => (+v).toFixed(1));

  let conn = 8;
  document.querySelectorAll("#conn button").forEach((b) => b.onclick = () => {
    document.querySelectorAll("#conn button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    conn = Number(b.dataset.v) === 4 ? 4 : 8;
  });

  const drop = $("drop");
  drop.onclick = () => $("file").click();
  $("file").onchange = (e) => { if (e.target.files[0]) setFile(e.target.files[0]); };
  ["dragover", "dragenter"].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add("hot");
  }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.remove("hot");
  }));
  drop.addEventListener("drop", (e) => { if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); });

  function setFile(f) {
    if (!f.type.startsWith("image/")) {
      $("err").textContent = "請選擇影像檔";
      return;
    }
    file = f;
    $("err").textContent = "";
    $("go").disabled = false;
    if (srcURL) URL.revokeObjectURL(srcURL);
    srcURL = URL.createObjectURL(f);
    drop.textContent = "";
    const line1 = document.createElement("div");
    line1.textContent = `已選：${f.name}`;
    const line2 = document.createElement("span");
    line2.className = "hint";
    line2.textContent = `${(f.size / 1024) | 0} KB`;
    drop.append(line1, line2);
    if (tab === "src") render();
  }

  $("tsvg").onclick = () => {
    tab = "svg";
    $("tsvg").classList.add("on");
    $("tsrc").classList.remove("on");
    render();
  };
  $("tsrc").onclick = () => {
    tab = "src";
    $("tsrc").classList.add("on");
    $("tsvg").classList.remove("on");
    render();
  };

  function render() {
    const v = $("view");
    if (tab === "src") {
      v.innerHTML = srcURL ? `<img src="${srcURL}">` : '<span style="color:var(--mut)">尚未選圖</span>';
    } else {
      v.innerHTML = svgText || '<span style="color:var(--mut)">尚未有結果</span>';
    }
  }

  $("go").onclick = async () => {
    if (!file) return;
    $("err").textContent = "";
    $("go").disabled = true;
    $("dl").disabled = true;
    $("edit").disabled = true;

    const params = {
      nseg: clampi($("nseg").value, 2, 4000, 250),
      lam: clampf($("lam").value, 0, 5, 0.5),
      conn,
      maxdim: clampi($("maxdim").value, 48, 400, 200),
      smooth: clampf($("smooth").value, 0, 3, 0.9),
      stroke: $("stroke").checked,
      strokecol: $("strokecol").value,
    };

    const old = $("go").innerHTML;
    $("go").innerHTML = '<span class="spin"></span>分割中…';
    try {
      const j = await convertLocal(file, params);
      svgText = j.svg;
      $("sk").textContent = j.k;
      $("sms").textContent = j.ms;
      $("sdim").textContent = `${j.w}×${j.h}`;
      $("sres").textContent = `${j.sw}×${j.sh}`;
      $("ssz").textContent = `${(j.svg.length / 1024).toFixed(1)} KB`;
      tab = "svg";
      $("tsvg").classList.add("on");
      $("tsrc").classList.remove("on");
      render();
      $("dl").disabled = false;
      $("edit").disabled = false;
    } catch (e) {
      $("err").textContent = `錯誤：${e.message || e}`;
    } finally {
      $("go").disabled = false;
      $("go").innerHTML = old;
    }
  };

  $("edit").onclick = () => {
    if (svgText && window.SvgEditor) window.SvgEditor.open(svgText);
  };

  $("dl").onclick = () => {
    if (!svgText) return;
    const blob = new Blob([svgText], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${file ? file.name.replace(/\.[^.]+$/, "") : "superpixels"}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
})();
