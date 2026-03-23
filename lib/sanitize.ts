// ─── Allowlists ───────────────────────────────────────────────────────────────

const ALLOWED_TAGS = new Set([
    "p", "div", "span", "br",
    "b", "strong", "i", "em",
    "ul", "ol", "li",
    "a",
]);

/** Per-tag allowed attributes */
const ALLOWED_ATTRS: Record<string, string[]> = {
    a: ["href", "target", "rel"],
};

// ─── Core sanitizer ───────────────────────────────────────────────────────────


function sanitizeElement(el: Element): void {
    const children = Array.from(el.childNodes);

    for (const child of children) {
        if (child.nodeType === Node.ELEMENT_NODE) {
            const childEl = child as Element;
            const tag = childEl.tagName.toLowerCase();

            if (!ALLOWED_TAGS.has(tag)) {
                const fragment = document.createDocumentFragment();
                Array.from(childEl.childNodes).forEach((c) => fragment.appendChild(c));
                sanitizeElement(fragment as unknown as Element);
                el.replaceChild(fragment, childEl);
                continue;
            }

            const allowed = new Set(ALLOWED_ATTRS[tag] ?? []);
            Array.from(childEl.attributes).forEach((attr) => {
                if (!allowed.has(attr.name)) childEl.removeAttribute(attr.name);
            });

            if (tag === "a") {
                const href = childEl.getAttribute("href") ?? "";
                if (/^(javascript|data|vbscript):/i.test(href.trim())) {
                    childEl.removeAttribute("href");
                }
                childEl.setAttribute("target", "_blank");
                childEl.setAttribute("rel", "noopener noreferrer");
            }

            sanitizeElement(childEl);
        }
    }
}


export function sanitizeHtml(html: unknown): string {
    if (typeof html !== "string") return "";

    if (!html || !html.trim()) return "";

    if (typeof window === "undefined") {
        return html.replace(/<[^>]*>/g, "");
    }

    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    sanitizeElement(wrapper);

    return wrapper.innerHTML;
}

// ─── URL validator ────────────────────────────────────────────────────────────

export function isValidUrl(url: string): boolean {
    if (!url || !url.trim()) return false;
    try {
        const parsed = new URL(url);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
}

export function normalizeUrl(url: string): string {
    const trimmed = url.trim();
    if (!trimmed) return "";
    if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
    return trimmed;
}