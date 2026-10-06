import type { MessageOkrSource } from "./message-okr-source";

export default function MessageOkrContext({
  source,
  t,
}: {
  source: MessageOkrSource;
  t: (zh: string, en: string) => string;
}) {
  return (
    <section
      className="panel direct-message-detail"
      aria-label={t("来源对话", "Source conversation")}
    >
      <h3>{t("来源对话", "Source conversation")}</h3>
      <p className="direct-message-text">{source.request.message}</p>
      {source.reply && (
        <>
          <h4>
            {t(
              "原模型建议 · 待审阅",
              "Original model suggestion · review required",
            )}
          </h4>
          <p className="direct-message-text">{source.reply.text}</p>
          <small>{source.reply.model}</small>
        </>
      )}
      <p>
        {t(
          "请明确目标、可测量 KR 和新的执行约束。来源对话只提供上下文。",
          "Define the objective, measurable KRs and new execution constraints. The source conversation provides context.",
        )}
      </p>
      <details>
        <summary>
          {t(
            "核对来源实例与原请求",
            "Review the source instance and original request",
          )}
        </summary>
        <p>
          {t("原消息", "Original message")}:{" "}
          <code className="long-id">{source.messageId}</code>
        </p>
        <p>
          Agent: <code className="long-id">{source.managedAgentId}</code> · v
          {source.managedVersion}
        </p>
        <p>
          {source.action} ·{" "}
          {new Date(Number(source.createdAtMs)).toLocaleString()}
        </p>
        <pre>{JSON.stringify(source.request.bounds, null, 2)}</pre>
        {source.request.task && <pre>{source.request.task}</pre>}
        {source.reply && (
          <p>
            Run: <code className="long-id">{source.reply.runId}</code>
          </p>
        )}
      </details>
    </section>
  );
}
