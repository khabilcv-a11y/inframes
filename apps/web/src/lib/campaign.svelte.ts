import { api } from './api';

export type Campaign = {
  id: string; title: string; orgName: string; orgId: string; shortCode: string; state: string; startsAt: string; endsAt: string;
  description: string | null; language: string; caption: string | null; hashtags: string | null; thankYou: string | null; ctaUrl: string | null;
};

export const current = $state<{ c: Campaign | null; error: boolean }>({ c: null, error: false });

export async function loadCampaign(id: string) {
  const r = await api<{ campaign: Campaign }>(`/admin/campaigns/${id}`);
  if (r.ok) { current.c = r.data.campaign; current.error = false; } else { current.c = null; current.error = true; }
  return r;
}
