import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import YTDlpWrap from "yt-dlp-wrap";
import https from "node:https";

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
    } catch {
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
  if (!fs.existsSync(binPath) || !isValidBinary(binPath)) {
    try {
      if (fs.existsSync(binPath)) fs.unlinkSync(binPath);
    } catch {}
    await downloadStandaloneBinary(binPath);
  }

  cachedYtDlp = new YTDlpWrap(binPath);
  return cachedYtDlp;
}

function getDownloadUrlForPlatform(): string {
  const platform = process.platform;
  if (platform === "win32") {
    return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
  }
  if (platform === "darwin") {
    return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos";
  }
  // linux standalone (ELF)
  return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";
}

async function downloadStandaloneBinary(
  destinationPath: string
): Promise<void> {
  const startUrl = getDownloadUrlForPlatform();
  const maxRedirects = 5;

  await new Promise<void>((resolve, reject) => {
    const fileStream = fs.createWriteStream(destinationPath, { mode: 0o755 });

    const requestWithRedirects = (url: string, redirectsLeft: number) => {
      const req = https.get(
        url,
        {
          headers: {
            "User-Agent": "Downly/1.0 (+yt-dlp)",
            Accept: "*/*",
          },
        },
        (res) => {
          const status = res.statusCode || 0;
          if (status >= 300 && status < 400 && res.headers.location) {
            if (redirectsLeft <= 0) {
              reject(
                new Error("Failed to download yt-dlp: too many redirects")
              );
              return;
            }
            const nextUrl = new URL(res.headers.location, url).toString();
            res.resume();
            requestWithRedirects(nextUrl, redirectsLeft - 1);
            return;
          }

          if (status !== 200) {
            reject(new Error(`Failed to download yt-dlp: HTTP ${status}`));
            return;
          }
          res.pipe(fileStream);
          fileStream.on("finish", () => {
            fileStream.close(() => {
              tryMakeExecutable(destinationPath);
              resolve();
            });
          });
        }
      );
      req.on("error", (err) => {
        try {
          if (fs.existsSync(destinationPath)) fs.unlinkSync(destinationPath);
        } catch {}
        reject(err);
      });
    };

    requestWithRedirects(startUrl, maxRedirects);
  });
}

function tryMakeExecutable(filePath: string): void {
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(filePath, 0o755);
    } catch {}
  }
}

function isValidBinary(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, "r");
    const header = Buffer.alloc(4);
    fs.readSync(fd, header, 0, 4, 0);
    fs.closeSync(fd);
    if (process.platform === "win32") {
      // 'MZ' header
      return header[0] === 0x4d && header[1] === 0x5a;
    }
    if (process.platform === "darwin") {
      // Mach-O headers
      const val = header.readUInt32BE(0);
      return (
        val === 0xfeedface ||
        val === 0xfeedfacf ||
        val === 0xcafebabe ||
        val === 0xbebafeca
      );
    }
    // Linux: ELF
    return (
      header[0] === 0x7f &&
      header[1] === 0x45 &&
      header[2] === 0x4c &&
      header[3] === 0x46
    );
  } catch {
    return false;
  }
}
