import Constants from "expo-constants";
import { Platform, StyleSheet } from "react-native";
import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps";
import { colors } from "../theme";

export type MapPoint = { lat: number; lng: number; kind: "tech" | "job"; label?: string };

// Matches what react-native-maps' own Expo config plugin reads (plugins:
// [["react-native-maps", { androidGoogleMapsApiKey }]]) — see app.json. iOS
// needs no key at all: PROVIDER_DEFAULT is Apple Maps there.
function androidMapsKeyConfigured() {
  if (Platform.OS !== "android") return true;
  const plugins = (Constants.expoConfig?.plugins ?? []) as Array<string | [string, Record<string, unknown>]>;
  const entry = plugins.find((item) => (Array.isArray(item) ? item[0] === "react-native-maps" : item === "react-native-maps"));
  const props = Array.isArray(entry) ? entry[1] : undefined;
  return Boolean(props?.androidGoogleMapsApiKey);
}

export function canRenderActiveJobMap(points: MapPoint[]) {
  return points.length > 0 && androidMapsKeyConfigured();
}

function regionFor(points: MapPoint[]) {
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.01, (maxLat - minLat) * 1.8),
    longitudeDelta: Math.max(0.01, (maxLng - minLng) * 1.8)
  };
}

// A real live map — no simulated/offset technician marker like web's mock
// "You" pin (job.lat+0.012). This app's own map fallback already commits to
// "GPS is honest. No simulated movement is shown."; only the real job
// location is plotted here.
export function ActiveJobMap({ points }: { points: MapPoint[]; connect?: boolean }) {
  if (!canRenderActiveJobMap(points)) return null;
  const region = regionFor(points);

  return (
    <MapView
      initialRegion={region}
      pitchEnabled={false}
      provider={PROVIDER_DEFAULT}
      region={region}
      rotateEnabled={false}
      style={StyleSheet.absoluteFill}
      toolbarEnabled={false}
    >
      {points.map((point, index) => (
        <Marker
          coordinate={{ latitude: point.lat, longitude: point.lng }}
          key={`${point.kind}-${index}`}
          pinColor={point.kind === "tech" ? colors.primary : colors.info}
          title={point.label}
        />
      ))}
    </MapView>
  );
}
