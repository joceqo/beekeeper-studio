<template>
  <div class="activity-log-table">
    <div class="activity-row activity-header-row">
      <div class="activity-cell col-time">
        Time
      </div>
      <div class="activity-cell col-ctg">
        Ctg
      </div>
      <div class="activity-cell col-op">
        Op
      </div>
      <div class="activity-cell col-conn">
        Connection
      </div>
      <div class="activity-cell col-tables">
        Tables
      </div>
      <div class="activity-cell col-sql">
        SQL
      </div>
      <div class="activity-cell col-dur">
        Dur
      </div>
      <div class="activity-cell col-rows">
        Rows
      </div>
    </div>
    <div v-if="entries.length === 0" class="activity-empty">
      No activity yet.
    </div>
    <virtual-list
      v-else
      ref="vList"
      class="activity-rows"
      :data-key="'id'"
      :data-sources="entries"
      :data-component="rowComponent"
      :estimate-size="26"
      :keeps="40"
      :extra-props="{ expandedIds, onToggle }"
    />
  </div>
</template>

<script lang="ts">
import Vue, { PropType } from "vue";
import VirtualList from "vue-virtual-scroll-list";
import ActivityLogRow from "./ActivityLogRow.vue";
import { ActivityEntry } from "@/lib/activity/ActivityLog";

export default Vue.extend({
  name: "ActivityLogTable",
  components: { VirtualList },
  props: {
    entries: {
      type: Array as PropType<ActivityEntry[]>,
      default: () => [],
    },
  },
  data() {
    return {
      rowComponent: ActivityLogRow,
      // Entry ids are globally unique, so expanded ids from another category
      // simply never match a visible row - no need to reset on change.
      expandedIds: [] as number[],
    };
  },
  methods: {
    onToggle(id: number) {
      // Reassign (not mutate) so the virtual list re-renders rows reliably.
      this.expandedIds = this.expandedIds.includes(id)
        ? this.expandedIds.filter((x) => x !== id)
        : [...this.expandedIds, id];
    },
  },
});
</script>
