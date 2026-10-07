// The OKR route map: start, one checkpoint per KR, the verified route, the
// measured position and the end. Moved from App.tsx so the first App and
// App v2 (#75) draw the same map.
import { TrustLadder } from "./V2Views";
import type { Navigation, OkrSnapshot } from "./domain";

type Translate = (zh: string, en: string) => string;

export default function MapView({
  focus,
  nav,
  t,
  onDetails,
}: {
  focus: OkrSnapshot;
  nav: Navigation;
  t: Translate;
  onDetails: () => void;
}) {
  const { okr } = focus;
  const height = 360;
  const start = { x: 70, y: 250 };
  const end = { x: 935, y: 240 };
  const krPoints = okr.metrics.map((_, i) => {
    return {
      x:
        okr.metrics.length === 1
          ? 480
          : 200 + (540 * i) / (okr.metrics.length - 1),
      y: i % 2 === 0 ? 190 : 135,
    };
  });
  const all = [start, ...krPoints, end],
    points = (items: typeof all) =>
      items.map((point) => `${point.x},${point.y}`).join(" ");
  const acceptedCheckpoint =
    okr.state === 3 &&
    Boolean(okr.acceptance_record) &&
    Boolean(okr.accepted_by_human);
  const verifiedRoute = all.slice(
    0,
    acceptedCheckpoint ? all.length : nav.verifiedCheckpoints + 1,
  );
  const index = Math.min(nav.currentKr, okr.metrics.length - 1),
    previous = all[index],
    target = krPoints[index];
  const fraction = nav.metricProgress[index] ?? 0;
  const measured = {
    x: previous.x + (target.x - previous.x) * fraction,
    y: previous.y + (target.y - previous.y) * fraction,
  };
  const allVerified = nav.verifiedCheckpoints === okr.metrics.length;
  const hasMeasurement = !allVerified && nav.metricProgress[index] !== null;
  const position = acceptedCheckpoint
    ? end
    : allVerified
      ? krPoints[krPoints.length - 1]
      : measured;
  const positionLabel = acceptedCheckpoint
    ? t("已人工验收位置", "Human-accepted position")
    : nav.condition === "unknown"
      ? t("最后确认位置", "Last known position")
      : hasMeasurement
        ? t("当前实测位置", "Measured position")
        : t("最后验证位置", "Last verified position");
  return (
    <section
      className="map panel"
      aria-label={t("OKR 运行导航地图", "OKR navigation map")}
    >
      <div className="map-caption">
        <strong>{okr.logical_id}</strong>
        <span>
          {t("已验证", "Verified")} {nav.verifiedCheckpoints}/
          {okr.metrics.length} ·{" "}
          {nav.progress === null
            ? t("实测进度未知", "Measured progress unknown")
            : `${t("实测", "Measured")} ${Math.round(nav.progress * 100)}%`}
        </span>
      </div>
      <ol className="route-strip" aria-label={t("OKR 路线", "OKR route")}>
        <li>{t("出发", "Start")}</li>
        {okr.metrics.map((metric, i) => (
          <li key={i}>
            <button onClick={onDetails}>
              <strong>KR{i + 1}</strong>
              <span>
                {metric.verified
                  ? t("已验证", "Verified")
                  : nav.metricProgress[i] === null
                    ? t("当前实测未知", "Current measurement unknown")
                    : `${Math.round(nav.metricProgress[i]! * 100)}%`}
              </span>
            </button>
            <TrustLadder
              {...{
                level: acceptedCheckpoint
                  ? "accepted"
                  : metric.verified
                    ? "verified"
                    : nav.metricProgress[i] !== null
                      ? "measured"
                      : null,
                stale:
                  metric.current !== null && nav.metricProgress[i] === null,
              }}
              t={t}
            />
          </li>
        ))}
        <li className={acceptedCheckpoint ? "accepted" : ""}>
          {t("人工验收终点", "Human acceptance")} ·{" "}
          {acceptedCheckpoint
            ? t("已验收", "Accepted")
            : t("尚未验收", "Not accepted")}
        </li>
      </ol>
      <svg
        viewBox={`0 0 1040 ${height}`}
        role="img"
        aria-label={t(
          "绿色为已验证路线，蓝色为实测位置，虚线为计划",
          "Green is verified route, blue is measured position, dashed is planned route",
        )}
      >
        <defs>
          <pattern
            id="grid"
            width="36"
            height="36"
            patternUnits="userSpaceOnUse"
          >
            <path d="M36 0H0V36" className="map-grid" fill="none" />
          </pattern>
        </defs>
        <rect width={1040} height={height} fill="url(#grid)" />
        <path
          d="M60 80Q180 30 350 55T960 75M30 310Q200 280 430 320T1000 300"
          className="contour"
          fill="none"
        />
        <polyline points={points(all)} className="road" />
        <polyline points={points(all)} className="planned-road" />
        {verifiedRoute.length > 1 && (
          <polyline points={points(verifiedRoute)} className="verified-road" />
        )}
        {nav.condition !== "achieved" &&
          nav.metricProgress[index] !== null &&
          nav.verifiedCheckpoints < okr.metrics.length && (
            <polyline
              points={points([previous, measured])}
              className="measured-road"
            />
          )}
        <circle cx={start.x} cy={start.y} r="7" className="start-point" />
        <text x={start.x} y={start.y + 35} textAnchor="middle">
          {t("出发", "Start")}
        </text>
        {krPoints.map((point, i) => (
          <g
            key={i}
            role="button"
            tabIndex={0}
            aria-label={`${t("查看", "View")} KR${i + 1}`}
            onClick={onDetails}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onDetails();
              }
            }}
          >
            <circle
              cx={point.x}
              cy={point.y}
              r="23"
              className={
                okr.metrics[i].verified ? "verified-node" : "planned-node"
              }
            />
            <text
              x={point.x}
              y={point.y + 6}
              textAnchor="middle"
              className="node-text"
            >
              {okr.metrics[i].verified ? "✓" : i + 1}
            </text>
            <text x={point.x} y={point.y + 52} textAnchor="middle">
              KR{i + 1} ·{" "}
              {okr.metrics[i].verified
                ? t("已验证", "Verified")
                : nav.metricProgress[i] === 1
                  ? t("待验证", "Verify next")
                  : nav.metricProgress[i] === null
                    ? t("未获新鲜观测", "No fresh sample")
                    : `${Math.round(nav.metricProgress[i]! * 100)}%`}
            </text>
          </g>
        ))}
        <rect
          x={end.x - 20}
          y={end.y - 20}
          width="40"
          height="40"
          rx="12"
          className={
            nav.condition === "achieved" ? "accepted-node" : "planned-node"
          }
        />
        <text x={end.x} y={end.y + 6} textAnchor="middle" className="node-text">
          {nav.condition === "achieved" ? "✓" : "⚑"}
        </text>
        <text x={end.x} y={end.y + 50} textAnchor="middle">
          {t("人工验收终点", "Human acceptance")}
        </text>
        <circle
          cx={position.x}
          cy={position.y}
          r="35"
          className="position-ring"
        />
        <circle
          cx={position.x}
          cy={position.y}
          r="12"
          className={
            acceptedCheckpoint
              ? "accepted-position"
              : allVerified
                ? "verified-position"
                : nav.condition === "unknown" || !hasMeasurement
                  ? "unknown-position"
                  : "current-position"
          }
        />
        <text
          x={position.x}
          y={position.y - 45}
          textAnchor="middle"
          className="position-label"
        >
          {positionLabel}
        </text>
      </svg>
      <div className="legend">
        <span>● {t("已验证", "Verified")}</span>
        <span>● {t("实测，非验收", "Measured, not accepted")}</span>
        <span>◆ {t("已验收", "Accepted")}</span>
        <span>┄ {t("计划路线", "Planned route")}</span>
      </div>
      <p className="muted">
        {t(
          "结果空间示意，不代表实际文件路径、剩余时间或成功概率。缺少观测时不推断偏航或死胡同。",
          "Result-space schematic, not physical file paths, time remaining or success probability. Missing observations do not establish drift or a dead end.",
        )}
      </p>
    </section>
  );
}
