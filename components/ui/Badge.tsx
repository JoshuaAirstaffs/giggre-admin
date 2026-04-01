type BadgeVariant =
  | "blue"
  | "green"
  | "amber"
  | "red"
  | "purple"
  | "gray"
  | "orange"
  | "teal"
  | "pink"
  | "indigo";

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  dot?: boolean;
}

const VARIANT_STYLES: Record<BadgeVariant, { bg: string; text: string }> = {
  blue:   { bg: "var(--blue-dim)",   text: "var(--blue)"   },
  green:  { bg: "var(--green-dim)",  text: "var(--green)"  },
  amber:  { bg: "var(--amber-dim)",  text: "var(--amber)"  },
  red:    { bg: "var(--red-dim)",    text: "var(--red)"    },
  purple: { bg: "var(--purple-dim)", text: "var(--purple)" },
  orange: { bg: "var(--orange-dim)", text: "var(--orange)" },
  gray:   { bg: "var(--bg-elevated)", text: "var(--text-secondary)" },
  teal:   { bg: "rgba(13,148,136,0.12)",  text: "var(--teal, #0d9488)"  },
  pink:   { bg: "rgba(236,72,153,0.12)",  text: "var(--pink, #ec4899)"  },
  indigo: { bg: "rgba(99,102,241,0.12)",  text: "var(--indigo, #6366f1)" },
};

export default function Badge({
  children,
  variant = "gray",
  dot = false,
}: BadgeProps) {
  const { bg, text } = VARIANT_STYLES[variant];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        background: bg,
        color: text,
        fontSize: 11,
        fontWeight: 700,
        padding: "3px 9px",
        borderRadius: 20,
        textTransform: "capitalize",
        whiteSpace: "nowrap",
        letterSpacing: "0.2px",
      }}
    >
      {dot && (
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: text,
            flexShrink: 0,
          }}
        />
      )}
      {children}
    </span>
  );
}
