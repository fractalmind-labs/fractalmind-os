/** Skeleton shimmer placeholders for loading state */

export function SidebarSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* View switcher skeleton */}
      <div className="bg-surface-alt rounded-xl border border-border p-2 space-y-1">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-9 rounded-lg bg-skeleton"
          />
        ))}
      </div>

      {/* Legend skeleton */}
      <div className="bg-surface-alt rounded-xl border border-border p-4">
        <div className="h-3 w-16 bg-skeleton rounded mb-3" />
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-skeleton" />
              <div className="h-3 w-12 bg-skeleton rounded" />
            </div>
          ))}
        </div>
      </div>

      {/* Counts skeleton */}
      <div className="bg-surface-alt rounded-xl border border-border p-4">
        <div className="h-3 w-24 bg-skeleton rounded mb-3" />
        <div className="grid grid-cols-2 gap-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="bg-skeleton/50 rounded-lg p-2 h-14"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function GraphSkeleton() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="text-center">
        <div className="relative w-24 h-24 mx-auto mb-4">
          {/* Animated orbiting dots */}
          <div className="absolute inset-0 animate-spin" style={{ animationDuration: "3s" }}>
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-fractal-500 opacity-80" />
          </div>
          <div className="absolute inset-0 animate-spin" style={{ animationDuration: "3s", animationDelay: "-1s" }}>
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-green-400 opacity-80" />
          </div>
          <div className="absolute inset-0 animate-spin" style={{ animationDuration: "3s", animationDelay: "-2s" }}>
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-yellow-400 opacity-80" />
          </div>
          {/* Center dot */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-4 h-4 rounded-full bg-fractal-400 animate-pulse-dot" />
          </div>
        </div>
        <div className="text-sm text-secondary font-medium">
          Fetching on-chain data...
        </div>
        <div className="text-xs text-muted mt-1">
          Traversing SUI Testnet tables
        </div>
      </div>
    </div>
  );
}
