// 2026-11-20：情绪板标注
import { describe, it, expect } from 'vitest';
import { arrowHead, contentBounds, distToInk, distToSegment, inkPath, markBox, moveMark, parseMarks, thinPoints, type BoardMark } from './marks';

describe('情绪板标注', () => {
  it('适应窗口的范围把标注也算进去', () => {
    const items = [{ x: 0, y: 0, w: 100, h: 100 }];
    expect(contentBounds(items)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    const note: BoardMark = { id: 'n', kind: 'note', x: 150, y: -20, w: 50, h: 40, text: '', color: 0, size: 16 };
    const line: BoardMark = { id: 'l', kind: 'line', x1: -30, y1: 50, x2: 10, y2: 130, arrow: false, color: 0, width: 3 };
    expect(contentBounds(items, [note, line])).toEqual({ x: -30, y: -20, w: 230, h: 150 });
  });

  it('读回来的数据：格式不对的丢掉，颜色下标取模、字号和线宽有默认值', () => {
    const marks = parseMarks([
      { id: 'a', kind: 'note', x: 0, y: 0, w: 100, h: 80, text: '你好', color: 7 },
      { id: 'b', kind: 'note', x: 0, y: 0, w: 0, h: 80 },
      { id: 'c', kind: 'swatch', x: 0, y: 0, w: 100, h: 40, colors: ['#123456', 'nope', 'abc'] },
      { id: 'd', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 10, arrow: true },
      { id: 'e', kind: 'ink', pts: [0, 0, 1] },
      { id: 'f', kind: 'ink', pts: [0, 0, 5, 5] },
      { kind: 'note' },
      'x',
    ]);
    expect(marks.map((m) => m.id)).toEqual(['a', 'c', 'd', 'f']);
    expect(marks[0]).toMatchObject({ color: 2, size: 16 });
    expect((marks[1] as { colors: string[] }).colors).toEqual(['#123456', '#AABBCC']);
    expect(marks[2]).toMatchObject({ arrow: true, width: 3, color: 0 });
    expect(parseMarks(null)).toEqual([]);
  });

  it('框和平移', () => {
    const line: BoardMark = { id: 'l', kind: 'line', x1: 10, y1: 50, x2: 0, y2: 0, arrow: false, color: 0, width: 2 };
    expect(markBox(line)).toEqual({ x: 0, y: 0, w: 10, h: 50 });
    moveMark(line, 5, -5);
    expect(line).toMatchObject({ x1: 15, y1: 45, x2: 5, y2: -5 });
    const ink: BoardMark = { id: 'i', kind: 'ink', pts: [0, 0, 10, 4, 3, 9], color: 0, width: 2 };
    expect(markBox(ink)).toEqual({ x: 0, y: 0, w: 10, h: 9 });
  });

  it('点到线段、到手绘线的距离', () => {
    expect(distToSegment(5, 5, 0, 0, 10, 0)).toBe(5);
    expect(distToSegment(-3, 4, 0, 0, 10, 0)).toBe(5);
    expect(distToInk(5, 1, [0, 0, 10, 0, 10, 10])).toBe(1);
  });

  it('箭头两条边对称地落在终点后面', () => {
    const [ax, ay, tx, ty, bx, by] = arrowHead({ x1: 0, y1: 0, x2: 100, y2: 0, width: 4 });
    expect([tx, ty]).toEqual([100, 0]);
    expect(ax).toBeLessThan(100);
    expect(bx).toBeCloseTo(ax, 6);
    expect(ay).toBeCloseTo(-by, 6);
  });

  it('手绘去抖：太近的点丢掉，首尾留下；路径用二次曲线连', () => {
    const thin = thinPoints([0, 0, 0.5, 0, 1, 0, 5, 0, 5.2, 0], 2);
    expect(thin).toEqual([0, 0, 5, 0, 5.2, 0]);
    expect(inkPath([0, 0, 10, 0])).toBe('M0 0L10 0');
    expect(inkPath([0, 0, 10, 0, 20, 10])).toMatch(/^M0 0Q10 0 15 5L20 10$/);
  });
});
