export default function Loading() {
  return (
    <div className="container-providus flex flex-1 items-center justify-center py-24">
      <div className="flex flex-col items-center gap-3">
        <div
          className="h-10 w-10 animate-pulse rounded-[8px] border-ledger bg-cream shadow-none"
          aria-hidden
        />
        <p className="text-sm font-medium text-receipt-grey">Loading…</p>
      </div>
    </div>
  );
}
