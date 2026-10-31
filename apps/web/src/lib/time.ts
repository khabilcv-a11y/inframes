// Admins type times in India time; the API stores UTC.
const IST_MS = 330 * 60_000;
/** "2026-11-02T09:00" (typed in IST) -> ISO with offset */
export const istInputToIso = (v: string) => `${v}:00+05:30`;
/** ISO -> value for <input type="datetime-local"> in IST */
export const isoToIstInput = (iso: string) => new Date(new Date(iso).getTime() + IST_MS).toISOString().slice(0, 16);
export const showIst = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
