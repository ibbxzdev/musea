import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * The landing page: the name, and the way in.
 *
 * It used to be a build-status board listing the three SOW deliverables and their state.
 * That was the right thing while the app was a scaffold and the honest answer to "is this
 * real yet" was "not yet" — but the app is real now, and a status board in front of it
 * reads as the product being unfinished rather than as candour.
 *
 * Everything real lives under `/app`, which has its own shell and its own layout. This
 * stays outside that deliberately: it is the only page a signed-out visitor sees before
 * choosing to go in.
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen-safe w-full max-w-md flex-col items-center justify-center gap-8 px-5 pt-safe pb-safe">
      <div className="space-y-2 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">Musea</h1>
        <p className="text-sm text-muted-foreground text-balance">
          A visual library for what you keep — and a way to tip the curators who build it.
        </p>
      </div>

      <Button asChild size="lg" className="tap-target h-12 rounded-full px-8 text-base">
        <Link href="/app">Open Musea</Link>
      </Button>
    </main>
  );
}
