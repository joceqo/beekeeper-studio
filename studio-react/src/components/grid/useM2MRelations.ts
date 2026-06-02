import { useEffect, useState } from "react";
import { backend, type TableDescription } from "@/ipc";
import { isJoinTable, m2mRelationsFor, type RelationColumn } from "@/lib/relations";

/**
 * Enrich a table's relation columns by collapsing many-to-many junction tables:
 * each incoming relation whose child table is a detected junction is replaced by
 * one relation per far-side table (labeled with the far table, drilling through
 * the junction). Non-junction relations pass through unchanged.
 *
 * Detection describes each incoming relation's child table once (best-effort);
 * until those resolve the base relations render, then collapse in place. Keeps
 * all three backends working — it only uses describeTable.
 */
export function useM2MRelations(
  connectionId: string,
  baseRelations: RelationColumn[]
): RelationColumn[] {
  const [relations, setRelations] = useState(baseRelations);

  useEffect(() => {
    // Reset to the base list whenever the table (and thus its relations) changes,
    // so a previous table's collapsed relations never linger.
    setRelations(baseRelations);

    const incoming = baseRelations.filter((r) => r.direction === "incoming");
    if (incoming.length === 0) return;

    let cancelled = false;
    Promise.all(
      incoming.map((r) =>
        backend
          .describeTable(connectionId, r.targetTable, r.targetSchema)
          .then((desc) => ({ r, desc }))
          .catch(() => ({ r, desc: null as TableDescription | null }))
      )
    ).then((results) => {
      if (cancelled) return;
      const collapsedById = new Map<string, RelationColumn[]>();
      for (const { r, desc } of results) {
        if (desc && isJoinTable(desc)) {
          const derived = m2mRelationsFor(r, desc);
          if (derived.length > 0) collapsedById.set(r.id, derived);
        }
      }
      if (collapsedById.size === 0) return; // nothing to collapse; keep base
      const next: RelationColumn[] = [];
      for (const r of baseRelations) {
        const collapsed = r.direction === "incoming" ? collapsedById.get(r.id) : undefined;
        if (collapsed) next.push(...collapsed);
        else next.push(r);
      }
      setRelations(next);
    });

    return () => {
      cancelled = true;
    };
  }, [connectionId, baseRelations]);

  return relations;
}
