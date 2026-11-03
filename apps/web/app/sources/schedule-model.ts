/** 可视化编辑仅覆盖可无损表示的周期；其他 cron 保持原样。 */
export interface ScheduleModel {
  mode: 'daily' | 'weekly' | 'hours' | 'custom';
  time: string;
  weekdays: number[];
  hours: number;
  minute: number;
  original: string;
}

/** 解析已有计划，不将复杂 cron 静默简化为每天。 */
export function parseSchedule(expression: string): ScheduleModel {
  const model: ScheduleModel = {
    mode: 'custom',
    time: '03:00',
    weekdays: [1],
    hours: 1,
    minute: 0,
    original: expression,
  };
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return model;
  const [minute, hour, day, month, weekday] = fields;
  if (day !== '*' || month !== '*' || !minute || !/^\d+$/.test(minute) || Number(minute) > 59)
    return model;
  model.minute = Number(minute);
  if (weekday === '*' && (hour === '*' || /^\*\/(1|2|3|4|6|8|12)$/.test(hour ?? ''))) {
    return { ...model, mode: 'hours', hours: hour === '*' ? 1 : Number(hour?.slice(2)) };
  }
  if (!hour || !/^\d+$/.test(hour) || Number(hour) > 23) return model;
  model.time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  if (weekday === '*') return { ...model, mode: 'daily' };
  // 单选编辑不能无损表达旧的多日计划，将其保留为自定义，等待用户主动替换。
  if (weekday && /^[0-7]$/.test(weekday)) {
    return {
      ...model,
      mode: 'weekly',
      weekdays: [...new Set(weekday.split(',').map((value) => Number(value) % 7))],
    };
  }
  return model;
}

/** 将表单转换为合法五段 cron；小时周期限定为一天的整除数，避免跨日不均匀。 */
export function scheduleExpression(model: ScheduleModel): string {
  if (model.mode === 'custom') return model.original;
  if (model.mode === 'hours') {
    if (
      ![1, 2, 3, 4, 6, 8, 12].includes(model.hours) ||
      !Number.isInteger(model.minute) ||
      model.minute < 0 ||
      model.minute > 59
    )
      throw new TypeError('请选择有效的间隔与分钟。');
    return `${String(model.minute)} ${model.hours === 1 ? '*' : `*/${String(model.hours)}`} * * *`;
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(model.time)) throw new TypeError('请选择执行时间。');
  const [hour, minute] = model.time.split(':').map(Number);
  if (
    model.mode === 'weekly' &&
    (!model.weekdays.length ||
      model.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6))
  )
    throw new TypeError('请至少选择一天。');
  return `${String(minute)} ${String(hour)} * * ${model.mode === 'daily' ? '*' : [...new Set(model.weekdays)].sort().join(',')}`;
}
