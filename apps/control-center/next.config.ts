import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Resolved rather than string-joined so the path is correct on Windows too,
// where a file: URL pathname would carry a leading slash before the drive.
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const config: NextConfig = {
  reactStrictMode: true,
  // Emits a self-contained server bundle with only the node_modules actually
  // reached, which keeps the container small and removes any dependency on the
  // workspace layout at runtime.
  output: "standalone",
  outputFileTracingRoot: workspaceRoot,
  // The workspace packages ship TypeScript source rather than build output, so
  // Next must compile them itself.
  transpilePackages: ["@slate/db"],
  poweredByHeader: false,
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
      ],
    },
  ],
};

export default config;
