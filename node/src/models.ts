/** Friendly model names you can pass as `model`, mapped to the KreatorFlow API model id. Any other value is sent unchanged. */
export const MODEL_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  "seedance-2.5": "kreator-video-seedance-2-5",
  "seedance-2-5": "kreator-video-seedance-2-5",
  "seedance-2.0": "kreator-video-seedance-2",
  "seedance-2": "kreator-video-seedance-2",
  "seedance-2.0-fast": "kreator-video-seedance-2-fast",
  "seedance-2-fast": "kreator-video-seedance-2-fast",
  "seedance-2.0-mini": "kreator-video-seedance-2-mini",
  "seedance-2-mini": "kreator-video-seedance-2-mini",
});

export type SeedanceModelName = "seedance-2.5" | "seedance-2.0" | "seedance-2.0-fast" | "seedance-2.0-mini";
/** A friendly name, or any KreatorFlow model id such as "kreator-video-pro". */
export type SeedanceModel = SeedanceModelName | (string & {});

export const DEFAULT_MODEL: SeedanceModelName = "seedance-2.0";

/** Every status a job can have, in the order a job moves through them. */
export const JOB_STATUSES = ["created", "queued", "processing", "completed", "failed", "canceled", "blocked"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Final statuses. A job in any other status is still running. */
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "canceled", "blocked"]);

/** Return the KreatorFlow API model id for a friendly name such as "seedance-2.0". */
export function resolveModel(model: string): string {
  const key = model.trim();
  return MODEL_ALIASES[key.toLowerCase()] ?? key;
}
