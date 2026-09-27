"""
Turn an integer superpixel label map into an SVG.

Each superpixel becomes one <path> filled with the region's mean colour. Region
outlines are traced exactly from the pixel grid (rectilinear polygons), so the
SVG is a faithful, resolution-independent vectorisation of the segmentation —
holes (a region enclosing another) are handled via fill-rule:evenodd.
"""
from collections import defaultdict
import numpy as np


def _region_colors(labels, img, K):
    """Mean RGB (0-255) per label. img: (H,W,3) uint8/float in same size as labels."""
    img = np.asarray(img)
    if img.dtype != np.uint8:
        img = np.clip(img * (255.0 if img.max() <= 1.5 else 1.0), 0, 255).astype(np.uint8)
    flat = labels.ravel()
    cols = np.zeros((K, 3), np.float64)
    cnt = np.bincount(flat, minlength=K).astype(np.float64)
    for ch in range(3):
        cols[:, ch] = np.bincount(flat, weights=img[:, :, ch].ravel().astype(np.float64),
                                  minlength=K)
    cnt[cnt == 0] = 1
    cols /= cnt[:, None]
    return np.clip(np.round(cols), 0, 255).astype(int)


def _boundary_edges(labels):
    """Return dict: label -> list of directed unit edges (ax,ay,bx,by) on the
    pixel-corner grid, oriented so the region lies on the LEFT of each edge."""
    H, W = labels.shape
    edges = defaultdict(list)

    up = np.ones((H, W), bool); up[1:, :] = labels[1:, :] != labels[:-1, :]
    dn = np.ones((H, W), bool); dn[:-1, :] = labels[:-1, :] != labels[1:, :]
    lf = np.ones((H, W), bool); lf[:, 1:] = labels[:, 1:] != labels[:, :-1]
    rt = np.ones((H, W), bool); rt[:, :-1] = labels[:, :-1] != labels[:, 1:]

    # For a pixel at (col=c, row=r): corners P00=(c,r) P10=(c+1,r)
    # P11=(c+1,r+1) P01=(c,r+1).  Interior-on-left directed edges:
    #   top  : P10->P00     left  : P00->P01
    #   bottom: P01->P11    right : P11->P10
    def emit(mask, dax, day, dbx, dby):
        rs, cs = np.nonzero(mask)
        ls = labels[rs, cs]
        for r, c, l in zip(rs.tolist(), cs.tolist(), ls.tolist()):
            edges[l].append((c + dax, r + day, c + dbx, r + dby))

    emit(up, 1, 0, 0, 0)     # top    : (c+1,r)   -> (c,r)
    emit(lf, 0, 0, 0, 1)     # left   : (c,r)     -> (c,r+1)
    emit(dn, 0, 1, 1, 1)     # bottom : (c,r+1)   -> (c+1,r+1)
    emit(rt, 1, 1, 1, 0)     # right  : (c+1,r+1) -> (c+1,r)
    return edges


def _trace_loops(edge_list):
    """Decompose a region's directed unit edges into closed rectilinear loops."""
    adj = defaultdict(list)
    for ax, ay, bx, by in edge_list:
        adj[(ax, ay)].append((bx, by))
    loops = []
    for start in list(adj.keys()):
        while adj[start]:
            loop = [start]
            cur = adj[start].pop()
            loop.append(cur)
            while cur != start:
                nxts = adj[cur]
                if not nxts:
                    break            # open (shouldn't happen for a valid region)
                cur = nxts.pop()
                loop.append(cur)
            loops.append(loop)
    return loops


def _simplify(loop, anchor=None):
    """Drop collinear vertices from a rectilinear loop (loop[0]==loop[-1]).
    Anchor (junction) points are ALWAYS kept, even when collinear, so a shared
    boundary is split into identical sub-runs from both neighbouring regions."""
    pts = loop[:-1] if len(loop) > 1 and loop[0] == loop[-1] else loop
    n = len(pts)
    if n <= 2:
        return pts
    out = []
    for i in range(n):
        ax, ay = pts[i - 1]
        bx, by = pts[i]
        cx, cy = pts[(i + 1) % n]
        keep = (bx - ax, by - ay) != (cx - bx, cy - by)   # a real turn
        if anchor is not None and anchor[by, bx]:
            keep = True                                    # junction: always keep
        if keep:
            out.append((bx, by))
    return out


def _anchor_grid(labels):
    """Mark every pixel-corner (H+1 x W+1) that is a JUNCTION: a point where >=3
    regions meet (counting the outside as its own region), plus the 4 image
    corners.  The decision is GLOBAL, so a boundary shared by two regions is split
    at exactly the same junctions from both sides -> smoothing stays watertight.
    Non-junction corners are simple steps that get straightened into diagonals."""
    H, W = labels.shape
    P = np.full((H + 2, W + 2), -1, labels.dtype)
    P[1:-1, 1:-1] = labels
    tl = P[0:H + 1, 0:W + 1]; tr = P[0:H + 1, 1:W + 2]
    bl = P[1:H + 2, 0:W + 1]; br = P[1:H + 2, 1:W + 2]
    m = np.where(tr != tl, tr, np.where(bl != tl, bl, br))
    le2 = ((tr == tl) | (tr == m)) & ((bl == tl) | (bl == m)) & ((br == tl) | (br == m))
    anc = ~le2                                  # >=3 distinct labels -> junction
    # diagonal "pinch" (A,B,A,B checkerboard): 4 boundary edges meet, the two
    # regions can route through it differently -> pin it so smoothing agrees.
    anc |= (tl == br) & (tr == bl) & (tl != tr)
    anc[0, 0] = anc[0, W] = anc[H, 0] = anc[H, W] = True   # keep image corners sharp
    return anc


def _dp(pts, tol):
    """Douglas-Peucker simplification of an OPEN polyline (endpoints kept). The
    result depends only on the point set, so it is identical (reversed) on both
    sides of a shared run -> watertight. This is what turns a unit staircase into
    a single clean diagonal while preserving genuinely curved boundaries."""
    n = len(pts)
    if n <= 2:
        return pts
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    t2 = tol * tol
    while stack:
        i, j = stack.pop()
        ax, ay = pts[i]; bx, by = pts[j]
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy
        dmax, idx = -1.0, -1
        for k in range(i + 1, j):
            px, py = pts[k]
            if seg2 == 0.0:
                ex, ey = px - ax, py - ay
                d2 = ex * ex + ey * ey
            else:
                cross = (px - ax) * dy - (py - ay) * dx
                d2 = cross * cross / seg2
            if d2 > dmax:
                dmax, idx = d2, k
        if dmax > t2 and idx > 0:
            keep[idx] = True
            stack.append((i, idx)); stack.append((idx, j))
    return [pts[k] for k in range(n) if keep[k]]


def _dp_canon(run, tol):
    """DP a run, but simplify it in a canonical orientation (smaller endpoint
    first) so the neighbouring region -- which walks the same run reversed -- gets
    the IDENTICAL kept points even when deviations tie. Returned in input order."""
    rev = tuple(run[0]) > tuple(run[-1])
    simp = _dp(run[::-1] if rev else run, tol)
    return simp[::-1] if rev else simp


def _smooth_loop(sp, anchor, tol):
    """Straighten a rectilinear loop's staircases into diagonals by running DP on
    each run of points BETWEEN junction anchors (anchors held fixed). If the loop
    has no anchor (an island fully inside one region) it is DP-simplified as a
    closed curve from a canonical start/orientation so both neighbours agree."""
    n = len(sp)
    anc_idx = [i for i in range(n) if anchor[sp[i][1], sp[i][0]]]
    if not anc_idx:
        start = min(range(n), key=lambda i: sp[i])          # canonical start
        rot = sp[start:] + sp[:start]
        if len(rot) > 2 and tuple(rot[1]) > tuple(rot[-1]):  # canonical direction
            rot = [rot[0]] + rot[1:][::-1]
        out = _dp(rot + [rot[0]], tol)
        return out[:-1] if len(out) > 1 and out[0] == out[-1] else out
    out = []
    a = anc_idx[0]
    for b in anc_idx[1:] + [anc_idx[0] + n]:
        run = [sp[(a + s) % n] for s in range(b - a + 1)]   # anchor a .. anchor b
        simp = _dp_canon(run, tol)
        out.extend(simp[:-1])                               # drop shared endpoint
        a = b % n
    return out


def to_svg(labels, img, K, orig_size=None, stroke=None, stroke_width=0.6,
           precision=2, background=None, smooth=2):
    """Build an SVG string.
    labels : (H,W) int label map (segmentation resolution).
    img    : (H,W,3) image at the SAME size as labels (for mean colours).
    orig_size : (W0,H0) to set the displayed size; viewBox stays in grid units.
    stroke : None (no borders) or a colour string (e.g. '#333') for cell edges.
    smooth : DP tolerance in pixels. 0 = blocky pixel-exact outlines; larger =
             staircases straightened into diagonals more aggressively (junctions
             stay put, watertight). ~0.9 is a good default.
    """
    H, W = labels.shape
    cols = _region_colors(labels, img, K)
    edges = _boundary_edges(labels)
    anchor = _anchor_grid(labels) if smooth > 0 else None

    fmt = ("%.{}f".format(precision)) if precision > 0 else "%d"

    def num(v):
        if precision <= 0:
            return "%d" % round(v)
        s = fmt % v
        if "." in s:
            s = s.rstrip("0").rstrip(".")
        return s

    parts = []
    W0, H0 = orig_size if orig_size else (W, H)
    parts.append(
        '<svg xmlns="http://www.w3.org/2000/svg" width="%s" height="%s" '
        'viewBox="0 0 %d %d" shape-rendering="geometricPrecision">' % (num(W0), num(H0), W, H))
    if background:
        parts.append('<rect x="0" y="0" width="%d" height="%d" fill="%s"/>' % (W, H, background))

    # When no visible border is requested, stroke each region with its OWN fill
    # colour (thin) to seal the hairline anti-alias seams browsers leave between
    # adjacent polygons that share an edge.
    border_attr = ''
    if stroke:
        border_attr = ' stroke="%s" stroke-width="%s" stroke-linejoin="round"' % (
            stroke, num(stroke_width))

    for l in range(K):
        el = edges.get(l)
        if not el:
            continue
        r, g, b = cols[l]
        d_parts = []
        for loop in _trace_loops(el):
            sp = _simplify(loop, anchor)   # turn-corners + junctions
            if len(sp) < 3:
                continue
            if smooth > 0:
                sp = _smooth_loop(sp, anchor, smooth)   # staircases -> diagonals
                if len(sp) < 3:
                    continue
            d = "M" + " ".join("%s %s" % (num(x), num(y)) for x, y in sp) + "Z"
            d_parts.append(d)
        if not d_parts:
            continue
        hexc = "#%02x%02x%02x" % (r, g, b)
        sattr = border_attr or (' stroke="%s" stroke-width="0.75"' % hexc)
        parts.append('<path fill="%s"%s fill-rule="evenodd" d="%s"/>' % (
            hexc, sattr, "".join(d_parts)))
    parts.append('</svg>')
    return "\n".join(parts)
