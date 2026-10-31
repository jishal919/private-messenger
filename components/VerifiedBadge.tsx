import { BadgeCheck } from "lucide-react";

export default function VerifiedBadge({
  size = 16,
}: {
  size?: number;
}) {
  return (
    <span
      className="verified-badge"
      role="img"
      aria-label="Verified account"
      title="Verified account"
    >
      <BadgeCheck
        size={size}
        strokeWidth={2.4}
        fill="#1877f2"
        aria-hidden="true"
      />
    </span>
  );
}
