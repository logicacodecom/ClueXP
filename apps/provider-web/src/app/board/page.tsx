import { DispatchBoard } from "@cluexp/console-ui";
import { AppFrame } from "../frame";

export default function BoardPage() {
  return <AppFrame><DispatchBoard mode="org" /></AppFrame>;
}
