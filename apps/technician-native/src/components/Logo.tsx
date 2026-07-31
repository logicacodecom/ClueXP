import { Image } from "react-native";

// Same lockup as apps/technician-web/public/logo.png (h-6 w-auto object-contain).
const SOURCE = require("../../assets/logo.png");
const ASPECT_RATIO = 2055 / 555;

export function Logo({ height = 24 }: { height?: number }) {
  return (
    <Image
      accessibilityLabel="ClueXP"
      resizeMode="contain"
      source={SOURCE}
      style={{ height, width: height * ASPECT_RATIO }}
    />
  );
}
