import fs from "node:fs";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

let cachedPath: string | null = null;

export function getFfmpegPath(): string {
  if (cachedPath) return cachedPath;

  const isWin = process.platform === "win32";
  const binName = isWin ? "ffmpeg.exe" : "ffmpeg";
  const cwd = process.cwd();

  const candidates: string[] = [];
  if (ffmpegStatic) candidates.push(ffmpegStatic.toString());
  candidates.push(
    path.join(cwd, "node_modules", "ffmpeg-static", binName),
    path.join(cwd, "node_modules", "ffmpeg-static", "ffmpeg"),
    path.join(cwd, "node_modules", ".bin", isWin ? "ffmpeg.cmd" : "ffmpeg")
  );

  let sourcePath = "";
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) {
        sourcePath = p;
        break;
      }
    } catch {}
  }

  if (!sourcePath) {
    throw new Error("FFmpeg binary not found from ffmpeg-static");
  }

  const targetDir = path.join(cwd, ".next", "cache", "ffmpeg");
  const targetPath = path.join(targetDir, binName);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  try {
    if (!fs.existsSync(targetPath)) {
      fs.copyFileSync(sourcePath, targetPath);
      try {
        fs.chmodSync(targetPath, 0o755);
      } catch {}
    }
    cachedPath = targetPath;
  } catch {
    // If copy fails (e.g. permission), use original path
    cachedPath = sourcePath;
  }

  return cachedPath;
}
