import { describe, expect, it } from 'vitest';
import { LineAssembler } from './lineAssembler';

/** 仿照 ESP32 依 MTU 把字串切成固定大小的通知 */
function chunks(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

describe('LineAssembler', () => {
  const line = 'R=1 W=1 L=2 D=8.42 V=6.20 TTC=1.4 N=1 RD=8.50 RV=-6.31 E=52000 T=35';

  it('把 20 bytes 的分段組回一行', () => {
    const a = new LineAssembler();
    const got = chunks(`${line}\n`, 20).flatMap((c) => a.push(c));
    expect(got).toEqual([line]);
  });

  it('一段裡有好幾行，也能全部取出', () => {
    const a = new LineAssembler();
    expect(a.push('OK saved\nCFG TEST=1\nR=1')).toEqual(['OK saved', 'CFG TEST=1']);
    expect(a.push(' L=0\n')).toEqual(['R=1 L=0']);
  });

  it('接受 \\r\\n 並略過空行', () => {
    const a = new LineAssembler();
    expect(a.push('OK\r\n\r\n\nERR x\r\n')).toEqual(['OK', 'ERR x']);
  });

  it('一直沒有換行的雜訊會被丟掉，不會無限長大', () => {
    const a = new LineAssembler(64);
    a.push('x'.repeat(100));
    expect(a.push('OK\n')).toEqual(['OK']);
  });

  it('reset 清掉半行', () => {
    const a = new LineAssembler();
    a.push('R=1 L=');
    a.reset();
    expect(a.push('OK\n')).toEqual(['OK']);
  });
});
