import { Component, type ReactNode } from "react";

/** A failed lazy view (including a changed deployment's missing assets) must
 * leave a visible recovery action. Reloading never replays a transaction. */
export class AppBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    const zh = document.documentElement.lang.startsWith("zh");
    return (
      <main className="panel" role="alert">
        <h1>{zh ? "页面未能加载" : "The page could not load"}</h1>
        <p>
          {zh
            ? "检查连接后重新加载。原执行记录保留在链上，重新加载不会自动重发操作。"
            : "Check the connection and reload. Original execution records remain on Sui; reloading does not automatically resend operations."}
        </p>
        <button onClick={() => window.location.reload()}>
          {zh ? "重新加载界面" : "Reload the app"}
        </button>
      </main>
    );
  }
}
