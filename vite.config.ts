import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vinext from "vinext";
import { defineConfig, type Plugin } from "vite";
import { readExecutionProfile } from "./scripts/execution-profile.mjs";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

// .openai/ is checkout-local and gitignored, so a fresh clone has no hosting.json.
const hostingConfigUrl = new URL("./.openai/hosting.json", import.meta.url);
const { d1, r2 }: { d1?: string; r2?: string } = existsSync(hostingConfigUrl)
  ? JSON.parse(readFileSync(hostingConfigUrl, "utf8"))
  : {};

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";

function fixPunycodeSlash() {
  return {
    name: "fix-punycode-slash",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      if (!id.includes("tr46") || !code.includes("punycode/")) return null;
      return {
        code: code.replaceAll('require("punycode/")', 'require("punycode")'),
        map: null,
      };
    },
  };
}

// The MongoDB driver (via whatwg-url → tr46) does `require("punycode/")`. The
// trailing slash means "the npm package, not the Node builtin", which the dep
// optimizer's resolver doesn't understand, so it left it as a runtime require
// that Workers can't satisfy. Resolve it to the package file explicitly.
function resolveThroughChain(...packages: string[]): string {
  let from = import.meta.url;
  for (const name of packages.slice(0, -1)) {
    from = createRequire(from).resolve(`${name}/package.json`);
  }
  return createRequire(from).resolve(packages[packages.length - 1]);
}
const punycodePackagePath = resolveThroughChain("mongodb", "whatwg-url", "tr46", "punycode/");
function resolvePunycodeForOptimizer() {
  return {
    name: "resolve-punycode-slash",
    resolveId(id: string) {
      return id === "punycode/" ? punycodePackagePath : null;
    },
  };
}
// MapLibre starts its worker from `new URL("./maplibre-gl-worker.mjs", import.meta.url)`
// built at runtime, so the bundler never sees it. In a production build the map
// code lands in _next/static/chunks/ and the worker 404s, leaving an empty globe.
// Emit the worker (and the shared module it imports) next to the chunks.
function emitMaplibreWorker(): Plugin {
  const require = createRequire(import.meta.url);
  return {
    name: "emit-maplibre-worker",
    apply: "build",
    applyToEnvironment: (environment) => environment.name === "client",
    generateBundle() {
      for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
        this.emitFile({
          type: "asset",
          fileName: `_next/static/chunks/${file}`,
          source: readFileSync(require.resolve(`maplibre-gl/dist/${file}`), "utf8"),
        });
      }
    },
  };
}

const optimizerOptions = { rolldownOptions: { plugins: [resolvePunycodeForOptimizer()] } };

function loadLocalEnv() {
  try {
    const text = readFileSync(new URL("./.env", import.meta.url), "utf8");
    for (const line of text.split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // Local secrets file is optional.
  }
}

loadLocalEnv();

const localBindingConfig = {
  main: "vinext/server/fetch-handler",
  compatibility_date: "2025-09-15",
  compatibility_flags: ["nodejs_compat"],
  // Secrets reach the Worker two ways. In development they're read from .env and
  // inlined here so Miniflare has them. In a production build they're left out:
  // set them with `wrangler secret put <NAME>` so they're encrypted at rest and
  // never written into the built config. Only non-secret settings are inlined always.
  vars: {
    MONGODB_DB: process.env.MONGODB_DB || "makersmap",
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL || "",
    EMAIL_FROM: process.env.EMAIL_FROM || "",
    SITE_URL: process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "",
    PLAUSIBLE_DOMAIN: process.env.PLAUSIBLE_DOMAIN || "",
    DATAFAST_WEBSITE_ID: process.env.DATAFAST_WEBSITE_ID || "",
    POSTHOG_KEY: process.env.POSTHOG_KEY || "",
    POSTHOG_HOST: process.env.POSTHOG_HOST || "",
    ...(process.env.NODE_ENV === "production" && !process.env.INLINE_SECRETS ? {} : {
      MONGODB_URI: process.env.MONGODB_URI || "",
      X_BEARER_TOKEN: process.env.X_BEARER_TOKEN || "",
      TWITTERAPI_IO_KEY: process.env.TWITTERAPI_IO_KEY || "",
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || "",
      RESEND_API_KEY: process.env.RESEND_API_KEY || "",
      ADMIN_SECRET: process.env.ADMIN_SECRET || "",
      SESSION_SECRET: process.env.SESSION_SECRET || "",
      X_CLIENT_ID: process.env.X_CLIENT_ID || "",
      X_CLIENT_SECRET: process.env.X_CLIENT_SECRET || "",
    }),
  },
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Use Miniflare's local Request.cf placeholder unless fetching is requested.
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false";
  process.env.WRANGLER_SEND_METRICS ??= "false";

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_REGISTRY_PATH ??= ".wrangler/dev-registry";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      ...(managedLinux ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] } : {}),
      ...(isCodexSeatbeltSandbox ? { watch: { useFsEvents: false, usePolling: true } } : {}),
    },
    resolve: {
      alias: {
        "punycode/": "punycode",
      },
    },
    environments: {
      // MapLibre spawns its worker from a URL next to its own module. Pre-bundling
      // moves the module into node_modules/.vite/deps, where the worker file does
      // not exist, so the map renders nothing. Serve it from its real location.
      // Deps discovered late trigger a re-optimisation that breaks open tabs
      // ("504 Outdated Optimize Dep"). Listing them here bundles them at startup.
      client: { optimizeDeps: { exclude: ["maplibre-gl"], include: ["html-to-image", "simple-icons", "sonner", "cmdk", "vaul", "recharts", "date-fns", "react-hook-form", "@hookform/resolvers/zod", "input-otp", "embla-carousel-react", "react-day-picker", "react-resizable-panels", "next-themes"] } },
      rsc: { optimizeDeps: optimizerOptions },
      ssr: { optimizeDeps: optimizerOptions },
    },
    plugins: [
      fixPunycodeSlash(),
      emitMaplibreWorker(),
      vinext(),
      sites({ mockAuth: !managedLinux }),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: localBindingConfig,
      }),
    ],
  };
});
