import { NextResponse } from "next/server";

const BASE_URL = process.env.XVERSE_API_BASE_URL;
const URL_TEMPLATE = process.env.XVERSE_BALANCE_URL_TEMPLATE;
const API_KEY = process.env.XVERSE_API_KEY;

function buildUrl(address: string): string | null {
  if (URL_TEMPLATE) {
    return URL_TEMPLATE.replace("{address}", encodeURIComponent(address));
  }

  if (BASE_URL) {
    const separator = BASE_URL.endsWith("/") ? "" : "/";
    return `${BASE_URL}${separator}address/${encodeURIComponent(address)}/balances`;
  }

  return null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");

  if (!address) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }

  const url = buildUrl(address);
  if (!url) {
    return NextResponse.json({
      configured: false,
      message:
        "Set XVERSE_API_BASE_URL or XVERSE_BALANCE_URL_TEMPLATE to enable real read integration.",
      address,
    });
  }

  try {
    const response = await fetch(url, {
      headers: API_KEY
        ? {
            Authorization: `Bearer ${API_KEY}`,
            "x-api-key": API_KEY,
          }
        : undefined,
      cache: "no-store",
    });

    const payload = await response.text();

    if (!response.ok) {
      return NextResponse.json(
        {
          configured: true,
          ok: false,
          upstreamStatus: response.status,
          payload,
        },
        { status: response.status }
      );
    }

    try {
      return NextResponse.json({ configured: true, ok: true, data: JSON.parse(payload) });
    } catch {
      return NextResponse.json({ configured: true, ok: true, data: payload });
    }
  } catch (error) {
    return NextResponse.json(
      {
        configured: true,
        ok: false,
        error: error instanceof Error ? error.message : "xverse fetch failed",
      },
      { status: 502 }
    );
  }
}
