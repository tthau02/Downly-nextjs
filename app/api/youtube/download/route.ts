import { NextResponse } from "next/server";
import { getYtDlp } from "@/lib/yt-dlp";
import { tryPushFfmpeg } from "@/lib/youtube";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      url?: string;
      formatId?: string;
      output?: "mp4" | "mp3";
    };
    const url = (body?.url || "").trim();
    const formatId = (body?.formatId || "").trim();
    const output: "mp4" | "mp3" = body?.output === "mp3" ? "mp3" : "mp4";
    if (!url || (!url.includes("youtube.com") && !url.includes("youtu.be"))) {
      return NextResponse.json(
        { error: "Invalid YouTube url" },
        { status: 400 }
      );
    }
    if (!formatId) {
      return NextResponse.json({ error: "Missing formatId" }, { status: 400 });
    }

    const ytDlp = await getYtDlp();

    const args: string[] = [url];
    if (output === "mp3") {
      args.push(
        "-f",
        "bestaudio/best",
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "0"
      );
    } else {
      // Use simpler format: prefer pre-merged formats (no ffmpeg merge delay)
      args.push(
        "-f",
        `${formatId}/best[height<=1080]/best`,
        "--merge-output-format",
        "mp4"
      );
    }
    // Stream directly to stdout (-o -)
    args.push(
      "-o",
      "-",
      "--no-part",
      "--quiet",
      "--no-warnings",
      "--retries",
      "2",
      "--socket-timeout",
      "10",
      "--add-header",
      "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "--add-header",
      "Referer:https://www.youtube.com/"
    );
    tryPushFfmpeg(args);

    console.log("[YouTube Download] Streaming:", args);

    // Execute yt-dlp with 90s timeout
    const child = ytDlp.exec(args) as {
      stdout?: NodeJS.ReadableStream;
      kill?: (signal: string) => void;
      once: (event: string, handler: (arg: unknown) => void) => void;
    };
    let streamStarted = false;
    let timeoutId: NodeJS.Timeout | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Timeout if no data in 90s
        timeoutId = setTimeout(() => {
          if (!streamStarted) {
            console.error("[YouTube Download] Timeout - no data in 90s");
            try {
              child.kill?.("SIGKILL");
            } catch {}
            controller.error(
              new Error(
                "YouTube download timeout - video may be restricted or too large"
              )
            );
          }
        }, 90000);

        child.stdout?.on("data", (chunk: Buffer) => {
          streamStarted = true;
          if (timeoutId) clearTimeout(timeoutId);
          controller.enqueue(new Uint8Array(chunk));
        });
        child.stdout?.on("end", () => {
          if (timeoutId) clearTimeout(timeoutId);
          console.log("[YouTube Download] Complete");
          controller.close();
        });
        child.once("error", (arg: unknown) => {
          if (timeoutId) clearTimeout(timeoutId);
          const err = arg as Error;
          console.error("[YouTube Download] Error:", err);
          controller.error(err);
        });
        child.once("close", (arg: unknown) => {
          if (timeoutId) clearTimeout(timeoutId);
          const code = arg as number;
          console.log("[YouTube Download] Closed, code:", code);
          if (code !== 0 && !streamStarted) {
            controller.error(new Error(`yt-dlp failed with code ${code}`));
          }
        });
      },
      cancel() {
        if (timeoutId) clearTimeout(timeoutId);
        try {
          child.kill?.("SIGKILL");
        } catch {}
      },
    });

    const headers = new Headers({
      "Content-Type": output === "mp3" ? "audio/mpeg" : "video/mp4",
      "Content-Disposition": `attachment; filename="video.${output}"`,
      "Cache-Control": "no-store",
    });

    return new NextResponse(stream as unknown as BodyInit, {
      status: 200,
      headers,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error)?.message || "Failed to download YouTube" },
      { status: 500 }
    );
  }
}
