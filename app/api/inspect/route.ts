import { NextResponse } from "next/server";
import { getYtDlp } from "@/lib/yt-dlp";

type InspectRequestBody = {
  url?: string;
  platform?: "tiktok" | "facebook";
  cookie?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as InspectRequestBody;
    const url = (body && body.url ? body.url : "").trim();
    const platform =
      body?.platform || (url.includes("facebook.com") ? "facebook" : "tiktok");
    const cookie = (body?.cookie || "").trim();

    if (!url) {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }

    const ytDlp = await getYtDlp();
    const args = [
      "-J",
      url,
      "--no-playlist",
      "--retries",
      "3",
      "--geo-bypass",
      "--add-header",
      "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    ];
    if (platform === "tiktok") {
      args.push("--add-header", "Referer:https://www.tiktok.com/");
    } else if (platform === "facebook") {
      args.push("--add-header", "Referer:https://www.facebook.com/");
      if (cookie) args.push("--add-header", `Cookie:${cookie}`);
    }
    const result = await ytDlp.execPromise(args);

    const parsed = JSON.parse(result) as any;

    const title: string = parsed.title ?? "";
    const thumbnail: string | undefined = Array.isArray(parsed.thumbnails)
      ? parsed.thumbnails[parsed.thumbnails.length - 1]?.url
      : parsed.thumbnail;

    const formats = Array.isArray(parsed.formats)
      ? parsed.formats
          .filter((f: any) => !!f.format_id)
          .filter((f: any) => {
            const hasVideo = f.vcodec && f.vcodec !== "none";
            const hasAudio = f.acodec && f.acodec !== "none";
            return platform === "facebook" ? hasVideo : hasVideo && hasAudio;
          })
          .map((f: any) => ({
            formatId: String(f.format_id),
            ext: f.ext,
            resolution:
              f.resolution ||
              (f.height ? `${f.height}p` : undefined) ||
              (f.width && f.height ? `${f.width}x${f.height}` : undefined) ||
              undefined,
            fps: f.fps,
            filesize: f.filesize || f.filesize_approx || null,
            vcodec: f.vcodec,
            acodec: f.acodec,
            formatNote: f.format_note,
            width: typeof f.width === "number" ? f.width : undefined,
            height: typeof f.height === "number" ? f.height : undefined,
          }))
      : [];

    return NextResponse.json({ title, thumbnail, formats });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to inspect url" },
      { status: 500 }
    );
  }
}
