"""
Entropy Rate Superpixel (ERS) segmentation.

Faithful implementation of:
    Ming-Yu Liu, Oncel Tuzel, Srikumar Ramalingam, Rama Chellappa,
    "Entropy Rate Superpixel Segmentation", CVPR 2011.

We build an 8- (or 4-) connected pixel graph with similarity weights
    w_ij = exp(-||c_i - c_j||^2 / (2*sigma^2)),
then greedily select a subset A of edges maximising

    F(A) = H(A) + lambda * B(A)

where H(A) is the entropy rate of the random walk on the graph restricted to
A (with the stationary distribution fixed by the FULL graph via self-loops),
and B(A) is the balancing term H(Z_A) - N_A that favours superpixels of
similar size.  F is monotone submodular, so a lazy greedy (Minoux) reproduces
the standard greedy solution.  Adding an edge that joins two different clusters
merges them; we stop once exactly K connected components (superpixels) remain,
so the selected edge set is a spanning forest with K trees.

Pure numpy + stdlib.  Returns an (H, W) int label map in [0, K).
"""
import math
import heapq
import numpy as np


def _build_edges(img, conn):
    """img: (H,W,3) float in [0,1]. Returns (eu, ev, ecost2) for unique edges.
    ecost2 is the squared colour distance for each edge."""
    H, W, _ = img.shape
    idx = np.arange(H * W).reshape(H, W)
    flat = img.reshape(H * W, 3)

    # neighbour offsets: right, down, and (for 8-conn) the two diagonals.
    # Each unique undirected edge is emitted exactly once.
    offs = [(0, 1), (1, 0)]
    if conn == 8:
        offs += [(1, 1), (1, -1)]

    eu_l, ev_l = [], []
    for dy, dx in offs:
        y0, y1 = max(0, -dy), H - max(0, dy)
        x0, x1 = max(0, -dx), W - max(0, dx)
        a = idx[y0:y1, x0:x1].ravel()
        b = idx[y0 + dy:y1 + dy, x0 + dx:x1 + dx].ravel()
        eu_l.append(a)
        ev_l.append(b)
    eu = np.concatenate(eu_l)
    ev = np.concatenate(ev_l)
    d = flat[eu] - flat[ev]
    ecost2 = np.einsum('ij,ij->i', d, d)
    return eu, ev, ecost2


def segment(img, nseg=250, lam=0.5, conn=8, sigma=None):
    """Run ERS.
    img : (H,W,3) uint8 or float array.
    nseg: desired number of superpixels K.
    lam : balancing weight lambda.
    conn: 4 or 8 connectivity.
    sigma: colour bandwidth; if None, sqrt(mean squared edge distance).
    Returns (labels HxW int32, K_actual).
    """
    img = np.asarray(img)
    if img.dtype != np.float64 and img.dtype != np.float32:
        img = img.astype(np.float64) / 255.0
    else:
        img = img.astype(np.float64)
        if img.max() > 1.5:
            img = img / 255.0
    H, W, _ = img.shape
    N = H * W
    K = max(1, min(int(nseg), N))

    eu, ev, ecost2 = _build_edges(img, conn)
    if sigma is None:
        m = float(ecost2.mean())
        sigma2 = m if m > 1e-12 else 1e-6
    else:
        sigma2 = float(sigma) ** 2
    ew = np.exp(-ecost2 / (2.0 * sigma2))
    # avoid exact-zero weights (log undefined); clamp tiny.
    np.maximum(ew, 1e-9, out=ew)

    # total incident weight per node (over the FULL graph) -> fixes mu_i.
    w = np.zeros(N)
    np.add.at(w, eu, ew)
    np.add.at(w, ev, ew)
    w = np.maximum(w, 1e-12)
    wT = float(w.sum())

    invN = 1.0 / N
    inv_wT = 1.0 / wT

    # initial lazy-greedy heap (s=0, all clusters size 1) computed vectorised.
    def _dH_vec(wv, e):
        b = wv - e                   # a = w - s = w, so a*log(a/w) = 0
        g = -e * np.log(e / wv)
        g += np.where(b > 0, b * np.log(np.where(b > 0, b, 1.0) / wv), 0.0)
        return g
    p1 = invN
    t1 = p1 * math.log(p1)           # t(1)
    p2 = 2.0 * invN
    dHz11 = 2.0 * t1 - p2 * math.log(p2)
    gH0 = (_dH_vec(w[eu], ew) + _dH_vec(w[ev], ew)) * inv_wT
    gB0 = lam * (dHz11 + 1.0)        # identical for every initial edge
    keys = -(gH0 + gB0)
    heap = list(zip(keys.tolist(), range(len(eu))))
    heapq.heapify(heap)

    # hot loop uses Python lists (far faster than numpy scalar indexing).
    eu_l = eu.tolist(); ev_l = ev.tolist(); ew_l = ew.tolist(); w_l = w.tolist()
    s = [0.0] * N
    parent = list(range(N))
    csize = [1] * N
    log = math.log
    heappop = heapq.heappop
    heappush = heapq.heappush
    lam_ = lam

    def find(x):
        root = x
        while parent[root] != root:
            root = parent[root]
        while parent[x] != root:
            parent[x], x = root, parent[x]
        return root

    ncomp = N
    while ncomp > K and heap:
        negg, k = heappop(heap)
        i = eu_l[k]; j = ev_l[k]
        ri = find(i)
        rj = find(j)
        if ri == rj:
            continue                      # cycle edge: never merges
        e = ew_l[k]
        # --- inlined gain(i, j, e, csize[ri], csize[rj]) ---
        wi = w_l[i]; ai = wi - s[i]; bi = ai - e
        gh = -e * log(e / wi)
        if ai > 0.0:
            gh += ai * log(ai / wi)
        if bi > 0.0:
            gh -= bi * log(bi / wi)
        wj = w_l[j]; aj = wj - s[j]; bj = aj - e
        gh2 = -e * log(e / wj)
        if aj > 0.0:
            gh2 += aj * log(aj / wj)
        if bj > 0.0:
            gh2 -= bj * log(bj / wj)
        na = csize[ri]; nb = csize[rj]
        pa = na * invN; pb = nb * invN; pab = (na + nb) * invN
        dhz = pa * log(pa) + pb * log(pb) - pab * log(pab)
        g = (gh + gh2) * inv_wT + lam_ * (dhz + 1.0)
        # ---------------------------------------------------
        # lazy check: gains are non-increasing, so the stored key is an upper
        # bound. If some other edge still stores a larger gain, defer this one.
        if heap and (-g) > heap[0][0]:
            heappush(heap, (-g, k))
            continue
        # accept: merge smaller root into larger
        if na < nb:
            ri, rj = rj, ri
        parent[rj] = ri
        csize[ri] = na + nb
        s[i] += e
        s[j] += e
        ncomp -= 1

    # compact labels
    roots = np.fromiter((find(x) for x in range(N)), dtype=np.int64, count=N)
    _, labels = np.unique(roots, return_inverse=True)
    return labels.reshape(H, W).astype(np.int32), int(labels.max()) + 1
