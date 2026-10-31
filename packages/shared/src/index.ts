import { z } from 'zod';

export const ROLES = ['super_admin', 'manager', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ['invited', 'active', 'suspended'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const MIN_PASSWORD_LENGTH = 10;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(256),
  turnstileToken: z.string().optional()
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(256)
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'New password must differ from the current one',
    path: ['newPassword']
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** What the API returns about the signed-in user. Never includes secrets. */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  orgId: string | null;
  mustChangePassword: boolean;
}

export const createOrgSchema = z.object({
  name: z.string().trim().min(2).max(120),
  logoUrl: z.string().url().max(500).optional()
});

export const updateOrgSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  logoUrl: z.string().url().max(500).nullable().optional(),
  status: z.enum(['active', 'inactive']).optional()
});

export const createAdminSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  mobile: z.string().trim().max(20).optional(),
  orgId: z.string().min(1),
  role: z.enum(['manager', 'viewer'])
});

export const updateAdminSchema = z.object({
  action: z.enum(['suspend', 'reactivate', 'reset_password']).optional(),
  role: z.enum(['manager', 'viewer']).optional(),
  orgId: z.string().min(1).optional()
});

// ---- Campaigns ----
export const CAMPAIGN_LANGUAGES = ['en', 'ml', 'hi'] as const;
export const SHORT_CODE_RE = /^[a-z0-9]{4,12}$/;
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const campaignFields = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  language: z.enum(CAMPAIGN_LANGUAGES).default('en'),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  dailyWindow: z.object({ from: hhmm, to: hhmm }).nullable().optional(),
  caption: z.string().trim().max(1000).optional(),
  hashtags: z.string().trim().max(300).optional(),
  thankYou: z.string().trim().max(500).optional(),
  ctaUrl: z.string().url().max(500).optional(),
  shortCode: z.string().regex(SHORT_CODE_RE).optional(),
  orgId: z.string().min(1).optional()
});

const endsAfterStart = (v: { startsAt?: string; endsAt?: string }) =>
  !v.startsAt || !v.endsAt || new Date(v.endsAt) > new Date(v.startsAt);

export const createCampaignSchema = campaignFields.refine(endsAfterStart, {
  message: 'End must be after start',
  path: ['endsAt']
});
export const updateCampaignSchema = campaignFields.partial().refine(endsAfterStart, {
  message: 'End must be after start',
  path: ['endsAt']
});
export const campaignActionSchema = z.object({
  action: z.enum(['publish', 'pause', 'resume', 'end', 'archive'])
});

export type CampaignState = 'draft' | 'scheduled' | 'live' | 'paused' | 'ended' | 'archived';

// ---- Templates and title boxes ----
export const OUTPUT_SIZES = [
  { width: 1080, height: 1080, label: 'Square 1:1' },
  { width: 1080, height: 1350, label: 'Portrait 4:5' },
  { width: 1080, height: 1920, label: 'Story 9:16' }
] as const;

/** Finds the output size whose shape matches an uploaded frame (within 2%), or null. Any resolution is fine. */
export function matchOutputSize(w: number, h: number) {
  return OUTPUT_SIZES.find((s) => Math.abs(w / h - s.width / s.height) / (s.width / s.height) < 0.02) ?? null;
}

export const FONTS = ['Inter', 'Space Grotesk', 'Poppins', 'Noto Sans', 'Noto Sans Malayalam', 'Manjari', 'Mukta'] as const;

const rect = z.object({ x: z.number().min(0), y: z.number().min(0), w: z.number().min(1), h: z.number().min(1) });
export type Rect = z.infer<typeof rect>;

export const slotStyleSchema = z.object({
  font: z.enum(FONTS).default('Inter'),
  maxSize: z.number().min(8).max(300).default(64),
  minSize: z.number().min(6).max(300).default(24),
  lines: z.union([z.literal(1), z.literal(2)]).default(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#FFFFFF'),
  weight: z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700)]).default(700),
  tracking: z.number().min(-5).max(20).default(0),
  align: z.enum(['left', 'center', 'right']).default('center'),
  valign: z.enum(['top', 'middle', 'bottom']).default('middle'),
  case: z.enum(['as_typed', 'title', 'upper']).default('as_typed')
});
export type SlotStyle = z.infer<typeof slotStyleSchema>;

export const slotSchema = z.object({
  label: z.string().trim().min(1).max(60),
  inputType: z.enum(['text', 'dropdown', 'fixed']),
  options: z.array(z.string().trim().min(1).max(120)).max(500).optional(),
  fixedValue: z.string().max(120).optional(),
  required: z.boolean().default(true),
  box: rect,
  style: slotStyleSchema,
  maxChars: z.number().int().min(1).max(120).default(40)
});
export type SlotInput = z.infer<typeof slotSchema>;

export const saveSlotsSchema = z.object({ slots: z.array(slotSchema).max(8) });

export const templateMetaSchema = z.object({
  name: z.string().trim().min(1).max(80),
  width: z.coerce.number().int(),
  height: z.coerce.number().int(),
  photoWindow: rect
});

export const updateTemplateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  photoWindow: rect.optional(),
  sortOrder: z.number().int().min(0).max(50).optional()
});

export const outputSchema = z.object({
  templateId: z.string().min(1),
  visitorId: z.string().min(8).max(64),
  slotValues: z.record(z.string().max(200)).default({}),
  turnstileToken: z.string().max(4096).optional()
});

export const EVENT_TYPES = ['visit', 'pick', 'create', 'download', 'share', 'caption_copy', 'error'] as const;
export const eventsSchema = z.object({
  visitorId: z.string().min(8).max(64),
  events: z.array(z.object({ type: z.enum(EVENT_TYPES), meta: z.record(z.union([z.string().max(100), z.number()])).optional() })).min(1).max(20)
});

export const MAX_ASSET_BYTES = 1_500_000;
