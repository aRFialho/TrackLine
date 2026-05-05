import dayjs from "dayjs";
import type { WorkSchedule } from "../types";

const clampDate = (date: dayjs.Dayjs, start: dayjs.Dayjs, end: dayjs.Dayjs) => {
  if (date.isBefore(start)) {
    return start;
  }
  if (date.isAfter(end)) {
    return end;
  }
  return date;
};

const dailyRange = (base: dayjs.Dayjs, hhmm: string) => {
  const [hour, minute] = hhmm.split(":").map(Number);
  return base.hour(hour).minute(minute).second(0).millisecond(0);
};

const minutesBetween = (start: dayjs.Dayjs, end: dayjs.Dayjs): number => {
  if (!end.isAfter(start)) {
    return 0;
  }
  return end.diff(start, "minute");
};

export const calculateUsefulMinutes = (
  startIso: string,
  endIso: string,
  schedule: WorkSchedule
): number => {
  let cursor = dayjs(startIso);
  const end = dayjs(endIso);

  if (!end.isAfter(cursor)) {
    return 0;
  }

  let total = 0;

  while (cursor.startOf("day").isBefore(end) || cursor.isSame(end, "day")) {
    const base = cursor.startOf("day");
    const workStart = dailyRange(base, schedule.workStart);
    const workEnd = dailyRange(base, schedule.workEnd);
    const lunchStart = dailyRange(base, schedule.lunchStart);
    const lunchEnd = dailyRange(base, schedule.lunchEnd);

    const daySliceStart = clampDate(cursor, workStart, workEnd);
    const daySliceEnd = clampDate(end.isBefore(workEnd) ? end : workEnd, workStart, workEnd);

    if (daySliceEnd.isAfter(daySliceStart)) {
      const fullMinutes = minutesBetween(daySliceStart, daySliceEnd);
      const overlapStart = daySliceStart.isAfter(lunchStart) ? daySliceStart : lunchStart;
      const overlapEnd = daySliceEnd.isBefore(lunchEnd) ? daySliceEnd : lunchEnd;
      const lunchMinutes = minutesBetween(overlapStart, overlapEnd);
      total += Math.max(0, fullMinutes - lunchMinutes);
    }

    cursor = base.add(1, "day");
    if (cursor.isAfter(end)) {
      break;
    }
  }

  return total;
};

