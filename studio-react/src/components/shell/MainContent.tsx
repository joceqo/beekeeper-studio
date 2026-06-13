import { useTabsStore } from "@/store/tabs";
import { TableView } from "@/components/grid/TableView";
import { RelationView } from "@/components/grid/RelationView";
import { SchemaGraphView } from "@/components/grid/SchemaGraphView";
import { QueryEditor } from "@/components/editor/QueryEditor";
import { ConnectionScreen } from "@/components/connection/ConnectionScreen";

export function MainContent() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const tab = tabs.find((t) => t.id === activeId);

  if (!tab) {
    return (
      <div className="flex h-full items-center justify-center text-md text-text-muted">
        No tab open. Use the + button to start a query.
      </div>
    );
  }

  if (tab.kind === "table") {
    return (
      <TableView
        key={tab.id}
        tabId={tab.id}
        connectionId={tab.connectionId!}
        schema={tab.schema!}
        table={tab.table!}
      />
    );
  }

  if (tab.kind === "relation") {
    return (
      <RelationView
        key={tab.id}
        tabId={tab.id}
        connectionId={tab.connectionId!}
        path={tab.path ?? []}
      />
    );
  }

  if (tab.kind === "graph") {
    return (
      <SchemaGraphView
        key={tab.id}
        connectionId={tab.connectionId!}
        schema={tab.schema}
        rootTable={tab.rootTable}
        rootSchema={tab.rootSchema}
      />
    );
  }

  if (tab.kind === "query") {
    return <QueryEditor key={tab.id} tabId={tab.id} sql={tab.sql ?? ""} />;
  }

  return (
    <ConnectionScreen
      key={tab.id}
      editConnectionId={tab.editConnectionId}
      duplicateConnectionId={tab.duplicateConnectionId}
    />
  );
}
