"""Command line: ``seedance "a prompt" --model seedance-2.0 --out clip.mp4``."""

from __future__ import annotations

import argparse
import sys
from typing import List, Optional

from ._version import __version__
from .client import Seedance
from .errors import JobFailedError, SeedanceError, WaitTimeoutError
from .models import DEFAULT_MODEL, MODEL_ALIASES
from .types import Job


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="seedance",
        description="Generate a Seedance video through the KreatorFlow API and save the MP4. "
        "Reads your key from KREATORFLOW_API_KEY.",
        epilog="Get a key: https://developers.kreatorflow.ai/?section=keys  "
        "Docs: https://kreatorflow.ai/seedance-api/reference",
    )
    parser.add_argument("prompt", help="what should happen in the clip")
    parser.add_argument(
        "-m", "--model", default=DEFAULT_MODEL,
        help=f"model name or id (default {DEFAULT_MODEL}; names: {', '.join(sorted(k for k in MODEL_ALIASES if '.' in k))})",
    )
    parser.add_argument("-d", "--duration", type=int, default=5, help="length in seconds (default 5)")
    parser.add_argument("-r", "--resolution", default="720p", help="480p, 720p, 1080p or 4k (default 720p)")
    parser.add_argument("-a", "--aspect-ratio", default=None, help="for example 16:9, 9:16, 1:1 or adaptive")
    parser.add_argument("-i", "--image", default=None, help="first frame: a local image or an https URL")
    parser.add_argument("--last-frame", default=None, help="last frame: a local image or an https URL")
    parser.add_argument("--seed", type=int, default=None, help="fix the seed to compare prompt changes")
    parser.add_argument("--audio", dest="generate_audio", action="store_true", default=None, help="ask for generated audio")
    parser.add_argument("--no-audio", dest="generate_audio", action="store_false", help="ask for a silent clip")
    parser.add_argument("-o", "--out", default=None, help="where to save the MP4 (default <job id>.mp4)")
    parser.add_argument("--no-wait", action="store_true", help="print the job id and exit without waiting")
    parser.add_argument("--timeout", type=float, default=1800, help="seconds to wait (default 1800)")
    parser.add_argument("--api-key", default=None, help="API key (default: KREATORFLOW_API_KEY)")
    parser.add_argument("--version", action="version", version=f"seedance {__version__}")
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    args = _parser().parse_args(argv)
    try:
        client = Seedance(api_key=args.api_key)
        job = client.create_video(
            args.prompt,
            model=args.model,
            duration=args.duration,
            resolution=args.resolution,
            aspect_ratio=args.aspect_ratio,
            first_frame=args.image,
            last_frame=args.last_frame,
            seed=args.seed,
            generate_audio=args.generate_audio,
        )
        cost = f", quoted {job.quoted_token_cost:g} tokens" if job.quoted_token_cost is not None else ""
        print(f"job {job.id} {job.status}{cost}", file=sys.stderr)
        if args.no_wait:
            print(job.id)
            return 0

        last = [job.status]

        def report(update: Job) -> None:
            if update.status != last[0]:
                last[0] = update.status
                print(f"job {update.id} {update.status}", file=sys.stderr)

        job = client.wait(job, timeout=args.timeout, on_update=report)
        if not job.succeeded:
            raise JobFailedError(job)
        path = client.download(job, args.out)
        print(path)
        return 0
    except WaitTimeoutError as err:
        print(f"seedance: {err.message} Check it later with the job id.", file=sys.stderr)
        return 2
    except JobFailedError as err:
        print(f"seedance: job {err.job.id} {err.job.status}: {err.code} {err.message}", file=sys.stderr)
        return 1
    except SeedanceError as err:
        print(f"seedance: {err}", file=sys.stderr)
        return 1
    except FileNotFoundError as err:
        print(f"seedance: {err}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
