# Usage: awk -f analyze.awk capture.txt
# Lines look like: "361345 $DFDMD,1,1,1.245,-0.273,13833, , *"
# Prints detection ratio, repeated (extrapolated) frames, range/speed/energy stats,
# frame-to-frame range jumps, and a 1-second timeline.
function abs(x) { return x < 0 ? -x : x }
/\$DFDMD/ {
  t = $1 + 0
  split($2, f, ",")
  frames++
  if (t0 == "") t0 = t
  sec = int((t - t0) / 1000)
  if (sec > maxSec) maxSec = sec
  secFrames[sec]++
  if (f[2] + 0 == 0) { prevHit = 0; next }
  r = f[4] + 0; v = f[5] + 0; e = f[6] + 0
  hits++
  secHits[sec]++
  secR[sec] = secR[sec] " " sprintf("%.2f", r)
  # a frame with the same speed and energy as the previous one = module extrapolation
  if (prevHit && v == pv && e == pe) {
    repeats++
  } else {
    meas++
    sr += r; srr += r * r; sv += v; svv += v * v
    if (rmin == "" || r < rmin) rmin = r
    if (rmax == "" || r > rmax) rmax = r
    le = log(e > 0 ? e : 1) / log(10)
    sle += le; slle += le * le
    if (prevMeas != "") {
      d = r - prevMeasR; dt = (t - prevMeasT) / 1000
      if (dt > 0 && dt < 0.25) { nd++; sdd += d * d; if (abs(d) > 0.5) bigJumps++ }
    }
    prevMeas = 1; prevMeasR = r; prevMeasT = t
  }
  prevHit = 1; pv = v; pe = e
}
END {
  printf "frames %d, with target %d (%.0f%%), independent %d, repeated (same v & E as previous) %d\n", frames, hits, frames ? 100 * hits / frames : 0, meas, repeats
  if (meas > 1) {
    mr = sr / meas; mv = sv / meas
    printf "range  mean %.3f  sd %.3f  min %.3f  max %.3f m\n", mr, sqrt(srr / meas - mr * mr), rmin, rmax
    printf "speed  mean %.3f  sd %.3f m/s\n", mv, sqrt(svv / meas - mv * mv)
    ml = sle / meas
    printf "energy log10 mean %.2f  sd %.2f  (median-ish %.0f)\n", ml, sqrt(slle / meas - ml * ml), 10 ^ ml
  }
  if (nd > 0) printf "consecutive range step rms %.3f m over %d steps, jumps > 0.5 m: %d\n", sqrt(sdd / nd), nd, bigJumps
  print "per-second: frames / with target / ranges"
  for (s = 0; s <= maxSec; s++) if (s in secFrames) printf "  %2d  %2d/%2d %s\n", s, secHits[s] + 0, secFrames[s], substr(secR[s], 1, 90)
}
