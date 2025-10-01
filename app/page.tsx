"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type FormatItem = {
  formatId: string;
  ext?: string;
  resolution?: string;
  fps?: number;
  filesize?: number | null;
  vcodec?: string;
  acodec?: string;
  formatNote?: string;
  width?: number;
  height?: number;
};

export default function Home() {
  const [url, setUrl] = useState("");
  const [platform, setPlatform] = useState<"tiktok" | "facebook">("tiktok");
  const [cookie, setCookie] = useState("");
  const [loading, setLoading] = useState(false);
  const [formats, setFormats] = useState<FormatItem[]>([]);
  const [title, setTitle] = useState("");
  const [thumbnail, setThumbnail] = useState<string | undefined>();
  const [selectedFormat, setSelectedFormat] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const hasResult = formats.length > 0;

  // keep for future advanced UI sorting if needed
  // const sortedFormats = useMemo(() => {
  //   return [...formats].sort((a, b) => {
  //     const getHeight = (r?: string) => {
  //       if (!r) return 0;
  //       const m = r.match(/(\d+)p/);
  //       return m ? parseInt(m[1], 10) : 0;
  //     };
  //     return getHeight(b.resolution) - getHeight(a.resolution);
  //   });
  // }, [formats]);

  // Build simplified quality choices: Gốc/best, 1080p, 720p, 360p
  const qualityOptions = useMemo(() => {
    const heightOf = (f: FormatItem) =>
      typeof f.height === "number"
        ? f.height
        : (() => {
            const m = f.resolution?.match(/(\d+)p/);
            return m ? parseInt(m[1], 10) : 0;
          })();
    const withHeights = formats
      .map((f) => ({ ...f, _h: heightOf(f) }))
      .filter((f) => f._h > 0)
      .sort((a, b) => b._h - a._h);
    const pickAtOrBelow = (max?: number) => {
      if (!withHeights.length) return undefined;
      if (!max) return withHeights[0];
      const eligible = withHeights.filter((f) => f._h <= max);
      return eligible.length
        ? eligible[0]
        : withHeights[withHeights.length - 1];
    };
    return {
      best: pickAtOrBelow(undefined),
      p1080: pickAtOrBelow(1080),
      p720: pickAtOrBelow(720),
      p360: pickAtOrBelow(360),
    } as const;
  }, [formats]);

  const qualitySelectItems = useMemo(() => {
    const entries: { id: string; label: string }[] = [];
    if (qualityOptions.best)
      entries.push({
        id: qualityOptions.best.formatId,
        label: "Gốc (tốt nhất)",
      });
    if (qualityOptions.p1080)
      entries.push({ id: qualityOptions.p1080.formatId, label: "1080p" });
    if (qualityOptions.p720)
      entries.push({ id: qualityOptions.p720.formatId, label: "720p" });
    if (qualityOptions.p360)
      entries.push({ id: qualityOptions.p360.formatId, label: "360p" });
    const seen = new Set<string>();
    const unique: { id: string; label: string }[] = [];
    for (const e of entries) {
      if (!seen.has(e.id)) {
        seen.add(e.id);
        unique.push(e);
      }
    }
    return unique;
  }, [qualityOptions]);

  useEffect(() => {
    if (!selectedFormat && qualitySelectItems.length) {
      setSelectedFormat(qualitySelectItems[0].id);
    }
  }, [qualitySelectItems, selectedFormat]);

  async function handleInspect() {
    setError(null);
    setLoading(true);
    setFormats([]);
    setTitle("");
    setThumbnail(undefined);
    setSelectedFormat("");
    try {
      const res = await fetch("/api/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          platform,
          cookie: platform === "facebook" ? cookie : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to inspect");
      setFormats(data.formats || []);
      setTitle(data.title || "");
      setThumbnail(data.thumbnail);
      // Auto-select "Gốc" nếu có sau khi phân tích
      setTimeout(() => {
        if (Array.isArray(data.formats) && data.formats.length) {
          type R = { formatId: string; height?: number; resolution?: string };
          const heightOf = (f: R) =>
            typeof f.height === "number"
              ? f.height
              : (() => {
                  const m = f.resolution?.match(/(\d+)p/);
                  return m ? parseInt(m[1], 10) : 0;
                })();
          const best = [...(data.formats as R[])]
            .map((f) => ({ ...f, _h: heightOf(f) }))
            .sort((a, b) => (b._h || 0) - (a._h || 0))[0];
          if (best?.formatId) setSelectedFormat(best.formatId);
        }
      }, 0);
    } catch (e) {
      setError((e as Error)?.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload() {
    setError(null);
    if (!selectedFormat) {
      setError("Vui lòng chọn độ phân giải/format");
      return;
    }
    try {
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          formatId: selectedFormat,
          platform,
          cookie: platform === "facebook" ? cookie : undefined,
        }),
      });
      if (!res.ok) {
        const maybeJson = await res.json().catch(() => null);
        const message =
          maybeJson?.error || `Tải xuống thất bại (${res.status})`;
        throw new Error(message);
      }

      const blob = await res.blob();
      const downloadUrl = URL.createObjectURL(blob);

      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?([^";]+)"?/i);
      const suggested = match ? match[1] : "video.mp4";

      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = suggested;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000);
    } catch (e) {
      setError((e as Error)?.message || "Tải xuống thất bại");
    }
  }

  return (
    <div className="min-h-screen grid grid-rows-[auto_1fr_auto]">
      <header className="border-b">
        <div className="mx-auto max-w-4xl px-4 py-4 flex items-center justify-between">
          <div className="font-semibold">Downly</div>
          <div className="text-sm opacity-70">TikTok, Facebook Reels, ...</div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl w-full px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>Nhập liên kết video</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <div className="grid gap-2 md:grid-cols-3">
                <div className="grid gap-2">
                  <Label>Nền tảng</Label>
                  <Select
                    value={platform}
                    onValueChange={(v) =>
                      setPlatform(v as "tiktok" | "facebook")
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Chọn nền tảng" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tiktok">TikTok</SelectItem>
                      <SelectItem value="facebook">Facebook Reels</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="videoUrl">Liên kết</Label>
                <div className="flex gap-2">
                  <Input
                    id="videoUrl"
                    placeholder="Dán link TikTok, Facebook Reels..."
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                  <Button onClick={handleInspect} disabled={loading || !url}>
                    {loading ? "Đang phân tích..." : "Phân tích"}
                  </Button>
                </div>
              </div>

              {error && <div className="text-red-600 text-sm">{error}</div>}

              {platform === "facebook" && (
                <div className="grid gap-2">
                  <Label htmlFor="cookie">
                    Cookie (tùy chọn, để lấy video riêng tư)
                  </Label>
                  <Input
                    id="cookie"
                    placeholder="dán giá trị header Cookie..."
                    value={cookie}
                    onChange={(e) => setCookie(e.target.value)}
                  />
                </div>
              )}

              {hasResult && (
                <div className="grid md:grid-cols-[200px_1fr] gap-4 items-start">
                  {thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumbnail}
                      alt="thumbnail"
                      className="rounded-md w-full max-w-[200px]"
                    />
                  ) : (
                    <div className="h-[112px] bg-black/5 rounded-md" />
                  )}

                  <div className="grid gap-3">
                    <div className="font-medium">{title || "Video"}</div>
                    <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                      <Select
                        value={selectedFormat}
                        onValueChange={setSelectedFormat}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Chọn chất lượng" />
                        </SelectTrigger>
                        <SelectContent>
                          {qualitySelectItems.map((q) => (
                            <SelectItem key={q.id} value={q.id}>
                              {q.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        onClick={handleDownload}
                        disabled={!selectedFormat}
                      >
                        Tải xuống
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </main>
      <footer className="border-t">
        <div className="mx-auto max-w-4xl px-4 py-4 text-sm opacity-70">
          © {new Date().getFullYear()} Downly
        </div>
      </footer>
    </div>
  );
}
