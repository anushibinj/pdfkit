import Link from "next/link";
import { InstallButton } from "@/components/install-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { site } from "@/lib/site";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-2 px-4">
        <Link
          href="/"
          className="-mx-2 flex min-h-11 items-center rounded-md px-2 text-xl font-bold tracking-tight"
          aria-label={`${site.name} home`}
        >
          pdf<span className="text-muted-foreground">kit</span>
        </Link>
        <div className="flex items-center gap-1">
          <InstallButton />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
