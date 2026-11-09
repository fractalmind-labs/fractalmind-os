/** Dev-only preview. Every chain/native operation uses a fixture; never signs. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import HostAccess from "../../src/HostAccess";
import { hostAccessFixture } from "../helpers/host-access-fixture";
import "../../src/styles.css";
const fixture = hostAccessFixture();
Object.defineProperty(globalThis, "isTauri", { value: true });
const attemptKey = `fractalmind.app.host-attempt.v1:${JSON.stringify([fixture.profile.network, fixture.profile.chainIdentifier, fixture.profile.humanId, fixture.organizationId])}`;
localStorage.removeItem(attemptKey);
function Preview() {
  const [n, setN] = useState(1);
  return (
    <main style={{ padding: 24 }}>
      <h1>接入主机 · 隔离测试</h1>
      <p>模拟链与本机设备，不签名、不提交交易。</p>
      <button
        onClick={() => {
          localStorage.removeItem(attemptKey);
          setN(n + 1);
        }}
      >
        重新打开
      </button>
      <label>
        测试场景{" "}
        <select
          onChange={(e) =>
            fixture.mode(
              e.target.value as "success" | "expensive" | "error" | "unknown",
            )
          }
          defaultValue="success"
        >
          <option value="success">正常生成</option>
          <option value="expensive">费用确认</option>
          <option value="error">网络失败</option>
          <option value="unknown">交易结果未知</option>
        </select>
      </label>
      <HostAccess
        key={n}
        {...fixture}
        t={(zh) => zh}
        request={{ kind: "invite", n }}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
