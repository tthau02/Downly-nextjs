import { getYtDlp } from "./yt-dlp";
import { getFfmpegPath } from "./ffmpeg";

export type YoutubeInspect = {
  title?: string;
  thumbnail?: string;
  formats: Array<{
    formatId: string;
    ext?: string;
    resolution?: string;
    fps?: number;
    filesize?: number | null;
    vcodec?: string;
    acodec?: string;
    width?: number;
    height?: number;
  }>;
};

export async function youtubeInspect(url: string): Promise<YoutubeInspect> {
  const ytDlp = await getYtDlp();
  const args = [
    "-J",
    url,
    "--no-playlist",
    "--retries",
    "3",
    "--socket-timeout",
    "15",
    "--force-ipv4",
    "--geo-bypass",
    "--add-header",
    "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "--add-header",
    "Referer:https://www.youtube.com/",
  ];
  const json = await ytDlp.execPromise(args);
  const parsed = JSON.parse(json) as any;

  const title: string = parsed.title ?? "";
  const thumbnail: string | undefined = (() => {
    const arr = Array.isArray(parsed.thumbnails) ? parsed.thumbnails : [];
    const bySize = arr
      .map((t: any) => ({
        url: t?.url,
        area: Number(t?.width || 0) * Number(t?.height || 0),
      }))
      .filter((x: any) => !!x.url)
      .sort((a: any, b: any) => b.area - a.area);
    if (bySize[0]?.url) return bySize[0].url as string;
    if (parsed.thumbnail) return parsed.thumbnail as string;
    if (parsed.id) return `https://i.ytimg.com/vi/${parsed.id}/hqdefault.jpg`;
    return undefined;
  })();

  const formats = Array.isArray(parsed.formats)
    ? parsed.formats
        .filter((f: any) => !!f.format_id)
        .filter((f: any) => f.vcodec && f.vcodec !== "none")
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
          width: typeof f.width === "number" ? f.width : undefined,
          height: typeof f.height === "number" ? f.height : undefined,
        }))
    : [];

  return { title, thumbnail, formats };
}

export function youtubeFormatSelector(formatId: string): string {
  // Prefer H.264 video + m4a audio; fallbacks to best mp4
  return `${formatId}[vcodec~='^(avc1|h264)']+bestaudio[ext=m4a]/${formatId}+bestaudio[ext=m4a]/bestvideo[ext=mp4][vcodec~='^(avc1|h264)']+bestaudio[ext=m4a]/best[ext=mp4]`;
}

export function youtubeCommonArgs(): string[] {
  return [
    "--no-part",
    "--quiet",
    "--no-warnings",
    "--retries",
    "3",
    "--socket-timeout",
    "15",
    "--force-ipv4",
    "--geo-bypass",
    "--add-header",
    "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "--add-header",
    "Referer:https://www.youtube.com/",
    "-N",
    "8",
    "--concurrent-fragments",
    "8",
  ];
}

export function tryPushFfmpeg(args: string[]) {
  try {
    const ff = getFfmpegPath();
    args.push("--ffmpeg-location", ff);
  } catch {}
}
