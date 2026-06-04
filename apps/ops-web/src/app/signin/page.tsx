import { platformSession } from "@cluexp/api-client";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@cluexp/console-ui";
import Link from "next/link";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div>
            <Badge variant="outline">Mock auth shell</Badge>
            <CardTitle className="mt-4">Platform Operations Sign In</CardTitle>
            <CardDescription>Frontend-only session preview. Real JWT and route guards belong to the backend auth slice.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input readOnly value={platformSession.user.email ?? ""} />
          <Input readOnly type="password" value="demo-password" />
          <Button asChild className="w-full"><Link href="/dashboard">Enter Network Ops</Link></Button>
        </CardContent>
      </Card>
    </main>
  );
}
