// ==========================================
// 页面 meta Hook
// ==========================================
import { useEffect } from 'react';

type JsonLd = Record<string, unknown>;

function upsertMetaByName(name: string, content: string) {
  const head = document.head;
  const existing = head.querySelector(`meta[name="${CSS.escape(name)}"]`) as HTMLMetaElement | null;
  const el = existing ?? document.createElement('meta');
  el.setAttribute('name', name);
  el.setAttribute('content', content);
  if (!existing) head.appendChild(el);
}

function upsertMetaByProperty(property: string, content: string) {
  const head = document.head;
  const existing = head.querySelector(`meta[property="${CSS.escape(property)}"]`) as HTMLMetaElement | null;
  const el = existing ?? document.createElement('meta');
  el.setAttribute('property', property);
  el.setAttribute('content', content);
  if (!existing) head.appendChild(el);
}

function upsertLink(rel: string, href: string) {
  const head = document.head;
  const existing = head.querySelector(`link[rel="${CSS.escape(rel)}"]`) as HTMLLinkElement | null;
  const el = existing ?? document.createElement('link');
  el.setAttribute('rel', rel);
  el.setAttribute('href', href);
  if (!existing) head.appendChild(el);
}

function upsertJsonLd(id: string, jsonLd: JsonLd) {
  const head = document.head;
  const existing = head.querySelector(`script#${CSS.escape(id)}`) as HTMLScriptElement | null;
  const el = existing ?? document.createElement('script');
  el.id = id;
  el.type = 'application/ld+json';
  el.text = JSON.stringify(jsonLd);
  if (!existing) head.appendChild(el);
}

export function usePageMeta({
  title,
  description,
  ogImage,
  canonicalPath,
  jsonLd,
  jsonLdId = 'structured-data',
}: {
  title: string;
  description?: string;
  ogImage?: string;
  canonicalPath?: string;
  jsonLd?: JsonLd | null;
  jsonLdId?: string;
}) {
  useEffect(() => {
    document.title = title;

    if (description) {
      upsertMetaByName('description', description);
      upsertMetaByProperty('og:description', description);
      upsertMetaByName('twitter:description', description);
    }

    upsertMetaByProperty('og:title', title);
    upsertMetaByName('twitter:title', title);

    const resolvedOgImage = ogImage || `${window.location.origin}/logos/home.png`;
    upsertMetaByProperty('og:image', resolvedOgImage);
    upsertMetaByName('twitter:image', resolvedOgImage);

    upsertMetaByProperty('og:type', 'website');
    upsertMetaByName('twitter:card', 'summary_large_image');

    const canonicalUrl = canonicalPath
      ? `${window.location.origin}${canonicalPath.startsWith('/') ? canonicalPath : `/${canonicalPath}`}`
      : window.location.href;
    upsertLink('canonical', canonicalUrl);
    upsertMetaByProperty('og:url', canonicalUrl);

    if (jsonLd) {
      upsertJsonLd(jsonLdId, jsonLd);
    } else {
      const existing = document.head.querySelector(`script#${CSS.escape(jsonLdId)}`);
      if (existing) existing.remove();
    }
  }, [canonicalPath, description, jsonLd, jsonLdId, ogImage, title]);
}
