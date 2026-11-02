import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LucideIcon } from "lucide-react";
import { ImageResponse } from "next/og";
import { createElement, isValidElement, type ReactNode } from "react";

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

const CHIPS = ["100% client side", "No uploads", "Works offline"];

// Fonts come from a locally installed package: no network at build time.
async function loadFont(weight: 400 | 700 | 800): Promise<ArrayBuffer> {
  const file = path.join(
    process.cwd(),
    "node_modules/@fontsource/inter/files",
    `inter-latin-${weight}-normal.woff`,
  );
  const buf = await readFile(file);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

type IconNode = [string, Record<string, string>][];

interface ForwardRefLike {
  render: (props: Record<string, unknown>, ref: null) => unknown;
}

function isForwardRef(t: unknown): t is ForwardRefLike {
  return (
    typeof t === "object" &&
    t !== null &&
    typeof (t as ForwardRefLike).render === "function"
  );
}

/**
 * lucide icons are client components, which cannot be rendered here. Their
 * forwardRef wrapper still hands the raw SVG node list to the inner Icon, so
 * read it from there and draw plain <svg> elements, which satori understands.
 */
function renderIcon(icon: LucideIcon, size: number): ReactNode {
  if (!isForwardRef(icon)) return null;
  const el = icon.render({}, null);
  if (!isValidElement(el)) return null;
  const props = el.props as { iconNode?: IconNode; icon?: { node?: IconNode } };
  // lucide-react >= 1 passes `icon: { node }`; older versions pass `iconNode`.
  const node = props.icon?.node ?? props.iconNode;
  if (!Array.isArray(node)) return null;
  return createElement(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "#e6edf3",
      strokeWidth: 1.75,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    ...node.map(([tag, attrs], i) => {
      const { key: _key, ...rest } = attrs;
      void _key;
      return createElement(tag, { ...rest, key: i });
    }),
  );
}

interface CardOptions {
  title: string;
  tagline: string;
  icon: LucideIcon;
}

/** GitHub-style social preview card, 1200x630. */
export async function renderOgCard({ title, tagline, icon }: CardOptions) {
  const [regular, bold, extra] = await Promise.all([
    loadFont(400),
    loadFont(700),
    loadFont(800),
  ]);
  const grid = "rgba(139,148,158,0.10)";
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          padding: 28,
          background: "#010409",
          fontFamily: "Inter",
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "52px 64px",
            borderRadius: 28,
            border: "2px solid #30363d",
            backgroundColor: "#0d1117",
            backgroundImage: `radial-gradient(circle at 85% 15%, rgba(56,139,253,0.22), rgba(13,17,23,0) 55%), linear-gradient(${grid} 1px, transparent 1px), linear-gradient(90deg, ${grid} 1px, transparent 1px)`,
            backgroundSize: "100% 100%, 48px 48px, 48px 48px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 44,
                fontWeight: 800,
                color: "#e6edf3",
                letterSpacing: -1,
              }}
            >
              pdf<span style={{ color: "#7d8590" }}>kit</span>
            </div>
            <div style={{ display: "flex" }}>{renderIcon(icon, 96)}</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                fontSize: 92,
                fontWeight: 800,
                lineHeight: 1.05,
                color: "#f0f6fc",
                letterSpacing: -2,
              }}
            >
              {title}
            </div>
            <div
              style={{
                display: "flex",
                marginTop: 20,
                fontSize: 36,
                color: "#9198a1",
                maxWidth: 940,
              }}
            >
              {tagline}
            </div>
          </div>

          <div style={{ display: "flex", gap: 14 }}>
            {CHIPS.map((chip) => (
              <div
                key={chip}
                style={{
                  display: "flex",
                  padding: "10px 22px",
                  borderRadius: 999,
                  border: "1.5px solid #3d444d",
                  backgroundColor: "rgba(110,118,129,0.18)",
                  color: "#c9d1d9",
                  fontSize: 26,
                  fontWeight: 700,
                }}
              >
                {chip}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: "Inter", data: regular, weight: 400, style: "normal" },
        { name: "Inter", data: bold, weight: 700, style: "normal" },
        { name: "Inter", data: extra, weight: 800, style: "normal" },
      ],
    },
  );
}
