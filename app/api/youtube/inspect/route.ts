import { NextResponse } from "next/server";
import { youtubeInspect } from "@/lib/youtube";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { url?: string };
    const url = (body?.url || "").trim();
    if (!url || (!url.includes("youtube.com") && !url.includes("youtu.be"))) {
      return NextResponse.json(
        { error: "Invalid YouTube url" },
        { status: 400 }
      );
    }
    const data = await youtubeInspect(url);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error)?.message || "Failed to inspect YouTube" },
      { status: 500 }
    );
  }
}
