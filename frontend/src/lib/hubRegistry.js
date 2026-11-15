import { TOOL_REGISTRY } from "../config/toolRegistry";

// Adapter for saved customization preferences; metadata has one source.
export const HUB_TILES = Object.fromEntries(TOOL_REGISTRY.map((tool) => [tool.id, {
  label: tool.title, Icon: tool.icon, path: tool.route, badge: tool.badge,
  required: tool.required, accent: "bg-[#FFF1E6] text-[#C44A08]",
}]));
export const DEFAULT_TILE_ORDER = TOOL_REGISTRY.map((tool) => tool.id);
