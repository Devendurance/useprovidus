import { LinkButton } from "@/components/ui/link-button";
import { RouteCheckCTA } from "@/components/ui/route-check-cta";

export default function NotFound() {
  return (
    <div className="container-providus flex flex-1 flex-col items-start justify-center py-20 sm:items-center sm:text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-receipt-grey">
        404
      </p>
      <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ledger-stone sm:text-4xl">
        Page not found
      </h1>
      <p className="mt-4 max-w-md text-receipt-grey leading-relaxed">
        That path is not on the map. Return home or start a Route Check.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <LinkButton
          href="/"
          variant="secondary"
          size="lg"
          className="rounded-[2px] text-[15px]"
        >
          Home
        </LinkButton>
        <RouteCheckCTA />
      </div>
    </div>
  );
}
