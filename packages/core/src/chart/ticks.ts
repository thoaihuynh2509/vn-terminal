/** What a time-axis tick marks, in the order the engine promotes them. */
export type TickKind = "year" | "month" | "day" | "time" | "seconds";

const ICT = "Asia/Ho_Chi_Minh";
const formats = new Map<string, Intl.DateTimeFormat>();

function format(lang: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${lang}|${JSON.stringify(opts)}`;
  let f = formats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(lang, { timeZone: ICT, ...opts });
    formats.set(key, f);
  }
  return f;
}

/** A time-axis tick in market time; a day tick carries its month so sessions a month apart differ. */
export function tickLabel(tSec: number, kind: TickKind, locale: "vi" | "en"): string {
  const lang = locale === "vi" ? "vi-VN" : "en-GB";
  const d = new Date(tSec * 1000);
  switch (kind) {
    case "year": return format(lang, { year: "numeric" }).format(d);
    case "month": return format(lang, { month: "short" }).format(d);
    case "day": {
      // Assembled rather than left to the locale: vi-VN renders this pattern differently from en-GB.
      const parts = format(lang, { day: "2-digit", month: "2-digit" }).formatToParts(d);
      const part = (type: string) => parts.find((x) => x.type === type)?.value ?? "";
      return `${part("day")}/${part("month")}`;
    }
    case "seconds": return format(lang, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(d);
    default: return format(lang, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  }
}
