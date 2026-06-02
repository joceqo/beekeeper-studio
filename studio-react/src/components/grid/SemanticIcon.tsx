import {
  KeyRound,
  Link,
  Workflow,
  ToggleLeft,
  Network,
  CodeXml,
  Palette,
  DollarSign,
  CalendarClock,
  Mail,
  Image,
  Braces,
  Hash,
  Percent,
  Phone,
  Star,
  Globe,
  Type,
} from "lucide-react";
import type { SemanticType } from "@/lib/relations";

/**
 * SlashTable's exact semantic-type → Lucide component mapping (reverse-engineered
 * from their `pickSpriteName`). Shared by the Glide header icons and the
 * DetailPanel field rows (§4).
 */
export const SEMANTIC_LUCIDE: Record<SemanticType, typeof KeyRound> = {
  pk: KeyRound,
  fk: Link,
  relation: Workflow,
  bool: ToggleLeft,
  cidr: Network,
  code: CodeXml,
  color: Palette,
  currency: DollarSign,
  date_relative: CalendarClock,
  email: Mail,
  image_url: Image,
  json: Braces,
  number: Hash,
  percentage: Percent,
  phone: Phone,
  rating: Star,
  url: Globe,
  text: Type,
};

/** Accent for FK/relation, warning for PK, muted otherwise. */
function toneClass(type: SemanticType): string {
  if (type === "pk") return "text-warning";
  if (type === "fk" || type === "relation") return "text-accent";
  return "text-text-muted";
}

/** Small Lucide icon for a column's semantic type (§4), shared by grid + detail. */
export function SemanticIcon({ type, size = 11 }: { type: SemanticType; size?: number }) {
  const Icon = SEMANTIC_LUCIDE[type];
  return <Icon size={size} className={toneClass(type)} />;
}
