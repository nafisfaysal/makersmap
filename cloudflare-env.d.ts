declare namespace Cloudflare {
  interface Env {
    MONGODB_URI?: string;
    MONGODB_DB?: string;
    X_BEARER_TOKEN?: string;
    TWITTERAPI_IO_KEY?: string;
    ANTHROPIC_API_KEY?: string;
    OPENROUTER_API_KEY?: string;
    OPENROUTER_MODEL?: string;
    RESEND_API_KEY?: string;
    EMAIL_FROM?: string;
    ADMIN_SECRET?: string;
    SESSION_SECRET?: string;
    X_CLIENT_ID?: string;
    X_CLIENT_SECRET?: string;
    SITE_URL?: string;
    PLAUSIBLE_DOMAIN?: string;
    DATAFAST_WEBSITE_ID?: string;
    POSTHOG_KEY?: string;
    X_REQUEST_EMAIL?: string;
    POSTHOG_HOST?: string;
    BUCKET?: R2Bucket;
  }
}
