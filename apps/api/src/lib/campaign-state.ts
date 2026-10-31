import type { CampaignState } from '@inframe/shared';

export interface StateInput {
  status: string; // stored: draft | scheduled | paused | ended | archived
  starts_at: string;
  ends_at: string;
  daily_window: string | null;
}

const IST_OFFSET_MIN = 330;

function insideDailyWindow(now: Date, raw: string | null): boolean {
  if (!raw) return true;
  const w = JSON.parse(raw) as { from: string; to: string };
  const ist = (now.getUTCHours() * 60 + now.getUTCMinutes() + IST_OFFSET_MIN) % 1440;
  const mins = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const from = mins(w.from);
  const to = mins(w.to);
  return from <= to ? ist >= from && ist < to : ist >= from || ist < to; // overnight windows
}

/**
 * Stored status holds only manual decisions (draft, published, paused, ended early, archived).
 * Scheduled/live/ended-by-time are derived from the clock here, so no background job is needed
 * and a campaign flips state exactly at its start and end time.
 */
export function effectiveState(c: StateInput, now = new Date()): CampaignState {
  if (c.status === 'draft' || c.status === 'paused' || c.status === 'ended' || c.status === 'archived') {
    return c.status;
  }
  if (now >= new Date(c.ends_at)) return 'ended';
  if (now < new Date(c.starts_at)) return 'scheduled';
  return insideDailyWindow(now, c.daily_window) ? 'live' : 'scheduled';
}
