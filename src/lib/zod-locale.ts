import { z } from "zod";

/**
 * Zod's English error messages, switched on explicitly.
 *
 * Zod registers them itself — as a side effect of importing it — but its
 * package.json also declares `"sideEffects": false`, so a production bundle
 * is entitled to drop that registration and does. Every validation error the
 * API returned in production then read "<field>: Invalid input": a too-short
 * password, an intensity over 100 and an unknown `friendId` all said the same
 * useless thing, while `pnpm dev` (unbundled) showed the real messages.
 *
 * Imported for its side effect by the modules that validate — ours are not
 * marked side-effect free, so this call survives the bundler.
 */
z.config(z.locales.en());
