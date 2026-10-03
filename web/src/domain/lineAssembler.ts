/**
 * 【領域層】把藍牙通知的片段組回完整的一行。
 *
 * BLE 預設 MTU 一次最多 20 bytes，ESP32 會把一行拆成好幾段送；
 * 也可能一段裡含好幾行。收到 '\n' 才算一行，'\r\n' 也接受。
 */
export class LineAssembler {
  private buffer = '';

  /** @param maxLength 緩衝區上限：一直沒有換行（雜訊）時丟掉，避免無限長大 */
  constructor(private readonly maxLength = 512) {}

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '').trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line !== '') lines.push(line);
      newline = this.buffer.indexOf('\n');
    }
    if (this.buffer.length > this.maxLength) this.buffer = '';
    return lines;
  }

  reset(): void {
    this.buffer = '';
  }
}
