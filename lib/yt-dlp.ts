import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import YTDlpWrap from "yt-dlp-wrap";

let cachedYtDlp: YTDlpWrap | null = null;

function getBinaryPath(): string {
  const isWin = process.platform === "win32";
  const binName = isWin ? "yt-dlp.exe" : "yt-dlp";
  // Prefer explicit env override, then serverless tmp, then OS tmp, else local .next/cache
  const cwd = process.cwd();
  const explicitDir = process.env.YTDLP_CACHE_DIR || process.env.YT_DLP_DIR;
  const isServerless =
    !!process.env.VERCEL ||
    !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
    cwd.startsWith("/var/task");

  let baseTmp = explicitDir || (isServerless ? "/tmp" : undefined);
  if (!baseTmp) {
    // In production or unknown environments, prefer OS tmp to avoid read-only FS
    baseTmp =
      process.env.NODE_ENV === "production"
        ? os.tmpdir()
        : path.join(cwd, ".next", "cache");
  }

  let binDir = path.join(baseTmp, "yt-dlp");
  if (!fs.existsSync(binDir)) {
    try {
      fs.mkdirSync(binDir, { recursive: true });
    } catch (error) {
      // Fallback to OS tmp if the chosen location is not writable (e.g., /var/task)
      const fallback = path.join(os.tmpdir(), "yt-dlp");
      if (!fs.existsSync(fallback)) {
        fs.mkdirSync(fallback, { recursive: true });
      }
      binDir = fallback;
    }
  }

  return path.join(binDir, binName);
}

export async function getYtDlp(): Promise<YTDlpWrap> {
  if (cachedYtDlp) return cachedYtDlp;

  const binPath = getBinaryPath();
  if (!fs.existsSync(binPath)) {
    await YTDlpWrap.downloadFromGithub(binPath);
  }

  cachedYtDlp = new YTDlpWrap(binPath);
  return cachedYtDlp;
}
