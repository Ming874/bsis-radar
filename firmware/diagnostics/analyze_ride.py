#!/usr/bin/env python3
"""
分析網頁「數據 → 記錄 CSV」下載的騎乘紀錄（只用標準函式庫）。

    python analyze_ride.py bsis-speed_20261111_093012.csv --angle 30 --height 0.70

報告：
  1. 資料框：頻率、各種判斷的比例
  2. 測速雷達（LD2451）的目標：每框幾個目標、距離與水平角的分布、追蹤中有目標的比例
  3. 速度模型比較（需要輪速感測器）：固定角度、距離幾何各自的最佳校正係數與殘差
  4. 雷達 vs 輪速：速度差、里程差、時間落後
--angle / --height 請填裝置上的 ANGLE、HEIGHT（CFG 那一行）。詳見 docs/ALGORITHM.md §0、§8。
網頁 4.0 起的 CSV 有 angle_deg、snr；3.x（C4001）的 CSV 也讀得進來（沒有角度時當作 0°）。
"""
import argparse
import csv
import math
import statistics
import sys
from collections import Counter
from datetime import datetime

STEADY_ACCEL = 0.4  # m/s²：輪速感測器平均兩圈，加減速時不拿來比


def num(v):
    try:
        return float(v) if v not in ('', None) else None
    except ValueError:
        return None


def iso_seconds(text):
    """time_iso → 秒（Python 3.8～3.10 的 fromisoformat 不認得結尾的 Z）"""
    try:
        return datetime.fromisoformat(text.replace('Z', '+00:00')).timestamp()
    except (AttributeError, ValueError):
        return None


def load(path):
    rows = []
    with open(path, encoding='utf-8-sig', newline='') as f:
        for r in csv.DictReader(f):
            rows.append({
                't': iso_seconds(r.get('time_iso')),
                'uptime': num(r['uptime_s']),
                'frame': int(r['frame'] or 0),
                'online': r['radar_online'] == '1',
                'state': r['state'],
                'v': num(r['speed_mps']),
                'targets': int(r['targets'] or 0),
                'angle': num(r.get('angle_deg')) or 0.0,
                'range': num(r['range_m']),
                'radial': num(r['radial_mps']),
                'snr': num(r.get('snr')),
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
    """輪速在前後 span 筆之間的變化率（m/s²）；有 time_iso 時用實際時間，否則假設每框 0.1 s"""
    a, b = max(0, i - span), min(len(rows) - 1, i + span)
    wa, wb = rows[a]['w'], rows[b]['w']
    if wa is None or wb is None or b == a:
        return None
    ta, tb = rows[a]['t'], rows[b]['t']
    dt = tb - ta if ta is not None and tb is not None and tb > ta else (b - a) * 0.1
    return (wb - wa) / dt


def main():
    try:  # Windows 主控台預設不是 UTF-8，中文會印不出來
        sys.stdout.reconfigure(encoding='utf-8')
    except (AttributeError, ValueError):
        pass
    ap = argparse.ArgumentParser(description='分析 BSIS 測速雷達的 CSV 紀錄')
    ap.add_argument('csv')
    ap.add_argument('--angle', type=float, default=30.0, help='ANGLE（度）')
    ap.add_argument('--height', type=float, default=0.70, help='HEIGHT（m）')
    args = ap.parse_args()

    rows = load(args.csv)
    if len(rows) < 20:
        sys.exit('資料太少（至少要 20 個資料框）')

    # ---------------------------------------------------------------- 1. 資料框
    section('資料框')
    t0, t1 = rows[0]['t'], rows[-1]['t']
    duration = t1 - t0 if t0 is not None and t1 is not None else (rows[-1]['uptime'] or 0) - (rows[0]['uptime'] or 0)
    print(f'筆數 {len(rows)}，時間約 {duration:.0f} s，平均 {len(rows) / max(duration, 1):.1f} Hz')
    counts = Counter(r['verdict'] for r in rows)
    moving = [r for r in rows if r['state'] in ('tracking', 'holding')]
    for verdict, n in counts.most_common():
        print(f'  {verdict:<15} {n:>6}  {pct(n, len(rows)):5.1f}%')
    if moving:
        ok = sum(1 for r in moving if r['verdict'] == 'accepted')
        print(f'追蹤中可用量測比例：{pct(ok, len(moving)):.1f}%（{len(moving)} 筆追蹤中的資料框）')

    # ---------------------------------------------------------------- 2. 測速雷達的目標
    section('測速雷達（LD2451）的目標')
    n_hist = Counter(min(r['targets'], 5) for r in rows)
    print('每框目標數：' + '、'.join(f'{n} 個 {pct(c, len(rows)):.0f}%' for n, c in sorted(n_hist.items())))
    if moving:
        with_target = sum(1 for r in moving if r['targets'] > 0)
        print(f'追蹤中有目標的資料框：{pct(with_target, len(moving)):.1f}%（低代表路面回波不穩定，ALGORITHM.md §0.7）')
        moving_t = [r['t'] for r in moving if r['t'] is not None]
        if len(moving_t) > 10 and moving_t[-1] > moving_t[0]:
            gaps = [b - a for a, b in zip(moving_t, moving_t[1:]) if 0 < b - a < 1.0]
            if gaps:
                print(f'追蹤中的資料框間隔：中位數 {1000 * statistics.median(gaps):.0f} ms（約 {1 / statistics.median(gaps):.1f} Hz）')
    used = [r for r in rows if r['verdict'] == 'accepted' and r['range'] is not None]
    if used:
        d_hist = Counter(int(r['range']) for r in used)
        print('採用的距離：' + '、'.join(f'{d} m {pct(c, len(used)):.0f}%' for d, c in sorted(d_hist.items())))
        angles = [r['angle'] for r in used]
        print(f'採用的水平角：中位數 {statistics.median(angles):+.0f}°，範圍 {min(angles):+.0f}° ～ {max(angles):+.0f}°')
        snrs = [r['snr'] for r in used if r['snr'] is not None]
        if snrs:
            print(f'採用的訊噪比：中位數 {statistics.median(snrs):.0f}')
    radials = [abs(r['radial']) for r in rows if r['targets'] > 0 and r['radial'] is not None]
    if radials:
        top = max(radials)
        print(f'徑向速度最大值 {top:.2f} m/s（≈ {top / math.cos(math.radians(args.angle)) * 3.6:.1f} km/h 地速；LD2451 可量到 120 km/h，不會折疊）')

    # ---------------------------------------------------------------- 3. 模型比較
    has_wheel = any(r['w'] is not None for r in rows)
    section('速度模型比較（以輪速為參考）')
    if not has_wheel:
        print('紀錄裡沒有輪速感測器資料，略過')
    else:
        cos_t = math.cos(math.radians(args.angle))
        pairs = []  # (固定角度, 距離幾何, 輪速)
        for i, r in enumerate(rows):
            if r['verdict'] != 'accepted' or r['w'] is None or r['w'] < 2 or r['radial'] is None:
                continue
            acc = wheel_accel(rows, i)
            if acc is None or abs(acc) > STEADY_ACCEL:
                continue
            # 代表目標的換算（與韌體 groundFactor 相同）：水平角 φ 也要除掉
            cos_az = math.cos(math.radians(r['angle']))
            fixed = abs(r['radial']) / (cos_t * cos_az)
            geom = None
            if r['range'] and r['range'] * cos_az > args.height * 1.004:
                s = args.height / (r['range'] * cos_az)
                geom = abs(r['radial']) / (cos_az * math.sqrt(1 - s * s))
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
