import { describe, expect, it } from 'vitest';
import { LineAssembler } from './lineAssembler';

/** 仿照 ESP32 依 MTU 把字串切成固定大小的通知 */
function chunks(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

describe('LineAssembler', () => {
  const line = 'R=1 ST=3 V=5.43 SD=0.12 Q=95 WD=0 FN=1234 N=1 RD=0.86 RV=3.84 E=52000 G=5.40 FV=0 DR=1234.5 T=812';

  it('把 20 bytes 的分段組回一行', () => {
    const a = new LineAssembler();
    const got = chunks(`${line}\n`, 20).flatMap((c) => a.push(c));
    expect(got).toEqual([line]);
  });

  it('一段裡有好幾行，也能全部取出', () => {
    const a = new LineAssembler();
    expect(a.push('OK saved\nCFG ANGLE=45.0\nR=1')).toEqual(['OK saved', 'CFG ANGLE=45.0']);
    expect(a.push(' ST=1\n')).toEqual(['R=1 ST=1']);
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
    a.push('R=1 ST=');
    a.reset();
    expect(a.push('OK\n')).toEqual(['OK']);
  });
});
