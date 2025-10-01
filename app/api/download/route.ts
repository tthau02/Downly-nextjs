import { NextResponse } from "next/server";
import { getYtDlp } from "@/lib/yt-dlp";
import { getFfmpegPath } from "@/lib/ffmpeg";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

type DownloadRequestBody = {
  url?: string;
  formatId?: string;
  platform?: "tiktok" | "facebook";
  cookie?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as DownloadRequestBody;
    const url = (body && body.url ? body.url : "").trim();
    const formatId = (body && body.formatId ? body.formatId : "").trim();
    const platform =
      body?.platform || (url.includes("facebook.com") ? "facebook" : "tiktok");
    const cookie = (body?.cookie || "").trim();

    if (!url) {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }
    if (!formatId) {
      return NextResponse.json({ error: "Missing formatId" }, { status: 400 });
    }

    const ytDlp = await getYtDlp();

    // Stream merged media (video+audio) through server.
    // We attempt to get a suggested filename first (non-fatal if it fails).
    let filename = "Downly_video.mp4";
    try {
      const inspectArgs = [
        "-J",
        url,
        "-f",
        formatId,
        "--no-playlist",
        "--retries",
        "3",
        "--geo-bypass",
        "--add-header",
        "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      ];
      if (platform === "tiktok") {
        inspectArgs.push("--add-header", "Referer:https://www.tiktok.com/");
      } else if (platform === "facebook") {
        inspectArgs.push("--add-header", "Referer:https://www.facebook.com/");
        if (cookie) inspectArgs.push("--add-header", `Cookie:${cookie}`);
      }
      const json = await ytDlp.execPromise(inspectArgs);
      const meta = JSON.parse(json) as { id?: string | number };
      const idBase = meta?.id?.toString()?.replace(/[^\w\-\.\s]/g, "_") || "id";
      // We transcode to mp4, force extension mp4 for compatibility
      filename = `Downly_${idBase}.mp4`;
    } catch {}

    // Prepare temp paths
    const baseDir = path.join(process.cwd(), ".next", "cache", "downloads");
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const tmpIn = path.join(baseDir, `${id}_in.mp4`);
    const tmpOut = path.join(baseDir, `${id}_out.mp4`);

    // Step 1: use yt-dlp to download best video+audio and merge into tmpIn
    {
      const args = [
        url,
        "-f",
        `${formatId}+bestaudio/best`,
        "--merge-output-format",
        "mp4",
        "-o",
        tmpIn,
        "--no-part",
        "--quiet",
        "--no-warnings",
        "--retries",
        "3",
        "--add-header",
        "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      ];
      if (platform === "tiktok") {
        args.push("--add-header", "Referer:https://www.tiktok.com/");
      } else if (platform === "facebook") {
        args.push("--add-header", "Referer:https://www.facebook.com/");
        if (cookie) args.push("--add-header", `Cookie:${cookie}`);
      }
      try {
        const ff = getFfmpegPath();
        args.push("--ffmpeg-location", ff);
      } catch {}
      await ytDlp.execPromise(args);
      if (!fs.existsSync(tmpIn)) {
        throw new Error("Failed to produce merged file");
      }
    }

    // Step 2: transcode to H.264/AAC using ffmpeg-static
    const ff = getFfmpegPath();
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ff, [
        "-y",
        "-i",
        tmpIn,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-movflags",
        "+faststart",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        tmpOut,
      ]);
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0 && fs.existsSync(tmpOut)) resolve();
        else reject(new Error(`ffmpeg exited with code ${code}`));
      });
    });

    // Step 3: stream the transcoded file and cleanup afterwards
    const fileStat = fs.statSync(tmpOut);
    const fileStream = fs.createReadStream(tmpOut, { encoding: undefined });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        fileStream.on("data", (chunk) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          controller.enqueue(new Uint8Array(buf));
        });
        fileStream.on("end", () => controller.close());
        fileStream.on("error", (err) => controller.error(err));
      },
      cancel() {
        try {
          fileStream.close();
        } catch {}
      },
    });

    const response = new NextResponse(stream as unknown as BodyInit, {
      status: 200,
      headers: new Headers({
        "Content-Type": "video/mp4",
        "Content-Length": String(fileStat.size),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Download-Response": "1",
      }),
    });

    // Cleanup temp files after response is closed
    (async () => {
      try {
        await new Promise((r) => setTimeout(r, 10000));
        if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn);
        if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
      } catch {}
    })();

    return response;
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error)?.message || "Failed to resolve download url" },
      { status: 500 }
    );
  }
}
