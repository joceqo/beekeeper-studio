<template>
  <div
    class="activity-panel"
    :class="{ collapsed, resizing }"
    :style="panelStyle"
  >
    <div
      v-if="!collapsed"
      class="activity-resize-handle"
      @mousedown.prevent="startResize"
    />
    <div class="activity-panel-header">
      <activity-tab-bar @select="expand" />
      <button
        class="activity-collapse-toggle btn btn-flat btn-fab"
        type="button"
        :title="collapsed ? 'Expand activity panel' : 'Collapse activity panel'"
        @click="toggleCollapsed"
      >
        <i class="material-icons">{{ collapsed ? 'expand_less' : 'expand_more' }}</i>
      </button>
    </div>
    <activity-log-table
      v-show="!collapsed"
      class="activity-panel-body"
      :entries="activeEntries"
    />
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import { mapGetters } from "vuex";
import ActivityTabBar from "./ActivityTabBar.vue";
import ActivityLogTable from "./ActivityLogTable.vue";
import { SmartLocalStorage } from "@/common/LocalStorage";

const HEIGHT_KEY = "activityDockHeight-v1";
const COLLAPSED_KEY = "activityDockCollapsed-v1";
const DEFAULT_HEIGHT = 220;
const MIN_HEIGHT = 120;

export default Vue.extend({
  name: "ActivityPanel",
  components: { ActivityTabBar, ActivityLogTable },
  data() {
    return {
      collapsed: SmartLocalStorage.getBool(COLLAPSED_KEY, true),
      height: SmartLocalStorage.getJSON(HEIGHT_KEY, DEFAULT_HEIGHT) as number,
      resizing: false,
      startY: 0,
      startHeight: 0,
    };
  },
  computed: {
    ...mapGetters("activity", ["activeEntries"]),
    panelStyle(): Record<string, string> {
      return this.collapsed ? {} : { height: `${this.height}px` };
    },
    maxHeight(): number {
      return Math.max(MIN_HEIGHT, Math.round(window.innerHeight * 0.8));
    },
  },
  beforeDestroy() {
    this.stopResize();
  },
  methods: {
    toggleCollapsed() {
      this.collapsed = !this.collapsed;
      SmartLocalStorage.setBool(COLLAPSED_KEY, this.collapsed);
    },
    /** Expand the dock if collapsed (e.g. when a category tab is clicked). */
    expand() {
      if (this.collapsed) {
        this.collapsed = false;
        SmartLocalStorage.setBool(COLLAPSED_KEY, false);
      }
    },
    startResize(event: MouseEvent) {
      this.resizing = true;
      this.startY = event.clientY;
      this.startHeight = this.height;
      window.addEventListener("mousemove", this.onResize);
      window.addEventListener("mouseup", this.stopResize);
    },
    onResize(event: MouseEvent) {
      if (!this.resizing) return;
      // Dragging up grows the panel.
      const delta = this.startY - event.clientY;
      const next = this.startHeight + delta;
      this.height = Math.min(this.maxHeight, Math.max(MIN_HEIGHT, next));
    },
    stopResize() {
      if (!this.resizing) return;
      this.resizing = false;
      window.removeEventListener("mousemove", this.onResize);
      window.removeEventListener("mouseup", this.stopResize);
      SmartLocalStorage.addItem(HEIGHT_KEY, this.height);
    },
  },
});
</script>
