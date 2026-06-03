import { LiveQueue } from "@cluexp/console-ui";
import { AppFrame } from "../frame";

export default function QueuePage() {
  return <AppFrame><LiveQueue mode="cluexp" /></AppFrame>;
}
