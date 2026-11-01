import { NextResponse } from "next/server";
import { trackPageview } from "@looku/next";

// Server-side page views for every visitor: no cookie, no script.
export function proxy(request, event) {
  trackPageview(request, event);
  return NextResponse.next();
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|.*[.]).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
        { type: "header", key: "sec-purpose", value: "(.*)prefetch(.*)" },
      ],
    },
  ],
};
