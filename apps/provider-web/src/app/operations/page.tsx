import { DispatcherOperations } from "@cluexp/console-ui";
import { AppFrame } from "../frame";

export default function OperationsPage() {
  return <AppFrame><DispatcherOperations mode="org" /></AppFrame>;
}
