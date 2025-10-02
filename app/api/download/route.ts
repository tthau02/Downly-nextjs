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
  output?: "mp4" | "mp3";
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as DownloadRequestBody;
    const url = (body && body.url ? body.url : "").trim();
    const formatId = (body && body.formatId ? body.formatId : "").trim();
    const platform =
      body?.platform || (url.includes("facebook.com") ? "facebook" : "tiktok");
    const cookie = (body?.cookie || "").trim();
    const output: "mp4" | "mp3" = body?.output === "mp3" ? "mp3" : "mp4";

    if (!url) {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }
    if (!formatId) {
      return NextResponse.json({ error: "Missing formatId" }, { status: 400 });
    }

    const ytDlp = await getYtDlp();

    // Stream file through server.
    // We attempt to get a suggested filename first (non-fatal if it fails).
    let filename = output === "mp3" ? "Downly_audio.mp3" : "Downly_video.mp4";
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
      filename = `Downly_${idBase}.${output === "mp3" ? "mp3" : "mp4"}`;
    } catch {}

    // Prepare temp paths
    const baseTmp =
      process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
        ? "/tmp"
        : path.join(process.cwd(), ".next", "cache");
    const baseDir = path.join(baseTmp, "downloads");
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const tmpIn = path.join(
      baseDir,
      `${id}_in.${output === "mp3" ? "m4a" : "mp4"}`
    );
    const tmpOut = path.join(
      baseDir,
      `${id}_out.${output === "mp3" ? "mp3" : "mp4"}`
    );

    // Step 1: download
    if (output === "mp3") {
      // Extract best audio to mp3 using yt-dlp (uses ffmpeg under the hood)
      const args = [
        url,
        "-f",
        "bestaudio/best",
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "0",
        "-o",
        tmpOut,
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
      if (!fs.existsSync(tmpOut)) {
        throw new Error("Failed to produce mp3 file");
      }
    } else {
      // MP4 merged
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

    // Step 2: if mp4 we can skip transcode; if mp3 already done
    if (output === "mp4") {
      try {
        // If container not mp4/h264, attempt fast mp4 rewrite
        const ff = getFfmpegPath();
        await new Promise<void>((resolve, reject) => {
          const proc = spawn(ff, [
            "-y",
            "-i",
            tmpIn,
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-movflags",
            "+faststart",
            tmpOut,
          ]);
          proc.on("error", reject);
          proc.on("close", (code) => {
            if (code === 0 && fs.existsSync(tmpOut)) resolve();
            else resolve();
          });
        });
      } catch {}
    }

    const finalPath =
      output === "mp3" ? tmpOut : fs.existsSync(tmpOut) ? tmpOut : tmpIn;
    const fileStat = fs.statSync(finalPath);
    const fileStream = fs.createReadStream(finalPath, { encoding: undefined });
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
        "Content-Type": output === "mp3" ? "audio/mpeg" : "video/mp4",
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
