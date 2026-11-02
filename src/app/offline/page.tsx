import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Offline",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <section className="py-20">
      <h1 className="text-3xl font-bold tracking-tight">You are offline</h1>
      <p className="mt-3 max-w-xl text-muted-foreground">
        This page has not been saved on your device yet. Pages you have already
        opened, and the PDF tools, keep working without a connection.
      </p>
      <Link href="/" className={`${buttonVariants()} mt-6 min-h-11 px-4`}>
        Go to the home page
      </Link>
    </section>
  );
}
