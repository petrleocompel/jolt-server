import { cn } from "#/lib/utils.ts";

/** The bolt mark shared with the iOS app and the project site — same path, same brand. */
function JoltMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={cn("text-jolt-400", className)}
    >
      <path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13z" />
    </svg>
  );
}

export { JoltMark };
