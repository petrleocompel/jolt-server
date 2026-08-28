/**
 * Cron entrypoint.
 *   pnpm cron                    run every job once
 *   pnpm cron --once <job-name>  run a single job
 *   pnpm cron --list             list jobs
 */
import { jobs, runAll, runJob } from "#/cron/index";

const args = process.argv.slice(2);

if (args.includes("--list")) {
  for (const job of jobs) console.log(`${job.name.padEnd(24)} ${job.description}`);
  process.exit(0);
}

const onceIndex = args.indexOf("--once");
if (onceIndex !== -1) {
  const name = args[onceIndex + 1];
  if (!name) {
    console.error("--once requires a job name; see `pnpm cron --list`");
    process.exit(1);
  }
  console.log(`[cron] ${name}: ${await runJob(name)}`);
} else {
  await runAll();
}

process.exit(0);
