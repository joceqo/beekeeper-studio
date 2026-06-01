<template>
  <div class="global-status-bar">
    <div
      class="connection-button-wrapper"
      :style="{
        ['--connection-button-icon-width']: connectionButtonIconWidth + 'px',
        width: connectionButtonWidth + 'px',
      }"
    >
      <connection-button />
    </div>
    <portal-target name="global-status-bar" />
    <div
      v-if="appVersion"
      class="status-bar-version"
      :title="`Beekeeper Studio ${appVersion}`"
    >
      v{{ appVersion }}
    </div>
  </div>
</template>

<script>
import { PortalTarget } from "portal-vue";
import ConnectionButton from "./sidebar/core/ConnectionButton.vue";

export default {
  components: { PortalTarget, ConnectionButton },
  props: {
    connectionButtonWidth: Number,
    connectionButtonIconWidth: Number,
  },
  computed: {
    appVersion() {
      return window.platformInfo?.appVersion || "";
    },
  },
};
</script>
