<template>
  <div class="activity-tab-bar">
    <div class="activity-tabs">
      <button
        v-for="category in categories"
        :key="category"
        class="activity-tab"
        :class="{ active: category === activeCategory }"
        type="button"
        @click="select(category)"
      >
        <span class="activity-tab-label">{{ category }}</span>
        <span
          v-if="unseenCount(category) > 0 && category !== activeCategory"
          class="activity-tab-badge"
        >{{ badgeText(unseenCount(category)) }}</span>
      </button>
    </div>
    <div class="activity-tab-actions">
      <button
        class="activity-clear btn btn-flat btn-icon"
        type="button"
        title="Clear this category"
        @click="clear"
      >
        <i class="material-icons">delete_outline</i>
        <span>Clear</span>
      </button>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import { mapGetters, mapState } from "vuex";
import { ACTIVITY_CATEGORIES, ActivityCategory } from "@/lib/activity/ActivityLog";

export default Vue.extend({
  name: "ActivityTabBar",
  data() {
    return {
      categories: ACTIVITY_CATEGORIES,
    };
  },
  computed: {
    ...mapState("activity", ["activeCategory"]),
    ...mapGetters("activity", ["unseenCount"]),
  },
  methods: {
    select(category: ActivityCategory) {
      this.$store.dispatch("activity/selectCategory", category);
      this.$emit("select", category);
    },
    clear() {
      this.$store.dispatch("activity/clear", this.activeCategory);
    },
    badgeText(count: number): string {
      return count > 99 ? "99+" : String(count);
    },
  },
});
</script>
