#!/usr/bin/env python3
"""
分析網頁「數據 → 記錄 CSV」下載的騎乘紀錄（只用標準函式庫）。

    python analyze_ride.py bsis-speed_20261021_093012.csv --angle 45 --height 0.70

報告：
  1. 資料框：頻率、各種判斷的比例
  2. C4001 測速上限：徑向速度的最大值、是否有截斷（平頂）或折疊的跡象 → 建議的 VMAX
  3. 速度模型比較（需要輪速感測器）：固定角度、距離幾何各自的最佳校正係數與殘差
  4. 雷達 vs 輪速：速度差、里程差、時間落後
--angle / --height 請填裝置上的 ANGLE、HEIGHT（CFG 那一行）。詳見 docs/ALGORITHM.md §8。
"""
import argparse
import csv
import math
import statistics
import sys
from collections import Counter

STEADY_ACCEL = 0.4  # m/s²：輪速感測器平均兩圈，加減速時不拿來比


def num(v):
    try:
        return float(v) if v != '' else None
    except ValueError:
        return None


def load(path):
    rows = []
    with open(path, encoding='utf-8-sig', newline='') as f:
        for r in csv.DictReader(f):
            rows.append({
                'uptime': num(r['uptime_s']),
                'frame': int(r['frame'] or 0),
                'online': r['radar_online'] == '1',
                'state': r['state'],
                'v': num(r['speed_mps']),
                'targets': int(r['targets'] or 0),
                'range': num(r['range_m']),
                'radial': num(r['radial_mps']),
                'ground': num(r['ground_mps']),
                'verdict': r['verdict'],
                'dr': num(r['radar_distance_m']),
                'w': num(r['wheel_mps']),
                'dw': num(r['wheel_distance_m']),
            })
    return [r for r in rows if r['online']]


def pct(n, total):
    return 100.0 * n / total if total else 0.0


def section(title):
    print(f'\n== {title} ' + '=' * max(0, 60 - len(title)))


def wheel_accel(rows, i, span=10):
    """輪速在前後 span 筆之間的變化率（m/s²），資料框間隔 0.1 s"""
    a, b = max(0, i - span), min(len(rows) - 1, i + span)
    wa, wb = rows[a]['w'], rows[b]['w']
    if wa is None or wb is None or b == a:
        return None
    return (wb - wa) / ((b - a) * 0.1)


def main():
    try:  # Windows 主控台預設不是 UTF-8，中文會印不出來
        sys.stdout.reconfigure(encoding='utf-8')
    except (AttributeError, ValueError):
        pass
    ap = argparse.ArgumentParser(description='分析 BSIS 測速雷達的 CSV 紀錄')
    ap.add_argument('csv')
    ap.add_argument('--angle', type=float, default=45.0, help='ANGLE（度）')
    ap.add_argument('--height', type=float, default=0.70, help='HEIGHT（m）')
    ap.add_argument('--vmax', type=float, default=10.0, help='目前的 VMAX（m/s）')
    args = ap.parse_args()

    rows = load(args.csv)
    if len(rows) < 20:
        sys.exit('資料太少（至少要 2 秒的資料框）')

    # ---------------------------------------------------------------- 1. 資料框
    section('資料框')
    duration = (rows[-1]['uptime'] or 0) - (rows[0]['uptime'] or 0)
    print(f'筆數 {len(rows)}，時間約 {duration:.0f} s，平均 {len(rows) / max(duration, 1):.1f} Hz')
    counts = Counter(r['verdict'] for r in rows)
    moving = [r for r in rows if r['state'] in ('tracking', 'holding')]
    for verdict, n in counts.most_common():
        print(f'  {verdict:<15} {n:>6}  {pct(n, len(rows)):5.1f}%')
    if moving:
        ok = sum(1 for r in moving if r['verdict'] in ('accepted', 'unfolded'))
        print(f'追蹤中可用量測比例：{pct(ok, len(moving)):.1f}%（{len(moving)} 筆追蹤中的資料框）')

    # ---------------------------------------------------------------- 2. 測速上限
    section('C4001 測速上限（VMAX）')
    radials = [abs(r['radial']) for r in rows if r['targets'] > 0 and r['radial'] is not None]
    if radials:
        top = max(radials)
        near_top = sum(1 for x in radials if x >= top - 0.05)
        print(f'徑向速度最大值 {top:.2f} m/s；距最大值 0.05 m/s 內的資料框 {near_top} 筆（{pct(near_top, len(radials)):.1f}%）')
        if pct(near_top, len(radials)) > 3 and top < args.vmax - 0.3:
            print(f'⚠ 讀值在 {top:.2f} m/s 附近堆積：疑似雷達截斷，建議 VMAX 設為 {top:.1f}')
        jumps = 0
        prev = None
        for r in rows:
            if r['targets'] > 0 and r['radial'] is not None:
                if prev is not None and abs(r['radial'] - prev) > 0.8 * top and abs(prev) > 0.6 * top:
                    jumps += 1
                prev = r['radial']
        if jumps:
            print(f'⚠ 有 {jumps} 次徑向速度在上限附近突然反向：疑似折疊（韌體會依預測還原，VMAX 請設為約 {top:.1f}）')
        if not jumps and pct(near_top, len(radials)) <= 3:
            print(f'沒有截斷或折疊的跡象（最高量到 {top:.2f} m/s 徑向 ≈ {top / math.cos(math.radians(args.angle)) * 3.6:.1f} km/h 地速）')

    # ---------------------------------------------------------------- 3. 模型比較
    has_wheel = any(r['w'] is not None for r in rows)
    section('速度模型比較（以輪速為參考）')
    if not has_wheel:
        print('紀錄裡沒有輪速感測器資料，略過')
    else:
        cos_t = math.cos(math.radians(args.angle))
        pairs = []  # (固定角度, 距離幾何, 輪速)
        for i, r in enumerate(rows):
            if r['verdict'] not in ('accepted', 'unfolded') or r['w'] is None or r['w'] < 2 or r['radial'] is None:
                continue
            acc = wheel_accel(rows, i)
            if acc is None or abs(acc) > STEADY_ACCEL:
                continue
            fixed = abs(r['radial']) / cos_t
            geom = None
            if r['range'] and r['range'] > args.height * 1.004:
                geom = abs(r['radial']) / math.sqrt(1 - (args.height / r['range']) ** 2)
            pairs.append((fixed, geom, r['w']))
        print(f'穩定騎乘的可用資料框：{len(pairs)} 筆（輪速 ≥ 2 m/s、加速度 ≤ {STEADY_ACCEL} m/s²）')
        if len(pairs) >= 30:
            for name, idx in (('固定角度', 0), ('距離幾何', 1)):
                pts = [(p[idx], p[2]) for p in pairs if p[idx] is not None]
                if len(pts) < 30:
                    continue
                k = sum(w for _, w in pts) / sum(g for g, _ in pts)  # 距離比（各筆等時間間隔）
                rel = [(k * g - w) / w for g, w in pts]
                print(f'  {name}：建議 CAL = {k:.4f}；單筆殘差 1σ = {100 * statistics.pstdev(rel):.1f}%（{len(pts)} 筆）')
            print('  單筆殘差越小，代表該模型的逐筆散佈越小；兩者差不多時用固定角度（不依賴雷達距離的準確度）')

    # ---------------------------------------------------------------- 4. 雷達 vs 輪速
    section('雷達輸出 vs 輪速')
    if not has_wheel:
        print('沒有輪速感測器資料，略過')
        return
    diffs = []
    for i, r in enumerate(rows):
        if r['state'] != 'tracking' or r['v'] is None or r['w'] is None or r['w'] < 2:
            continue
        acc = wheel_accel(rows, i)
        if acc is not None and abs(acc) <= STEADY_ACCEL:
            diffs.append((r['v'] - r['w']) / r['w'])
    if diffs:
        print(f'速度差（穩定騎乘）：平均 {100 * statistics.mean(diffs):+.2f}%，1σ {100 * statistics.pstdev(diffs):.2f}%（{len(diffs)} 筆）')
    dr = [r['dr'] for r in rows if r['dr'] is not None]
    dw = [r['dw'] for r in rows if r['dw'] is not None]
    if len(dr) > 1 and len(dw) > 1 and dw[-1] - dw[0] > 10:
        ddr, ddw = dr[-1] - dr[0], dw[-1] - dw[0]
        print(f'里程：雷達 {ddr:.1f} m、輪速 {ddw:.1f} m，誤差 {100 * (ddr - ddw) / ddw:+.2f}%')
    # 時間落後：雷達速度與輪速的互相關（±1 s）
    vs = [(r['v'] if r['v'] is not None else 0.0) for r in rows]
    ws = [(r['w'] if r['w'] is not None else 0.0) for r in rows]
    best = None
    for lag in range(-10, 11):
        pairs = [(vs[i + lag], ws[i]) for i in range(max(0, -lag), min(len(rows), len(rows) - lag))]
        if len(pairs) < 50:
            continue
        err = sum((a - b) ** 2 for a, b in pairs) / len(pairs)
        if best is None or err < best[1]:
            best = (lag, err)
    if best:
        print(f'雷達相對輪速的時間差：約 {best[0] * 100:+d} ms（正值 = 雷達比輪速晚；輪速本身約落後半圈）')


if __name__ == '__main__':
    main()
