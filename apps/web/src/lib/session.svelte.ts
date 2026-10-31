import type { SessionUser } from '@inframe/shared';

export const session = $state<{ user: SessionUser | null; loaded: boolean }>({ user: null, loaded: false });
