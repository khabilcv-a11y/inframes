declare global {
  namespace App {
    interface Platform {
      env: { DB: D1Database; SESSION_SECRET: string; TURNSTILE_SECRET?: string };
    }
  }
}
export {};
