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
