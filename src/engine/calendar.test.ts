// 2026-11-20：创作年历
import { describe, it, expect } from 'vitest';
import { dayDiff, heatLevel, workDay, yearGrid, yearStats, yearsOf } from './calendar';

const w = (date: string, series = 's1') => ({ date, series, ts: 0 });

describe('创作年历', () => {
  it('日期取显示日期；没有就用时间戳；都没有返回 null', () => {
    expect(workDay({ date: '2025.06.14' })).toEqual({ y: 2025, m: 6, d: 14 });
    expect(workDay({ date: '', ts: new Date(2024, 0, 5).getTime() })).toEqual({ y: 2024, m: 1, d: 5 });
    expect(workDay({ date: '' })).toBeNull();
  });

  it('有作品的年份从新到旧', () => {
    expect(yearsOf([w('2024.01.01'), w('2025.03.02'), w('2024.12.31'), { date: '' }])).toEqual([2025, 2024]);
  });

  it('一年的统计：总数、每月、天数、最长连续、最忙的一天和一个月、系列', () => {
    const works = [
      w('2025.03.01'), w('2025.03.02', 's2'), w('2025.03.03'), w('2025.03.03'), // 3 月 1–3 日连续 3 天，3 日两幅
      w('2025.03.10'),
      w('2025.07.01', 's2'), w('2025.07.02', 's2'),
      w('2024.12.31'), // 别的年份不算
    ];
    const s = yearStats(works, 2025);
    expect(s.total).toBe(7);
    expect(s.months[2]).toBe(5);
    expect(s.months[6]).toBe(2);
    expect(s.activeDays).toBe(6);
    expect(s.streak).toEqual({ days: 3, from: '2025-03-01', to: '2025-03-03' });
    expect(s.busiestMonth).toBe(2);
    expect(s.busiestDay).toEqual({ key: '2025-03-03', count: 2 });
    expect(s.days.get('2025-03-03')).toEqual([2, 3]);
    expect(s.series).toEqual([{ id: 's1', count: 4 }, { id: 's2', count: 3 }]);
  });

  it('跨月的连续也算；一幅都没有时是空的', () => {
    expect(yearStats([w('2025.01.31'), w('2025.02.01')], 2025).streak?.days).toBe(2);
    const empty = yearStats([w('2024.05.05')], 2025);
    expect(empty.total).toBe(0);
    expect(empty.streak).toBeNull();
    expect(empty.busiestMonth).toBe(-1);
  });

  it('这一年的颜色：按占比合起来，相近的并在一起', () => {
    const works = [w('2025.01.01'), w('2025.01.02')];
    const sw = [
      [{ hex: '#3E7BD6', share: 0.6 }, { hex: '#FFFFFF', share: 0.4 }],
      [{ hex: '#4080D8', share: 0.5 }, { hex: '#D9493F', share: 0.5 }],
    ];
    const s = yearStats(works, 2025, (i) => sw[i]);
    expect(s.colors[0].hex).toBe('#3E7BD6'); // 两个蓝并成一个
    expect(s.colors[0].share).toBeCloseTo(1.1 / 2, 5);
    expect(s.colors).toHaveLength(3);
  });

  it('热力图深浅分 4 级', () => {
    expect(heatLevel(0, 5)).toBe(0);
    expect(heatLevel(1, 5)).toBe(1);
    expect(heatLevel(5, 5)).toBe(4);
    expect(heatLevel(3, 5)).toBe(3);
  });

  it('日期相差几天', () => {
    expect(dayDiff('2025-02-28', '2025-03-01')).toBe(1);
    expect(dayDiff('2024-02-28', '2024-03-01')).toBe(2);
  });

  it('热力图格子：一列一周，周一开始；2025 年 1 月 1 日是周三', () => {
    const g = yearGrid(2025, 1);
    expect(g.cells).toHaveLength(365);
    expect(g.cells[0]).toMatchObject({ key: '2025-01-01', col: 0, row: 2 });
    expect(g.cells[364].key).toBe('2025-12-31');
    expect(g.cols).toBe(53);
    expect(g.monthCols[0]).toBe(0);
    // 周日开始：周三是第 4 行
    expect(yearGrid(2025, 7).cells[0].row).toBe(3);
    expect(yearGrid(2024, 1).cells).toHaveLength(366);
  });
});
