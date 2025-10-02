import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import ffmpegStatic from "ffmpeg-static";

let cachedPath: string | null = null;

export function getFfmpegPath(): string {
  if (cachedPath) return cachedPath;

  // Explicit override via env
  const envOverride = process.env.FFMPEG_PATH;
  if (envOverride && fs.existsSync(envOverride)) {
    cachedPath = envOverride;
    return cachedPath;
  }

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
    // Try to download a platform static binary into a writable cache
    const baseTmp =
      process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
        ? "/tmp"
        : path.join(cwd, ".next", "cache");
    const targetDir = path.join(
      process.env.FFMPEG_CACHE_DIR || baseTmp,
      "ffmpeg"
    );
    const targetPath = path.join(targetDir, binName);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    try {
      if (!fs.existsSync(targetPath) || !isValidBinary(targetPath)) {
        try {
          if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
        } catch {}
        downloadFfmpegBinary(targetPath);
      }
      sourcePath = targetPath;
    } catch {
      throw new Error("FFmpeg binary not found from ffmpeg-static");
    }
  }

  const baseTmp =
    process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
      ? "/tmp"
      : path.join(cwd, ".next", "cache");
  const targetDir = path.join(
    process.env.FFMPEG_CACHE_DIR || baseTmp,
    "ffmpeg"
  );
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

function getFfmpegDownloadUrl(): string {
  const platform = process.platform;
  if (platform === "win32") {
    return "https://github.com/eugeneware/ffmpeg-static/releases/latest/download/ffmpeg.exe";
  }
  if (platform === "darwin") {
    return "https://github.com/eugeneware/ffmpeg-static/releases/latest/download/ffmpeg-mac";
  }
  // linux x64 static
  return "https://github.com/eugeneware/ffmpeg-static/releases/latest/download/ffmpeg-linux-x64";
}

function downloadFfmpegBinary(destinationPath: string): void {
  const startUrl = getFfmpegDownloadUrl();
  const maxRedirects = 5;

  const download = (url: string, redirectsLeft: number) => {
    const fileStream = fs.createWriteStream(destinationPath, { mode: 0o755 });
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": "Downly/1.0 (+ffmpeg-static)",
          Accept: "*/*",
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          if (redirectsLeft <= 0) {
            fileStream.close();
            try {
              fs.unlinkSync(destinationPath);
            } catch {}
            throw new Error("Failed to download ffmpeg: too many redirects");
          }
          const nextUrl = new URL(res.headers.location, url).toString();
          res.resume();
          fileStream.close();
          download(nextUrl, redirectsLeft - 1);
          return;
        }
        if (status !== 200) {
          fileStream.close();
          try {
            fs.unlinkSync(destinationPath);
          } catch {}
          throw new Error(`Failed to download ffmpeg: HTTP ${status}`);
        }
        res.pipe(fileStream);
        fileStream.on("finish", () => {
          fileStream.close(() => {
            if (process.platform !== "win32") {
              try {
                fs.chmodSync(destinationPath, 0o755);
              } catch {}
            }
            if (!isValidBinary(destinationPath)) {
              try {
                fs.unlinkSync(destinationPath);
              } catch {}
              throw new Error("Downloaded ffmpeg is not a valid binary");
            }
          });
        });
      }
    );
    req.on("error", (err) => {
      try {
        fs.unlinkSync(destinationPath);
      } catch {}
      throw err;
    });
  };

  download(startUrl, maxRedirects);
}

function isValidBinary(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, "r");
    const header = Buffer.alloc(4);
    fs.readSync(fd, header, 0, 4, 0);
    fs.closeSync(fd);
    if (process.platform === "win32") {
      return header[0] === 0x4d && header[1] === 0x5a; // 'MZ'
    }
    if (process.platform === "darwin") {
      const val = header.readUInt32BE(0);
      return (
        val === 0xfeedface ||
        val === 0xfeedfacf ||
        val === 0xcafebabe ||
        val === 0xbebafeca
      );
    }
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
