/** 将常见五段 cron 转成时间说明；不猜测复杂规则，编辑时保留其原始语义。 */
export function scheduleLabel(expression: string): string {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return '自定义周期';
  const [minute, hour, day, month, weekday] = parts;
  if (day !== '*' || month !== '*') return '自定义周期';
  if (!minute || !/^\d+$/.test(minute) || Number(minute) > 59) return '自定义周期';
  if (hour === '*' && weekday === '*') return `每小时第 ${String(Number(minute))} 分钟`;
  if (weekday === '*' && /^\*\/(2|3|4|6|8|12)$/.test(hour ?? ''))
    return `每 ${hour?.slice(2) ?? ''} 小时（第 ${String(Number(minute))} 分钟）`;
  if (!hour || !/^\d+$/.test(hour) || Number(hour) > 23) return '自定义周期';
  const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  if (weekday === '*') return `每天 ${time}`;
  if (weekday === '1-5') return `每周一至周五 ${time}`;
  if (weekday && /^[0-7](,[0-7])*$/.test(weekday)) {
    const days = ['日', '一', '二', '三', '四', '五', '六', '日'];
    return `每周${weekday
      .split(',')
      .map((value) => days[Number(value)])
      .join('、')} ${time}`;
  }
  return '自定义周期';
}
