# 對地測速：原理、文獻、設計與驗證

> **對象**：專題組員、指導老師，以及之後要調整演算法或更換感測器的人。
> **程式碼**：`firmware/SpeedRadar/src/core/GroundSpeedEstimator.*`（估計器）、`SpeedConfig.*`（參數）；單元測試與模擬在 `firmware/tests/host_tests.cpp`。
> **證據等級**：〔實測〕本專案用實機量到的；〔模擬〕本專案的模擬器算的（§9）；〔文獻〕附編號；〔推論〕依資料推得、尚未證實。

## 摘要

1. **原理**：C4001（24 GHz FMCW）裝在後貨架尾端、斜向下照路面。往前騎時路面相對雷達後退，雷達量到的徑向速度 v<sub>r</sub> = v·cos θ（θ 為俯角），所以 **v = CAL · |v<sub>r</sub>| / cos θ**。CAL 是現地校正得到的係數。
2. **最大的風險是 C4001 的測速上限**。規格書寫徑向 0.1～3 m/s，資料框說明卻寫 0～10 m/s [1][2]。兩筆獨立觀察都停在 ≈ 3.2～3.28 m/s〔實測〕[6]，也符合 64 chirp × 0.95 ms 的 FFT 上限〔推論〕。若上限真是 3.28 m/s，45° 時約 16.7 km/h 以上的讀值會**折疊**。韌體的處理：
   - 依連續追蹤還原折疊。
   - 量到更大的值時自動調高上限（§2.3）。
   - 驗收第一項就是實測上限。
3. **精度預期**〔文獻〕[11][19][36]〔模擬〕，前提是原始 C4001 波束 100°×40°、在同一路面校正：
   - 系統偏差約 ±1%。
   - 濾波後的隨機誤差約 ±3～5%。
   - 換到其他乾燥路面再加 ±1～3%。
   - 潮濕或光滑路面偏低 10～30%，或量不到。
   - 商用窄波束對地雷達在現地校正後是 ±1～3%。
4. **估計器**：
   - 逐筆有效性判斷（距離窗口、方向、外插框、靜止回波、上限）。
   - 折疊還原。
   - 等加速度卡爾曼濾波器。量測雜訊由二階差分的中位數自動估計，過程雜訊依正規化創新自動切換。
   - 3σ 閘門剔除離群值。
   - 靜止／擷取／追蹤／保持／中斷的狀態機。
   - 里程用量測值積分，不受濾波落後影響。
5. **校正**：已知距離 3 趟 × 100 m，起點和終點都停住；或用輪速感測器的里程。各趟依距離加權合併。
6. **兩種換算模型**：
   - **固定角度**（預設）：文獻的標準作法。
   - **距離幾何**（實驗性）：每一筆用 sin α = h / r 算自己的俯角，與 Acconeer 對每個距離格做角度修正相同 [40]。模擬顯示它幾乎不受路面材質影響，但對 C4001 的距離偏差很敏感（§5）。
7. **最有效的硬體改進**是收窄波束（透鏡、喇叭或吸波罩）。模型推估：偏差可從 −14% 降到約 −1%，單筆散佈從 ±12% 降到 ±3～4%〔文獻模型〕[19][27][35]。

---

## 1. 問題定義

| 項目 | 內容 |
| --- | --- |
| 量測對象 | 自行車對地速度 0～45 km/h（0～12.5 m/s），與里程 |
| 感測器 | DFRobot C4001（SEN0609）。每 0.1 秒輸出一筆「最強的一個目標」的距離、徑向速度、能量；沒有角度、沒有頻譜 [1] |
| 參考值（選用） | 輪子上的 3144 霍爾開關，每圈一個脈衝。只用來校正與驗證，不參與估計 |
| 輸出 | 對地速度、1σ 不確定度、狀態、里程；10 Hz 經藍牙送到網頁（[PROTOCOL.md](PROTOCOL.md)） |

C4001 是「人體存在偵測」模組，不是對地測速儀。內部的 FFT、CFAR、追蹤都無法修改，只能調整距離窗口（`setRange`）、偵測門檻（`setThrFactor`）、微動偵測（`setMicroMotion`）[1]。所以本設計的重點是：

- 選對安裝幾何。
- 在模組外面把「波束內最強的那一點」的徑向速度，盡可能準確地換算成對地速度。
- 對模組的未知行為（上限、折疊、內部平滑）保持穩健。

## 2. C4001 的特性

### 2.1 規格查證

| 項目 | 規格或資料 | 來源 |
| --- | --- | --- |
| 調變 | FMCW，24 GHz；1 發 1 收〔推論〕 | [1][2] |
| 波束 | 100° × 40°。依天線排列推論：**40° 平面沿 30 mm 邊**（兩組 1×4 貼片的排列方向），100° 平面沿 26 mm 的排針邊。12 m 版每側只有 1 個貼片，波束為 100°×80°，可佐證 | [1][3]〔推論〕 |
| 測距 | 1.2～25 m（規格）；「距離目前未校準」 | [1] |
| 測速 | 規格表「0.1 to 3 m/s」；資料框說明「0–10 m/s」；產品頁「0.1–10 m/s」。互相矛盾 | [1][2][4] |
| 速度正負號 | 遠離為正、接近為負 | [7]〔實測〕 |
| 輸出 | 每 100 ms 一筆 `$DFDMD`；一次一個目標；目標消失時多送 1 筆外插資料框（速度、能量與上一筆完全相同） | 〔實測，2026-10-16〕 |
| 距離窗口 | `setRange a b`：規格要求 a ≥ 0.6、a < b ≤ 25；最遠距離外有「1 m 過渡區」，不是硬性閘門 | [1] |
| 本專案的距離設定 | 雷達讀回 `getRange：0.620 2.400`（俯角 45°、高度 0.70 m 時韌體寫入的窗口） | 〔實測，2026-10-21〕 |
| 偵測門檻 | `setThrFactor`，原廠 5；UART 送的數字就是門檻本身 | [1]〔實測〕 |
| 能量 | 約與距離的 5 次方成反比（0.4～1.7 m，n = 1075） | 〔實測〕 |

### 2.2 測速上限：證據

| 證據 | 內容 |
| --- | --- |
| 規格書 | 「a speed measurement range of 0.1 to 3 meters per second」[1] |
| 本專案 2026-10-16 | 門檻 30 時偵測到的全是風扇雜訊，速度都在 ±3.2 m/s 以內〔實測〕。扇葉線速度遠大於 3 m/s，若上限是 10 m/s 應該看得到更大的值 |
| DFRobot 論壇 | 雷達裝進 ABS 殼後的雜訊紀錄：`speed=-3.280 m/s` [6] |
| FMCW 理論 | v<sub>max</sub> = λ/(4T<sub>c</sub>)、v<sub>res</sub> = λ/(2N·T<sub>c</sub>) [8]。N = 64、T<sub>c</sub> ≈ 0.95 ms（64 × 0.95 ≈ 61 ms，放得進 100 ms 一框）時 v<sub>max</sub> ≈ 3.28 m/s、v<sub>res</sub> ≈ 0.10 m/s，正好對上「0.1 to 3 m/s」。−3.280 可能就是 FFT 的 −N/2 格〔推論〕 |

FFT 都卜勒超過 v<sub>max</sub> 時通常會**混疊（折疊）**，不會停住。例如上限 3.28 時，真實徑向 3.6 m/s 會報成 −2.96 m/s。但 C4001 內部可能還有追蹤器，實際行為（折疊、截斷或直接不回報）必須實測。

**對不同俯角的影響**（徑向 v<sub>r</sub> = v·cos θ）：

| 俯角 θ | cos θ | 上限 3.28 時不折疊的最高對地速度 | 上限 10 時 | 每 1° 角度誤差 |
| --- | --- | --- | --- | --- |
| 30° | 0.866 | 13.6 km/h | 41.6 km/h | 1.0% |
| 40° | 0.766 | 15.4 km/h | 47.0 km/h | 1.5% |
| **45°** | 0.707 | **16.7 km/h** | 50.9 km/h | 1.75% |
| 60° | 0.500 | 23.6 km/h | 72 km/h | 3.0% |
| 76° | 0.242 | 48.8 km/h | 149 km/h | 7.0% |

靠加大俯角來避開折疊行不通：要涵蓋 45 km/h 必須 ≥ 75°。這時 40° 波束的邊緣已越過正下方，角度誤差也放大到每度 7%。所以本設計保持 45°，改由韌體還原折疊。

### 2.3 韌體的對策

1. **`VMAX` 預設 3.28 m/s**（執行期參數，2～20）。
2. **折疊還原**（§6.2）：
   - 追蹤中依預測速度，從 {v<sub>r</sub>, v<sub>r</sub> + 2V, v<sub>r</sub> + 4V} 中挑出最接近預測的解釋。
   - 剛失去訊號時，改用中斷前的速度當預測，10 秒內有效。
   - 這樣即使超過 16.7 km/h，只要回波連續，就能持續量測〔模擬：§9〕。
3. **自動調高上限**：
   - 只要量到 |v<sub>r</sub>| > VMAX + 0.3 m/s，就證明雷達的上限其實更高（會折疊的雷達不可能回報超過上限的值）。
   - 這時韌體把 VMAX 調為 10（量到更大就再往上），存進 NVS，並通知網頁。
   - 所以預設值錯了也只會在第一次越過 16.7 km/h 時影響約 1 秒。
4. **截斷偵測**：
   - 原始值落在 VMAX ± 0.05 m/s 的資料框不採用。
   - 失去回波前若大多是這種資料框，狀態會變成「超出測速上限」，而不是一般的「訊號中斷」。

**限制**：
- 折疊時，負的讀值與迎面而來的物體無法分辨。
- 訊號中斷超過 10 秒、而且當時已在高速，就無法判斷要還原幾次，要等速度降到不折疊的範圍才接得回來。
- 輪速感測器可以提供這時的參考，這是融合的理由之一（§11）。

## 3. 量測原理與誤差來源

### 3.1 都卜勒與換算

```text
f_d = 2·v·cos ψ / λ        λ = c / 24.125 GHz = 12.43 mm   →   1 m/s 徑向 ≈ 161 Hz
v   = v_r / cos ψ           ψ：雷達到散射點的視線相對水平的俯角
```

### 3.2 為什麼頻譜不是一條線，以及偏差從哪裡來

波束照亮的是一整片路面。片上每一點 (ψ, φ) 的都卜勒是 (2v/λ)·cos ψ·cos φ，所以回波是一段頻譜。

- **頻譜寬度**：Δf/f ≈ θ<sub>BW</sub>·tan ψ [19]。C4001 的 40° 波束在 45° 時，相對頻寬約 20～24%。
- **頻譜加權**：頻譜形狀由三項相乘決定：雙程天線增益、後向散射係數 σ0（隨入射角變）、幾何因子 dA/R⁴ [11][29]。
  - 越靠近正下方，σ0 越大、距離越近，權重越大。
  - 所以「最強的那一點」通常比視軸更陡，都卜勒偏低，讀值系統性偏低。
  - 本專案稱這為**波束加權偏差**，DVL 文獻稱為 terrain bias [12]。
- **偏差隨路面改變**：Buchele 推導的校正誤差 δ ≈ (α²/3)·cot θ<sub>0</sub>·(1/σ0)(dσ0/dθ) [11]。可見偏差正比於「波束寬的平方 × σ0 隨角度的斜率」，而 σ0 的斜率因路面而異。

| 波束（俯仰 × 方位） | 相對頻寬 | 峰值偏差：粗糙 / 乾柏油 / 平滑 | 單筆散佈 |
| --- | --- | --- | --- |
| 40°×100°（C4001，正確方向） | 20～24% | −14% / −14% / −27% | ±12～14% |
| 100°×40°（模組轉了 90°） | 30～32% | −32% / −94% / −53% | — |
| 12°×20°（加透鏡或喇叭） | 6% | −0.5% / −0.5% / −5% | ±3～4% |

〔文獻模型〕高斯波束，俯角 45°、高度 0.6 m；乾柏油的 σ0 取自 24 GHz 實測 [23]。數字只代表量級與趨勢。

**結論**：
- 波束的窄軸必須放在含行進方向的鉛直面上。俯仰方向的展寬是一階效應，方位方向是二階。
- 原始 C4001 的偏差可以用 CAL 校正，但只對校正時的路面有效。

### 3.3 安裝角、俯仰、上下震動

```text
單波束：v̂ = [v·cos(ψ+p) + w·sin(ψ+p)] / cos ψ ≈ v·(1 − p·tan ψ) + w·tan ψ
        p：俯仰（機頭下俯為正）、w：雷達向下的速度
```

| 誤差源 | 影響 | 處理 |
| --- | --- | --- |
| 安裝角量錯 1° | 45° 時 1.75%（tan 45° × 1°）[28] | 校正係數吸收 |
| 靜態俯仰（騎士體重、胎壓） | 同上，0.5° ≈ 0.9% | 以騎乘狀態校正 |
| 動態俯仰（零均值） | 平均後只剩二階的 1 − cos σ<sub>p</sub>：σ<sub>p</sub> = 1° 時 0.015% | 濾波 |
| 上下震動 w | 瞬時 w·tan ψ，零均值 | 濾波 |
| 過彎側傾 | 繞行進軸旋轉，不改變 cos ψ，只讓回波變弱 | 無 |
| 方位沒對準 γ | cos γ，二階：5° 時 −0.38% | 校正係數吸收 |

只有用兩顆雷達前後對照（Janus），才能把俯仰與上下震動一階抵消：2° 俯仰時單波束誤差 −3.55%，Janus 只有 −0.06% [19][28]。自行車的俯仰多半是零均值，這項的優先度低於收窄波束（§11）。

### 3.4 路面與 24 GHz

- **粗糙度**：Rayleigh 判據 h<sub>rms</sub> < λ/(8 cos θ<sub>i</sub>)，45° 時為 2.2 mm [24]。
  - 柏油的兩尺度粗糙度約 0.65 mm 與 0.20 mm [23]，在 24 GHz 屬於「微粗糙」。
  - 斜向的後向散射弱，而且隨角度變化。
- **σ0**（乾柏油，vv 極化）：入射 0° 時 +3 dB、20° 時 −15 dB、40～45° 時 −18 dB、60° 時 −22 dB、70° 時 −26 dB [23]。
- **潮濕路面**：水膜超過約 1 mm 就近似鏡面，斜向回波大幅減弱 [23][33]。結果可能是斷訊、改抓近天底的強回波（大幅偏低），或抓到其他物體。四波束研究在積水路面的誤差達 29%，平靜水面完全失效 [19]。

### 3.5 波束內的其他物體

C4001 每一筆只回報最強的一個目標。100° 的方位波束很寬，車輪、擋泥板、騎士腳跟、甩起的水花一旦比路面強，就會取代路面。農機雷達的安裝手冊也指出：輪胎或管線進入錐形視野會讀錯，振動會讓靜止時出現讀數 [37]。對策：
- 雷達裝在後輪後方。
- 把距離窗口寫進雷達。
- 軟體再過濾一次距離、方向與離群值（§6.1）。

## 4. 安裝設計

| 項目 | 建議 | 理由 |
| --- | --- | --- |
| 位置 | 後貨架尾端（或座管延伸架），雷達在後輪**後方**，朝後下方 | 後輪、鏈條不在波束內；朝後是農機雷達的建議安裝方式 [37] |
| 模組方向 | **排針那條 26 mm 邊保持水平、與後輪軸平行**；以這條邊為軸把板面往後下方傾 | 40° 窄軸落在含行進方向的鉛直面（§3.2）〔推論，可用 GETTING_STARTED §3 的方法驗證〕 |
| 俯角 θ | 40～45°（預設 45°） | 角度誤差的影響與 σ0 的折衷。業界：農機 35° [37]、TI 示範 45° [39]、Acconeer 建議自鉛直 35～45° [40] |
| 高度 h | 0.6～0.8 m（預設 0.70 m） | 地面窗口的近端要 ≥ C4001 最近距離 0.6 m；視軸斜距 h / sin θ = 0.99 m |
| 前方淨空 | 波束內不要有金屬、擋泥板、反光片；正面不要加厚外殼 | 有人把雷達裝進 ABS 殼後雜訊大增 [6] |
| 地面距離窗口 | 俯角 θ − 25° 到 θ + 30°，兩端各留 0.1 m；寫進雷達的最遠距離不小於 2.4 m | 預設值算出 0.62～2.15 m。雷達一次只回報一個目標，窗口外的強反射（後方來車）不能蓋掉路面 |

## 5. 換算模型

### 5.1 固定角度（`MODEL 0`，預設）

```text
g = CAL · |v_r| / cos θ
```

- 波束加權偏差、安裝角誤差、方位誤差，全部由 CAL 一次吸收。
- 不依賴 C4001 未校準的距離。
- 缺點：CAL 只對校正時的路面有效（§3.2）。

### 5.2 距離幾何（`MODEL 1`，實驗性）

```text
sin α = h / r        g = CAL · |v_r| / √(1 − (h/r)²)
```

**依據**：FMCW 有距離解析能力。距離–都卜勒圖上，路面回波是一條曲線 v<sub>r</sub>(r) = v·√(1 − h²/r²)：每個距離對應一個俯角。若 C4001 回報的 (r, v<sub>r</sub>) 落在這條曲線上，逐筆用自己的俯角換算，就不受「哪個俯角最強」的影響，也就不受路面材質影響。Acconeer 的 Surface Velocity 範例對每個距離格做 `arcsin(h / r)` 角度修正，原理相同 [40]。

**風險**：
- **距離偏差**：C4001 的距離未校準 [1]，若頻寬 250 MHz，距離解析度約 0.6 m [8]。敏感度 ∂ln v/∂r = −h² / (r(r² − h²))，45° 時等於 −1/r：
  - 3 cm 的距離偏差會造成約 3% 的速度誤差。
  - 〔模擬〕距離偏差 +3 cm 時，平均誤差 −4.9%（§9.2）。
- **側傾**：過彎時斜距變長，但都卜勒不變，會偏低。
- **近天底雜訊放大**：越接近正下方，雜訊放大越多（α → 90° 時發散）。韌體在 85° 截止。

驗收時以輪速為參考，用 `analyze_ride.py` 比較兩種模型的最佳 CAL 與逐筆殘差，再決定採用哪一種（§8.2）。

## 6. 估計器

### 6.1 逐筆判斷（`FV`）

依序檢查以下條件，第一個成立的就是這一筆的判斷：

| 檢查 | 結果 |
| --- | --- |
| 沒有目標 | NoTarget |
| 速度、能量都與上一筆相同（C4001 的外插資料框） | Repeated |
| 距離不在地面窗口內，或比雷達高度還近 | OutOfGate |
| 還原折疊後徑向速度 < 0.12 m/s | Static |
| 還原折疊後方向與 `DIR` 相反 | WrongDirection |
| 原始值落在 VMAX ± 0.05 m/s | AtLimit |
| 其餘 | Accepted 或 Unfolded；之後在濾波器閘門外才改判 Outlier |

`|v_r|` 明顯超過 VMAX 時，另外標記「雷達上限比設定高」（§2.3）。

### 6.2 折疊還原

```text
預測徑向速度 p = v̂ / (CAL · 換算倍率)
若 p > VMAX / 2：在 {v_r, v_r + 2·VMAX, v_r + 4·VMAX} 中取 |候選 − p| 最小者
```

這與 TI gtrack 以預測徑向速度展開都卜勒的作法相同 [47]。

- **為什麼候選只往上加**：自行車不會倒退。
- **預測從哪裡來**：
  - 追蹤中：濾波器的預測。
  - 剛中斷：中斷前的速度。
- **什麼時候會挑錯**：預測誤差超過 VMAX（約 4.6 m/s 對地速度）才會。正常騎乘每 0.1 秒的速度變化只有 0.1～0.4 m/s，單筆散佈約 ±1 m/s，所以不會發生。

### 6.3 卡爾曼濾波器

**模型**：等加速度，狀態 x = [v, a]ᵀ，量測是對地速度 g [41]。

```text
F = [1 Δt; 0 1]        Q = q·[Δt³/3  Δt²/2; Δt²/2  Δt]（連續白雜訊加加速度）
H = [1 0]              S = P₀₀ + R，K = P Hᵀ / S
```

- **為什麼用等加速度模型**：只估計速度的模型在急煞時會落後。〔模擬〕−4 m/s² 煞車時落後達 1.2 m/s，停車時估計值還在 1.4 m/s，被誤判為「訊號中斷」。改成等加速度後，等加速度段沒有穩態落後。
- **過程雜訊 q 依機動自動切換**：
  - 巡航時 q = 0.15 m²/s⁵，輸出平順。
  - 正規化創新平方 ε = ν² / S 的指數平均超過 3 時（純雜訊時期望值 = 1），切換成 q = 6，跟得上加減速。
  - 這是 Bar-Shalom 的 adjustable level process noise [41]。
  - 參數由 12 組情境的網格搜尋選出〔模擬〕。
- **量測雜訊 R 自動估計**：
  - 用相鄰三筆量測的二階差分 d = g<sub>k</sub> − 2g<sub>k−1</sub> + g<sub>k−2</sub>。獨立雜訊時 Var(d) = 6σ²，等加速度的變化會被完全抵消。
  - σ 取 1.4826 × 中位數(|d|) / √6 [49][50]，最近 16 筆。
  - 夾在初值的 1/4～9 倍之間。初值 σ² = (0.10·CAL/cos θ)² + (0.08·v)²。
  - 不用創新序列估計 R：機動時，濾波落後會被當成雜訊，R 變大 → 增益變小 → 更落後，形成正回饋〔模擬實際觀察到〕。
  - 追蹤中**所有**地面量測（包括閘門外的）都拿來估計。只用閘門內的會低估雜訊，閘門越縮越窄。
- **閘門**：|ν| ≤ 3·√(P₀₀ + R) + 0.3 m/s。
  - 閘門外的量測是離群值。
  - 連續 3 筆離群值彼此一致（全距 ≤ max(0.6 m/s, 中位數的 25%)），代表速度真的變了（例如保持期間急煞），以它們的中位數重新初始化。
- **物理限制**：加速度夾在 −8～+4 m/s²；速度不為負。自然騎乘的煞車峰值約 −1.6 m/s² [44]。

### 6.4 狀態機（`ST`）

| 狀態 | 進入條件 | 輸出 |
| --- | --- | --- |
| 靜止 | 開機或雷達剛上線（最可能是停著）；慢速時連續 2 筆靜止回波；保持中外推速度 < 1.2 m/s 達 0.6 秒 | 0 |
| 擷取 | 靜止或中斷時出現 ≥ 0.3 m/s 的地面量測；0.6 秒內湊到 3 筆一致才進入追蹤 | 0 |
| 追蹤 | 擷取成功、保持中回波回來、離群值重新初始化 | 估計值 |
| 保持 | 追蹤中 0.3 秒沒有可用量測；最後一筆之後 0.5 秒內沿用加速度外推，之後速度固定 | 估計值 |
| 訊號中斷 | 保持超過 2 秒 | 未知 |
| 超出上限 | 同上，但最近 20 筆中 ≥ 5 筆是 AtLimit | 未知 |

高速追蹤時看到的靜止回波會被忽略。那是跟著車子走的東西（擋泥板、車架），不代表停車。

### 6.5 里程

- **各區段的積分方式**：
  - 兩筆量測之間：以傳播後的狀態做梯形積分。
  - 每筆採用的量測：加上「創新 × 資料框間隔」，這一段就等於用量測值積分。
  - 濾波器在急煞時的落後因此不會進到里程〔模擬：−4 m/s² 煞車的里程誤差從 +2.0% 降到 −0.5%〕。
- **擷取期間**：確認之後，以 3 筆的中位數補回這段的距離。
- **保持期間**：距離先記在待定帳。之後的結果決定算多少：
  - 回波回來：全部算。
  - 停下：算一半，假設等減速。
  - 中斷：全部算。

### 6.6 參數

| 參數 | 值 | 依據 |
| --- | --- | --- |
| 地面窗口 | θ −25°～+30°，±0.1 m | 涵蓋 40° 波束與距離雜訊；排除遠處物體 |
| 靜止門檻 | 徑向 0.12 m/s | C4001 最低可測 0.1 m/s [1] |
| 擷取 | 0.6 秒內 3 筆一致 | 一兩筆雜散目標不會讓車速跳起來 |
| 保持 → 中斷 | 0.3 秒 → 2 秒 | 短暫失去回波時保持輸出 |
| 停車判定 | 外推速度 < 1.2 m/s，0.6 秒 | 慢速時失去回波 = 正在停 |
| q（巡航／機動） | 0.15 ／ 6 m²/s⁵，NIS 門檻 3 | 網格搜尋〔模擬〕 |
| 閘門 | 3σ + 0.3 m/s | 常態分布約 99.7% |
| 折疊上限 VMAX | 3.28 m/s（自動調高） | §2.2 |

## 7. 校正

### 7.1 已知距離

**程序**（Raven 與 DICKEY-john 的現地校正同理 [36][38]）：
- 量一段平直路面（建議 100 m）。
- 起點停住、按開始；騎到終點停住、按結束。兩端都停住，按鈕時機就不影響結果。
- 輸入實際距離。每一趟的新係數為：

```text
CAL新 = CAL舊 × 真實距離 / 雷達距離
```

**多趟合併**：每趟換算成 CAL = 1 時的雷達距離後加總，等同依距離加權。不同趟用了不同 CAL 也能合併：

```text
CAL = Σ 真實距離 / Σ (雷達距離 / 當時的 CAL)
```

**不確定度**〔模型〕：

```text
σ_K/K ≈ √[(σ_D/D)² + (√2·σ_end/D)² + (σ_frame/√N)²]
```

400 m、端點 ±0.5 m、單筆散佈 12%、約 500 筆時約 0.6%，3 趟約 0.35%。〔模擬〕3 趟 × 100 m 校正後，同一路面的殘差約 +0.8～1.0%（§9.2）。

### 7.2 輪速感測器

- 以同一段時間的輪速里程當參考，建議 300 m 以上。
- 輪周長先用滾動法量（人坐上車滾一圈），精度約 0.5%。輪速在鋪面上幾乎不滑 [20]，所以是很好的參考；但它的誤差（胎壓、負載 ±1%）會直接進到 CAL。

### 7.3 什麼時候要重新校正

- 改了安裝角或高度。
- 換了速度模型。
- 主要路面改變（例如從柏油改到水泥）。
- 換胎或騎士差很多。
- 濕地不拿來校正 [19][23]。

## 8. 驗證方法

### 8.1 即時比對（網頁「校正 → 精度驗證」）

| 指標 | 計算 | 說明 |
| --- | --- | --- |
| 里程誤差 | (ΔDR − ΔDW) / ΔDW | 不受時間落後影響，是主要指標；至少比對 10 m 才顯示 |
| 速度差平均、RMS | 雷達 − 輪速 | 只在輪速 ≥ 2 m/s、雷達追蹤中時取樣；含雜訊與落後 |

速度頁的「雷達 − 輪速」只在加速度 ≤ 0.4 m/s² 時顯示，因為輪速感測器平均兩圈、本身就落後。

### 8.2 離線分析（`firmware/diagnostics/analyze_ride.py`）

讀網頁下載的 CSV（每一筆資料框一列），報告：
- 資料框頻率與各判斷的比例。
- 徑向速度的最大值；有沒有平頂（截斷）或在上限附近突然反向（折疊）。據此建議 VMAX。
- 兩種模型各自的最佳 CAL 與逐筆殘差（只用穩定騎乘的資料框）。
- 雷達與輪速的速度差、里程差、時間差。

〔模擬〕已知答案的合成資料中，它還原出的固定角度 CAL 與理論值相差 0.4%。

### 8.3 驗收

步驟與合格標準見 [GETTING_STARTED.md](GETTING_STARTED.md) §10。

## 9. 模擬結果

### 9.1 模擬器

模擬器在 `host_tests.cpp` 的 `GroundRadarSim`。每一筆資料框模擬 C4001 回報波束內最強的一個路面散射點：
- 散射點俯角 = 視軸 + 加權偏移 + 常態分散（σ = 7°，對應單筆 ±12% [19]）。
- 距離 r = h / sin α + 雜訊 3 cm；徑向速度 = v·cos α + 上下震動 0.1 m/s + 雷達雜訊 0.1 m/s。
- 90% 的資料框有回波，並包含 C4001 的外插資料框。
- 可選：雜散目標、折疊。

模擬不能取代實測。真實的 C4001 可能有內部平滑，各筆不一定獨立，偏移量也要實測。已公開的寬波束便宜模組朝地測速實驗，結果並不理想：讀值偏低、對俯仰敏感 [51]。這也是本設計把驗收放在第一位的原因。

### 9.2 結果

**各情境**（20 次平均；不折疊的雷達，CAL = 1、偏移 0）：

| 情境 | 速度 RMS（m/s） | 平均誤差 | 里程誤差 | 有速度的時間 |
| --- | --- | --- | --- | --- |
| 起步後 6 m/s 巡航 | 0.31 | −0.4% | −0.6% | 100% |
| 加速 2 m/s² 到 8 m/s、急煞 −4 m/s² | 0.57 | +3.9%（煞車落後） | −0.1% | 100% |
| 城市騎乘（變速、停等、再起步） | 0.30 | +0.4% | −0.3% | 100% |
| 15% 雜散目標 | 0.34 | −0.4% | −0.5% | 100% |
| 只有 50% 的資料框有回波 | 0.38 | −0.5% | −0.5% | 100% |
| 折疊的雷達（上限 3.28 m/s）城市騎乘 | 0.30 | +0.4% | −0.1% | 100% |

**路面與模型**：在乾柏油上以 3 趟 100 m 校正後，換到其他路面。

| 路面（等效偏移） | 固定角度：平均誤差 | 固定角度：里程誤差 | 距離幾何：平均誤差 | 距離幾何：里程誤差 |
| --- | --- | --- | --- | --- |
| 乾柏油 +7.5°（校正用） | +1.0% | +0.8% | +0.8% | +0.8% |
| 粗糙漫射面 +6.5° | +3.3% | +3.1% | +0.8% | +0.8% |
| 平滑／潮濕 +14° | −14.4% | −14.8% | +1.3% | +1.2% |
| 乾柏油、雷達距離偏差 +3 cm | — | — | −4.9% | −5.0% |

等效偏移取自 §3.2 的文獻模型：漫射路面峰值偏差約 −14%，平滑或潮濕約 −27%。重跑方式：`.\arduino.ps1 test`，報表印在最後。

## 10. 誤差預算

在同一路面校正後，原始 C4001 波束：

| 誤差源 | 大小 | 性質 |
| --- | --- | --- |
| 波束加權偏差 | 已校正；換到其他乾燥路面 ±1～3%，潮濕或光滑 −10～−30% | 系統性，依路面 |
| 單筆散佈 | ±12～20%；濾波後約 ±3～5% | 隨機 |
| 靜態俯仰、安裝角 | 已校正；騎士姿勢改變 0.5° ≈ 0.9% | 系統性 |
| 動態俯仰、上下震動 | 零均值，二階殘差 < 0.1% | 隨機 |
| 校正本身 | 3 趟 × 100 m 約 0.5～1% | 系統性 |
| 時間落後 | 濾波約 0.2～0.5 秒；C4001 內部平滑未知 | 動態 |
| 參考值（輪速） | 輪周長 ±0.5～1% | 驗證時的參考誤差 |

## 11. 改進路線（依效益排序）

1. **收窄波束**：在模組前加介電透鏡或喇叭，或用吸波罩擋掉波束邊緣。
   - 仰角收到 10～15°、方位收到 20～30° 時，偏差約從 −14% 降到 −1%，單筆散佈從 ±12% 降到 ±3～4%，路面依存性也大幅降低〔文獻模型〕。
   - 仰角 12° 需要約 53～72 mm 的口徑（θ<sub>3dB</sub> ≈ kλ/D）[52]。
2. **輪速融合**：狀態 [s, v, a, k<sub>r</sub>]。
   - k<sub>r</sub> 只在穩態時更新。
   - 雷達與輪速不一致時降低權重，不直接丟棄 [45]。
   - 輪速負責精度，雷達負責脈衝之間的空檔、打滑偵測與折疊歧義。
3. **IMU**（加速度計）：提供濾波器的預測，偵測俯仰。
4. **Janus**：前後各一顆 C4001，一階抵消俯仰與上下震動 [19][28]。同頻雷達可能互相干擾 [48]。
5. **換感測器**：
   - 能讀頻譜的模組，例如 RFbeam K-LD2（可讀 FFT 頻譜）、OmniPreSense OPS243（I/Q 與 FFT）。
   - 有官方對地測速範例的平台，例如 TI IWRL6432 True Ground Speed [39]、Acconeer A121 Surface Velocity [40]。
   - 能拿到頻譜，就能用質心法或模板相關法 [19]，散佈可再降 3～7 倍。

## 參考文獻

**C4001 與感測器**

1. DFRobot, *SEN0609 C4001 mmWave Sensor (25 m) Datasheet / Communication Protocol V1*. https://dfimg.dfrobot.com/wiki/20522/SEN0609_gravity-c4001-24ghz-mmwave-human-presence-detection-sensor_datasheet_V1.pdf
2. DFRobot, *C4001 UART 通訊協議（中文）*. https://img.dfrobot.com.cn/wiki/5ea64bf6cf1d8c7738ad2881/1c14e9b213b80f07159a617ca4659d93.pdf
3. DFRobot, *SEN0609 dimension drawing*；官方商品照片. https://dfimg.dfrobot.com/wiki/20522/SEN0609_gravity-c4001-24ghz-mmwave-human-presence-detection-sensor_dimension_V1.pdf
4. DFRobot, SEN0609 產品頁. https://www.dfrobot.com/product-2793.html
5. DFRobot, *DFRobot_C4001* Arduino library. https://github.com/DFRobot/DFRobot_C4001
6. DFRobot Forum, topic 399587（`speed=-3.280 m/s`）. https://www.dfrobot.com/forum/topic/399587
7. Electronic Clinic, "C4001 mmWave Human Detection Sensor with Arduino and ESP32"（速度正負號）. https://www.electroniclinic.com/c4001-mmwave-human-detection-sensor-with-arduino-and-esp32/
8. C. Iovescu, S. Rao, "The fundamentals of millimeter wave radar sensors," TI SPYY005A, 2020. https://www.ti.com/lit/pdf/spyy005

**都卜勒對地測速**

9. F. B. Berger, "The Nature of Doppler Velocity Measurement," *IRE Trans. ANE*, 4(3):103–112, 1957. doi:10.1109/TANE3.1957.4201534
10. W. R. Fried, "Principles and Performance Analysis of Doppler Navigation Systems," *IRE Trans. ANE*, 4(4):176–196, 1957. doi:10.1109/TANE3.1957.4201552
11. D. R. Buchele, "Analysis of the Effects of Sea State on Doppler-Radar Measurement of Aircraft Ground Speed," NASA TM X-52792, 1970. https://ntrs.nasa.gov/citations/19700020203
12. NGA, *The American Practical Navigator* (Bowditch), Pub. 9, Ch. 25 "Doppler Sonar Navigation," 2017.
13. W. Kleinhempel, D. Bergmann, W. Stammler, "Speed measure of vehicles with on-board Doppler radar," *Radar 92* (IEE), 1992.
14. W. Kleinhempel, W. Stammler, D. Bergmann, "Radar signal processing for vehicle speed measurements," *EUSIPCO-92*, pp. 1825–1828. doi:10.1016/B978-0-444-89587-5.50159-6
15. J. Kehrbeck, E. Heidrich, W. Wiesbeck, "Microwave Front End for True Ground Speed Measurements," *J. Navigation*, 48(1):88–96, 1995. doi:10.1017/S0373463300012522
16. T. M. Hyltin et al., "Vehicular Radar Speedometer," SAE 730125, 1973. doi:10.4271/730125
17. N. A. Richardson et al., "True Ground Speed Measurement Techniques," SAE 821058, 1982. doi:10.4271/821058
18. W. Tsuha, A. McConnell, P. Witt, "Radar True Ground Speed Sensor for Agricultural and Off Road Equipment," SAE 821059, 1982. doi:10.4271/821059
19. K. K. M. Shariff, E. Hoare, L. Daniel, M. Antoniou, M. Cherniakov, "Comparison of Adaptive Spectral Estimation for Vehicle Speed Measurement with Radar Sensors," *Sensors*, 17(4):751, 2017. doi:10.3390/s17040751
20. F. D. Tompkins et al., "Comparison of Tractor Ground Speed Measurement Techniques," *Trans. ASAE*, 31(2):369–374, 1988. doi:10.13031/2013.30716
21. R. Vishwanathan et al., "Evaluation of Ground Speed Sensing Devices under Varying Ground Surface Conditions," ASAE Paper 051087, 2005. doi:10.13031/2013.19773
22. L. Du et al., "Speed Calibration and Traceability for Train-Borne 24 GHz Continuous-Wave Doppler Radar Sensor," *Sensors*, 20(4):1230, 2020. doi:10.3390/s20041230
23. V. V. Viikari, T. Varpula, M. Kantanen, "Road-Condition Recognition Using 24-GHz Automotive Radar," *IEEE Trans. ITS*, 10(4):639–648, 2009. doi:10.1109/TITS.2009.2026307
24. F. T. Ulaby, D. G. Long, *Microwave Radar and Radiometric Remote Sensing*, Univ. Michigan Press, 2014. doi:10.3998/0472119356
25. T. Nagasaku et al., "77GHz Low-Cost Single-Chip Radar Sensor for Automotive Ground Speed Detection," IEEE CSICS, 2008. doi:10.1109/CSICS.2008.25
26. University of Birmingham MISL, "Speed Over Ground Accuracy and testing results"（海報）. https://www.birmingham.ac.uk/documents/college-eps/eece/research/misl/201-sogaccuracy-and-testing-results-new.pdf

**專利**

27. J. H. Bryant, S. M. Schultz, "True ground speed sensor," US 4,517,566 A, 1985.
28. Plessey, Janus Doppler ground-speed radar, US 4,635,059 A.
29. R. W. Vopat (Lockheed Martin), "Terrain bias compensator for Doppler navigation systems," US 5,923,281 A, 1999.
30. J. J. Phelan et al. (Deere), "Ground velocity sensor with drop-out detection," US 4,728,954 A, 1988.
31. S. Ikeda, H. Naganawa (Toyota), "Doppler-effect vehicle ground speed detecting apparatus having means for sensing abnormality," US 5,371,718 A, 1994.
32. M. Yoneyama et al. (Toyota), "Doppler-effect vehicle speed sensor using different speed determining rules depending upon receiver output," US 5,428,359 A, 1995.
33. RCA, US 4,050,071 A（潮濕路面的後向散射）.
34. P. A. K. Anburaj Jayakumar et al. (Honeywell), "Multi-beam radar based ground speed sensor utilizing a single radar integrated circuit," US 12,663,534 B2, 2026.
35. H. Nagaishi, T. Matsumura (Hitachi), "Millimeter-wave dielectric lens antenna and speed sensor using same," US 9,766,330 B2, 2017.

**廠商資料與範例**

36. DICKEY-john, *Radar II and III Ground Speed Sensors*, spec sheet 5002001 Rev C, 2020.
37. DICKEY-john, *DJRVS III Radar Velocity Sensor Installation Instructions*（35°、朝後安裝、視野淨空、現地校正後 1–3%）.
38. Raven Industries, *DCS 400 Installation and Service Manual*（距離校正程序）, 2000.
39. Texas Instruments, *True Ground Speed User Guide*（Radar Toolbox，IWRL6432／IWR6843，45° 朝地、RANSAC）.
40. Acconeer, *Surface Velocity*（A121，逐距離格角度修正 `arcsin(h / r)`）. https://docs.acconeer.com/en/latest/example_apps/a121/surface_velocity.html

**估計理論**

41. Y. Bar-Shalom, X. R. Li, T. Kirubarajan, *Estimation with Applications to Tracking and Navigation*, Wiley, 2001. doi:10.1002/0471221279
42. R. A. Singer, "Estimating Optimal Tracking Filter Performance for Manned Maneuvering Targets," *IEEE TAES*, 6(4):473–483, 1970. doi:10.1109/TAES.1970.310128
43. R. K. Pearson et al., "Generalized Hampel Filters," *EURASIP J. Adv. Signal Process.*, 2016:87. doi:10.1186/s13634-016-0383-6
44. P. Huertas-Leyva, M. Dozza, N. Baldanzini, "E-bikers' braking behavior: Results from a naturalistic cycling study," *Traffic Injury Prevention*, 20(sup3):62–67, 2019. doi:10.1080/15389588.2019.1643015
45. A. W. Palmer, N. Nourani-Vatani, "Robust Odometry using Sensor Consensus Analysis," IEEE/RSJ IROS, 2018. doi:10.1109/IROS.2018.8594473
46. A. Mirabadi, F. Schmid, N. Mort, "Multisensor Integration Methods in the Development of a Fault-Tolerant Train Navigation System," *J. Navigation*, 56(3):385–398, 2003. doi:10.1017/S0373463303002364
47. Texas Instruments, mmWave SDK `gtrack`（`gtrack_unrollRadialVelocity`）. https://ti.com/document-viewer/lit/html/TIDUE71D/configuration-parameters-t5323204-19.html
48. G. M. Brooker, "Mutual Interference of Millimeter-Wave Radar Systems," *IEEE Trans. EMC*, 49(1):170–181, 2007. doi:10.1109/TEMC.2006.890223
49. J. von Neumann, R. H. Kent, H. R. Bellinson, B. I. Hart, "The Mean Square Successive Difference," *Ann. Math. Statist.*, 12(2):153–162, 1941. doi:10.1214/aoms/1177731746
50. P. J. Rousseeuw, C. Croux, "Alternatives to the Median Absolute Deviation," *J. Amer. Statist. Assoc.*, 88(424):1273–1283, 1993. doi:10.1080/01621459.1993.10476408
51. L. Dubský, 以 RFbeam K-LC5 量測無人機對地速度，CTU 學士論文，2023（寬視野、俯仰敏感、讀值偏低）. https://support.dce.felk.cvut.cz/mediawiki/images/4/4a/Bp_2023_dubsky_libor.pdf
52. C. A. Balanis, *Antenna Theory: Analysis and Design*, 4th ed., Wiley, 2016.

> 第 2.x 版（後方來車偵測：都卜勒 × 距離變化率交叉核對）的演算法說明保留在 git 歷史：commit `8a5c3b6` 的 `docs/ALGORITHM.md`。
