import { useState, useCallback } from "react";
import { useSuiData } from "./hooks/useSuiData.ts";
import { useTheme } from "./hooks/useTheme.ts";
import ForceGraph from "./components/ForceGraph.tsx";
import BabylonGraph from "./components/BabylonGraph.tsx";
import DetailPanel, { type DetailItem } from "./components/DetailPanel.tsx";
import TaskFlow from "./components/TaskFlow.tsx";
import PeerList from "./components/PeerList.tsx";
import ErrorRetry from "./components/ErrorRetry.tsx";
import { SidebarSkeleton, GraphSkeleton } from "./components/Skeleton.tsx";
import { NODE_COLORS, truncateId } from "./components/utils.ts";
import { SUI_CONFIG, suiScanUrl } from "./sui/config.ts";
import type { GraphNode } from "./sui/types.ts";

type View = "org" | "tasks" | "peers";

const VIEWS: { key: View; label: string; icon: string }[] = [
  { key: "org", label: "Organization", icon: "◈" },
  { key: "tasks", label: "Tasks", icon: "◉" },
  { key: "peers", label: "Peers", icon: "◎" },
];

export default function App() {
  const data = useSuiData();
  const { theme, toggle: toggleTheme } = useTheme();
  const [activeView, setActiveView] = useState<View>("org");
  const [renderMode, setRenderMode] = useState<"2d" | "3d">("3d");
  const [selectedNode, setSelectedNode] = useState<DetailItem | null>(null);

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode({ type: node.type, data: node.data });
  }, []);

  const handleClose = useCallback(() => setSelectedNode(null), []);

  const totalObjects =
    data.organizations.length +
    data.agents.length +
    data.tasks.length +
    data.peers.length;

  const isFirstLoad = data.loading && totalObjects === 0;

  const rootOrgs = data.organizations.filter((o) => o.depth === 0);
  const subOrgs = data.organizations.filter((o) => o.depth > 0);

  return (
    <div className="min-h-screen bg-base flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-base/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-fractal-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
              FM
            </div>
            <div>
              <h1 className="text-lg font-bold text-primary leading-tight">
                FractalMind Explorer
              </h1>
              <p className="text-xs text-muted">
                On-chain AI Organization Visualizer — SUI Testnet
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Stats */}
            <div className="hidden sm:flex items-center gap-3 text-xs text-muted mr-1">
              {data.loading && (
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse-dot" />
                  Loading...
                </span>
              )}
              {!data.loading && !data.error && (
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse-dot" />
                  {totalObjects} objects
                </span>
              )}
              {data.error && !data.loading && (
                <span className="flex items-center gap-1.5 text-red-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                  Error
                </span>
              )}
            </div>

            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg hover:bg-hover text-secondary hover:text-primary transition-colors cursor-pointer"
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>

            {/* Refresh */}
            <button
              onClick={data.refresh}
              disabled={data.loading}
              className="p-2 rounded-lg hover:bg-hover text-secondary hover:text-primary transition-colors disabled:opacity-50 cursor-pointer"
              title="Refresh data"
            >
              <svg
                className={`w-4 h-4 ${data.loading ? "animate-spin" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>

            {/* SuiScan link */}
            <a
              href={suiScanUrl("object", SUI_CONFIG.registry)}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-lg hover:bg-hover text-secondary hover:text-primary transition-colors"
              title="View Registry on SuiScan"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
            </a>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col lg:flex-row max-w-7xl mx-auto w-full px-4 py-4 gap-4">
        {/* Sidebar */}
        <aside className="w-full lg:w-72 shrink-0 space-y-4">
          {isFirstLoad ? (
            <SidebarSkeleton />
          ) : (
            <>
              {/* View switcher */}
              <div className="bg-surface-alt rounded-xl border border-border p-2">
                {VIEWS.map((v) => (
                  <button
                    key={v.key}
                    onClick={() => {
                      setActiveView(v.key);
                      setSelectedNode(null);
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                      activeView === v.key
                        ? "bg-fractal-600/20 text-fractal-300 border border-fractal-600/30"
                        : "text-secondary hover:text-primary hover:bg-hover border border-transparent"
                    }`}
                  >
                    <span className="text-base">{v.icon}</span>
                    {v.label}
                  </button>
                ))}
              </div>

              {/* Legend */}
              <div className="bg-surface-alt rounded-xl border border-border p-4">
                <h3 className="text-xs font-medium text-muted uppercase tracking-wider mb-2">
                  Legend
                </h3>
                <div className="space-y-1.5">
                  {Object.entries(NODE_COLORS).map(([type, color]) => (
                    <div key={type} className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-xs text-secondary capitalize">
                        {type === "suborg" ? "Sub-Org" : type}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Object counts */}
              <div className="bg-surface-alt rounded-xl border border-border p-4">
                <h3 className="text-xs font-medium text-muted uppercase tracking-wider mb-2">
                  On-chain Objects
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Orgs", count: rootOrgs.length, color: NODE_COLORS.org },
                    { label: "Sub-Orgs", count: subOrgs.length, color: NODE_COLORS.suborg },
                    { label: "Agents", count: data.agents.length, color: NODE_COLORS.agent },
                    { label: "Tasks", count: data.tasks.length, color: NODE_COLORS.task },
                    { label: "Peers", count: data.peers.length, color: NODE_COLORS.peer },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="bg-hover rounded-lg p-2 text-center"
                    >
                      <div
                        className="text-lg font-bold"
                        style={{ color: item.color }}
                      >
                        {item.count}
                      </div>
                      <div className="text-[10px] text-muted">{item.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Network info */}
              <div className="bg-surface-alt rounded-xl border border-border p-4">
                <h3 className="text-xs font-medium text-muted uppercase tracking-wider mb-2">
                  Network
                </h3>
                <div className="space-y-1 text-xs text-muted">
                  <div>
                    Chain: <span className="text-primary">SUI Testnet</span>
                  </div>
                  <div>
                    Package:{" "}
                    <a
                      href={suiScanUrl("object", SUI_CONFIG.protocolPackage)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-fractal-400 hover:text-fractal-300 font-mono"
                    >
                      {truncateId(SUI_CONFIG.protocolPackage, 4)}
                    </a>
                  </div>
                  <div>
                    Registry:{" "}
                    <a
                      href={suiScanUrl("object", SUI_CONFIG.registry)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-fractal-400 hover:text-fractal-300 font-mono"
                    >
                      {truncateId(SUI_CONFIG.registry, 4)}
                    </a>
                  </div>
                </div>
              </div>
            </>
          )}
        </aside>

        {/* Graph + detail area */}
        <div className="flex-1 flex flex-col gap-4 min-h-0">
          {/* Error banner */}
          {data.error && !data.loading && (
            <ErrorRetry error={data.error} onRetry={data.refresh} />
          )}

          {/* Force graph / 3D graph */}
          <div className="flex-1 bg-surface-alt rounded-xl border border-border overflow-hidden relative min-h-[400px]">
            {isFirstLoad && <GraphSkeleton />}

            {/* 2D/3D toggle */}
            <button
              onClick={() => setRenderMode((m) => (m === "2d" ? "3d" : "2d"))}
              className="absolute top-3 right-3 z-10 px-3 py-1.5 rounded-lg bg-base/80 backdrop-blur-sm border border-border text-xs font-medium text-secondary hover:text-primary hover:bg-hover transition-colors cursor-pointer"
              title={`Switch to ${renderMode === "3d" ? "2D" : "3D"} view`}
            >
              {renderMode === "3d" ? "2D" : "3D"}
            </button>

            {renderMode === "2d" ? (
              <ForceGraph
                organizations={data.organizations}
                agents={data.agents}
                tasks={data.tasks}
                peers={data.peers}
                activeView={activeView}
                onNodeClick={handleNodeClick}
              />
            ) : (
              <BabylonGraph
                organizations={data.organizations}
                agents={data.agents}
                tasks={data.tasks}
                peers={data.peers}
                activeView={activeView}
                onNodeClick={handleNodeClick}
              />
            )}
          </div>

          {/* Bottom panel for task/peer lists */}
          {activeView === "tasks" && !isFirstLoad && (
            <div className="bg-surface-alt rounded-xl border border-border p-4 max-h-64 overflow-y-auto">
              <TaskFlow tasks={data.tasks} />
            </div>
          )}
          {activeView === "peers" && !isFirstLoad && (
            <div className="bg-surface-alt rounded-xl border border-border p-4 max-h-64 overflow-y-auto">
              <PeerList peers={data.peers} />
            </div>
          )}
        </div>
      </main>

      {/* Detail panel (slide-in) */}
      <DetailPanel item={selectedNode} onClose={handleClose} />

      {/* Footer */}
      <footer className="border-t border-border py-3 text-center text-xs text-muted">
        FractalMind Explorer — Built with React + BabylonJS + D3.js + SUI SDK — Data from{" "}
        <a
          href="https://suiscan.xyz/testnet"
          target="_blank"
          rel="noopener noreferrer"
          className="text-fractal-500 hover:text-fractal-400"
        >
          SUI Testnet
        </a>
      </footer>
    </div>
  );
}
