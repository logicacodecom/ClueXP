export type MapPoint = { lat: number; lng: number; kind: "tech" | "job"; label?: string };

// react-native-maps has no web implementation. The active-job screen's
// existing static panel (address + GPS truth line) is the web-preview
// experience — the same "native-only feature, honest fallback on web"
// pattern already used for location/push in this app.
export function canRenderActiveJobMap(_points: MapPoint[]) {
  return false;
}

export function ActiveJobMap(_props: { points: MapPoint[]; connect?: boolean }) {
  return null;
}
