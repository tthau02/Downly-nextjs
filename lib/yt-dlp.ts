import fs from "node:fs";
import path from "node:path";
import YTDlpWrap from "yt-dlp-wrap";

let cachedYtDlp: YTDlpWrap | null = null;

function getBinaryPath(): string {
  const isWin = process.platform === "win32";
  const binName = isWin ? "yt-dlp.exe" : "yt-dlp";
  // Use /tmp on serverless (Vercel). On Windows dev, fallback to .next/cache
  const baseTmp =
    process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
      ? "/tmp"
      : path.join(process.cwd(), ".next", "cache");
  const binDir = path.join(baseTmp, "yt-dlp");
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
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
