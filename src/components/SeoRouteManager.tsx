import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const SITE_URL = "https://www.rogersroofingtx.com";
const HOME_TITLE = "San Antonio Roofing Contractor | Roger's Roofing";
const HOME_DESCRIPTION =
  "San Antonio roofing contractor for roof repair, replacement, inspections, storm damage, and new roofs. Request a free estimate from Roger's Roofing.";
const INDEX_DIRECTIVES =
  "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";
const NO_INDEX_DIRECTIVES = "noindex, nofollow, noarchive";

function upsertMeta(name: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(
    `meta[name="${name}"]`
  );

  if (!element) {
    element = document.createElement("meta");
    element.name = name;
    document.head.appendChild(element);
  }

  element.content = content;
}

function upsertCanonical(href: string) {
  let element = document.head.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]'
  );

  if (!element) {
    element = document.createElement("link");
    element.rel = "canonical";
    document.head.appendChild(element);
  }

  element.href = href;
}

export default function SeoRouteManager() {
  const { pathname } = useLocation();

  useEffect(() => {
    const isHomePage = pathname === "/";
    const isCustomerDocument =
      pathname.startsWith("/estimate/") || pathname.startsWith("/invoice/");
    document.documentElement.lang = "en-US";
    document.title = isHomePage
      ? HOME_TITLE
      : isCustomerDocument
        ? "Secure Customer Document | Roger's Roofing"
        : "Private Workspace | Roger's Roofing";

    upsertMeta(
      "description",
      isHomePage
        ? HOME_DESCRIPTION
        : "Secure Roger's Roofing customer document and operations workspace."
    );
    upsertMeta(
      "robots",
      isHomePage ? INDEX_DIRECTIVES : NO_INDEX_DIRECTIVES
    );
    upsertMeta(
      "googlebot",
      isHomePage ? INDEX_DIRECTIVES : NO_INDEX_DIRECTIVES
    );

    if (isHomePage) {
      upsertCanonical(`${SITE_URL}/`);
    } else {
      document.head
        .querySelector<HTMLLinkElement>('link[rel="canonical"]')
        ?.remove();
    }
  }, [pathname]);

  return null;
}
