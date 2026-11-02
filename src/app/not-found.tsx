import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <section className="py-20">
      <h1 className="text-3xl font-bold tracking-tight">Page not found</h1>
      <p className="mt-3 text-muted-foreground">
        That page does not exist. Try one of the tools on the home page.
      </p>
      <Link href="/" className={`${buttonVariants()} mt-6 min-h-11 px-4`}>
        Back to all tools
      </Link>
    </section>
  );
}
