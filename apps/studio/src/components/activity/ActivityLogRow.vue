<template>
  <div
    class="activity-row activity-body-row"
    :class="{ expanded: isExpanded }"
    @click="toggle"
  >
    <div class="activity-cell col-time" :title="fullTime">
      {{ time }}
    </div>
    <div class="activity-cell col-ctg">
      <span class="activity-cat-badge" :class="categoryClass">{{ source.category }}</span>
    </div>
    <div class="activity-cell col-op">
      {{ source.op || '' }}
    </div>
    <div class="activity-cell col-conn truncate" :title="source.connection">
      {{ source.connection || '' }}
    </div>
    <div class="activity-cell col-tables truncate" :title="source.tables">
      {{ source.tables || '' }}
    </div>
    <div class="activity-cell col-sql" :class="{ truncate: !isExpanded }" :title="isExpanded ? '' : source.sql">
      {{ source.sql || '' }}
    </div>
    <div class="activity-cell col-dur">
      {{ duration }}
    </div>
    <div class="activity-cell col-rows">
      {{ rows }}
    </div>
  </div>
</template>

<script lang="ts">
import Vue, { PropType } from "vue";
import { ActivityEntry, ActivityCategory } from "@/lib/activity/ActivityLog";

const CATEGORY_CLASS: Record<ActivityCategory, string> = {
  SQL: "cat-sql",
  App: "cat-app",
  MCP: "cat-mcp",
  User: "cat-user",
  System: "cat-system",
  Connections: "cat-connections",
};

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

export default Vue.extend({
  name: "ActivityLogRow",
  props: {
    source: {
      type: Object as PropType<ActivityEntry>,
      required: true,
    },
    expandedIds: {
      type: Array as PropType<number[]>,
      default: () => [],
    },
    onToggle: {
      type: Function as PropType<(id: number) => void>,
      default: undefined,
    },
  },
  computed: {
    isExpanded(): boolean {
      return this.expandedIds.includes(this.source.id);
    },
    categoryClass(): string {
      return CATEGORY_CLASS[this.source.category] || "cat-system";
    },
    time(): string {
      const d = new Date(this.source.time);
      return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(
        d.getSeconds()
      )}.${pad(d.getMilliseconds(), 3)}`;
    },
    fullTime(): string {
      return new Date(this.source.time).toLocaleString();
    },
    duration(): string {
      const ms = this.source.durationMs;
      if (ms == null) return "";
      if (ms < 1000) return `${Math.round(ms)}ms`;
      return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
    },
    rows(): string {
      return this.source.rows == null ? "" : String(this.source.rows);
    },
  },
  methods: {
    toggle() {
      if (this.onToggle) this.onToggle(this.source.id);
    },
  },
});
</script>
