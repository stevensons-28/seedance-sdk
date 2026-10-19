#!/usr/bin/env node
// npx seedance-sdk "a prompt" --model seedance-2.0 --out clip.mp4
import { parseArgs } from "node:util";
import { Seedance } from "./client.js";
import { JobFailedError, SeedanceError, WaitTimeoutError } from "./errors.js";
import { DEFAULT_MODEL } from "./models.js";
import { VERSION } from "./version.js";

const HELP = `Usage: seedance-sdk "<prompt>" [options]

Generate a Seedance video through the KreatorFlow API and save the MP4.
Reads your key from KREATORFLOW_API_KEY.

Options:
  -m, --model <name>         seedance-2.0 (default), seedance-2.5, seedance-2.0-fast, seedance-2.0-mini, or a model id
  -d, --duration <seconds>   length in seconds (default 5)
  -r, --resolution <res>     480p, 720p (default), 1080p or 4k
  -a, --aspect-ratio <ratio> for example 16:9, 9:16, 1:1 or adaptive
  -i, --image <file|url>     first frame image
      --last-frame <file|url> last frame image
      --seed <n>             fix the seed to compare prompt changes
  -o, --out <file>           where to save the MP4 (default <job id>.mp4)
      --no-wait              print the job id and exit
      --api-key <key>        API key (default KREATORFLOW_API_KEY)
  -v, --version              print the version
  -h, --help                 show this help

Get a key: https://developers.kreatorflow.ai/?section=keys
Docs: https://kreatorflow.ai/seedance-api/reference`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      model: { type: "string", short: "m", default: DEFAULT_MODEL },
      duration: { type: "string", short: "d", default: "5" },
      resolution: { type: "string", short: "r", default: "720p" },
      "aspect-ratio": { type: "string", short: "a" },
      image: { type: "string", short: "i" },
      "last-frame": { type: "string" },
      seed: { type: "string" },
      out: { type: "string", short: "o" },
      "no-wait": { type: "boolean", default: false },
      "api-key": { type: "string" },
      version: { type: "boolean", short: "v", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  if (values.version) {
    console.log(VERSION);
    return 0;
  }
  const prompt = positionals.join(" ").trim();
  if (!prompt) {
    console.error(HELP);
    return 2;
  }

  try {
    const client = new Seedance({ apiKey: values["api-key"] });
    const job = await client.createVideo(prompt, {
      model: values.model,
      duration: Number(values.duration),
      resolution: values.resolution,
      aspectRatio: values["aspect-ratio"],
      firstFrame: values.image,
      lastFrame: values["last-frame"],
      seed: values.seed === undefined ? undefined : Number(values.seed),
    });
    const cost = job.quotedTokenCost === undefined ? "" : `, quoted ${job.quotedTokenCost} tokens`;
    console.error(`job ${job.id} ${job.status}${cost}`);
    if (values["no-wait"]) {
      console.log(job.id);
      return 0;
    }
    let last = job.status;
    const done = await client.wait(job, {
      onUpdate: (update) => {
        if (update.status !== last) {
          last = update.status;
          console.error(`job ${update.id} ${update.status}`);
        }
      },
    });
    if (done.status !== "completed") throw new JobFailedError(done);
    console.log(await client.download(done, values.out));
    return 0;
  } catch (error) {
    if (error instanceof WaitTimeoutError) {
      console.error(`seedance-sdk: ${error.message} Check it later with the job id.`);
      return 2;
    }
    if (error instanceof JobFailedError) {
      console.error(`seedance-sdk: job ${error.job.id} ${error.job.status}: ${error.code} ${error.job.errorMessage ?? ""}`.trim());
      return 1;
    }
    if (error instanceof SeedanceError || (error as NodeJS.ErrnoException)?.code === "ENOENT") {
      console.error(`seedance-sdk: ${(error as Error).message}`);
      return 1;
    }
    throw error;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
