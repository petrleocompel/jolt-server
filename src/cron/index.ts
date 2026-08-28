import { env } from "#/env";
import { deleteEventsBefore } from "#/services/pokes";
import { deleteDisabledBefore } from "#/services/devices";
import { db } from "#/db";
import { friendRequest } from "#/db/schema";
import { and, eq, lt } from "drizzle-orm";

export interface CronJob {
  name: string;
  description: string;
  run: () => Promise<string>;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export const jobs: Array<CronJob> = [
  {
    name: "prune-poke-events",
    description: "Delete poke events past the retention window.",
    run: async () => {
      const removed = await deleteEventsBefore(daysAgo(env.POKE_EVENT_RETENTION_DAYS));
      return `pruned ${removed} poke event(s) older than ${env.POKE_EVENT_RETENTION_DAYS}d`;
    },
  },
  {
    name: "expire-friend-requests",
    description: "Reject friend requests nobody ever answered.",
    run: async () => {
      const rows = await db
        .update(friendRequest)
        .set({ status: "rejected", respondedAt: new Date() })
        .where(
          and(
            eq(friendRequest.status, "pending"),
            lt(friendRequest.createdAt, daysAgo(env.FRIEND_REQUEST_EXPIRY_DAYS)),
          ),
        )
        .returning({ id: friendRequest.id });
      return `expired ${rows.length} stale request(s)`;
    },
  },
  {
    name: "cull-dead-tokens",
    description:
      "Delete device tokens APNs reported as Unregistered. Required hygiene: " +
      "Apple throttles providers that keep pushing to dead tokens.",
    run: async () => {
      const removed = await deleteDisabledBefore(daysAgo(7));
      return `culled ${removed} dead device token(s)`;
    },
  },
];

export async function runJob(name: string): Promise<string> {
  const job = jobs.find((j) => j.name === name);
  if (!job) {
    throw new Error(`Unknown job "${name}". Known: ${jobs.map((j) => j.name).join(", ")}`);
  }
  return job.run();
}

export async function runAll(): Promise<void> {
  for (const job of jobs) {
    try {
      console.log(`[cron] ${job.name}: ${await job.run()}`);
    } catch (error) {
      console.error(`[cron] ${job.name} failed`, error);
    }
  }
}
