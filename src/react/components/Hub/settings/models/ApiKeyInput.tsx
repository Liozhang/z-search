/**
 * ApiKeyInput — 单个 API key 字段（重新设计版）。
 *
 * 相比旧 ApiKeyFieldInput 的改进：
 *  - mask 显示：未编辑态显示 `••••<last4>`，点击切换为明文（show/hide）
 *  - 复制按钮：成功后短暂显示 "已复制"
 *  - 行内保存反馈：保存后短暂显示绿色 ✓ "已保存"
 *  - ASCII 校验：保留（password 字段值含非 ASCII 时给红色提示）
 *  - 受控 + onBlur commit（保持原有契约）
 *  - 空值显示 "未配置 / Add key…" placeholder
 *
 * 搜索态高亮由父级 ApiKeysSection 通过 highlight prop 注入（label 渲染时调用）。
 *
 * @module react/components/Hub/settings/ApiKeyInput
 */
import React, { useEffect, useState } from "react";
import { getString } from "../../../../utils/locale";
import { copyText } from "../../../../utils/clipboard";
import { toErrorMessage } from "../../../../utils/error";
import { Input } from "@/components/ui/input";
import type { ApiKeyField } from "../../../../../utils/apiKeySchema";
import Button from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  CopyIconSvg,
  CheckIconSvg,
  EyeIconSvgIfPresent,
  EyeOffIconSvgIfPresent,
} from "../shared/icons";
import { ICON } from "../../../../utils/iconSizes";

import { isIMEComposing } from "../../../../../utils/ime";
export interface ApiKeyInputProps {
  /**
   * 字段 schema（API Keys 表单用）。Provider apiKey 等场景可不传 field，
   * 改用 labelText / placeholderText 直接字符串。
   */
  field?: ApiKeyField;
  /** 直接字符串 label（覆盖 field.labelKey）。用于 Provider apiKey 等无 schema 场景。 */
  labelText?: string;
  /** 直接字符串 placeholder（覆盖 field.placeholderKey）。 */
  placeholderText?: string;
  /** input type，默认从 field.type 推断，无 field 时默认 password。 */
  type?: "password" | "text";
  value: string;
  badAscii: boolean;
  /** 当前是否在搜索态（搜索态下强制展开为可编辑 + 显示 label） */
  /** label 渲染函数（注入高亮）；不传时直接渲染纯文本。 */
  /** 只读（OAuth 等场景）：不显示 mask 编辑入口、不显示复制按钮的"添加"态。 */
  readOnly?: boolean;
  /** commit 回调（onBlur 或 Enter）。返回 Promise 以驱动"已保存"反馈。 */
  onCommit: (value: string) => void | Promise<void>;
}

/** getString fallback：返回值等于 key 本身时视为缺失，降级为空串。 */
function safeText(key: string): string {
  const v = getString(key);
  return v === key ? "" : v;
}

/** 把 key mask 为 `••••<last4>` 格式（少于 8 字符全 mask）。 */
function maskKey(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "••••";
  return `••••${value.slice(-4)}`;
}

type SaveState = "idle" | "saving" | "saved";

export function ApiKeyInput({
  field,
  labelText,
  placeholderText,
  type,
  value,
  badAscii,
  readOnly,
  onCommit,
}: ApiKeyInputProps): React.ReactElement {
  const isPassword = (type ?? field?.type ?? "password") === "password";
  const toast = useToast();

  // 本地 draft：编辑时实时同步，blur 时 commit
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // 外部 value 变化时同步 draft（除非用户正在编辑）
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  // saved 反馈 1.2s 后自动消失
  useEffect(() => {
    if (saveState !== "saved") return;
    const t = setTimeout(() => setSaveState("idle"), 1200);
    return () => clearTimeout(t);
  }, [saveState]);

  // copied 反馈 1.5s 后自动消失（与 saved 同构，cleanup 避免连点复制累积定时器）
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  // label 解析优先级：直接字符串 > field.labelKey > field.prefKey
  const label =
    labelText ?? (field ? safeText(field.labelKey) || field.prefKey : "");
  const placeholder =
    (placeholderText ?? (field ? safeText(field.placeholderKey) : "")) ||
    getString("hub-settings-key-mask-placeholder");
  const hasValue = !!(value && value.trim());
  const isConfigured = hasValue;

  const handleCommit = async () => {
    setEditing(false);
    // 防重复提交：上一次保存尚未完成时忽略再次 commit（UX-L13）
    if (saveState === "saving") return;
    if (draft === value) return;
    setSaveState("saving");
    try {
      await onCommit(draft);
      setSaveState("saved");
    } catch (e) {
      console.error("[ApiKeyInput] commit failed", e);
      // 保存失败必须给用户可见反馈（之前只回滚 + console，修 UX-H6）
      toast.error(toErrorMessage(e, getString("hub-settings-save-failed")));
      setDraft(value); // 回滚
      setSaveState("idle");
    }
  };

  const handleCopy = async () => {
    if (!hasValue) return;
    // copyText 回退链（Zotero.Clipboard → navigator → textarea）；失败静默
    if (await copyText(value)) {
      setCopied(true); // 反馈定时器由上面的 effect 管理
    }
  };

  const inputType = isPassword && !revealed ? "password" : "text";

  // hasActions：inline 态下右侧有按钮（toggle / copy / saved）时需给 input 留右内边距
  const hasActions = isPassword || hasValue || saveState !== "idle";

  // 渲染策略：
  //  - 已配置 + 非编辑 + 非搜索 + password：显示 mask summary（点击进入编辑）
  //  - 其它：显示 input
  // readOnly 模式（OAuth）：跳过 mask summary，显示只读 input + readOnlyHint
  const showMaskSummary = !readOnly && isPassword && isConfigured && !editing;

  return (
    <div
      className={`hub-api-key${isConfigured ? " is-configured" : ""}${badAscii ? " is-invalid" : ""}`}
    >
      <div className="hub-api-key-label">{label}</div>

      <div className={`hub-api-key-control${hasActions ? " has-actions" : ""}`}>
        {showMaskSummary ? (
          // 外层用 div role=button（HTML 不允许 button 嵌套 button），内层 eye/copy
          // 仍是 button。键盘：Enter/Space 在 mask 上 = 进入编辑（与外层 click 等价）。
          <div
            role="button"
            tabIndex={0}
            className="hub-api-key-mask focus-ring-subtle"
            title={getString("hub-settings-key-show")}
            onClick={(e) => {
              // 内层 eye/copy 按钮动作不同且已自行 stopPropagation；
              // 再按选择器忽略内层交互控件冒泡的点击，防误触进编辑。
              if (
                (e.target as HTMLElement).closest(
                  "button,input,[role='menuitem'],a,select,textarea",
                )
              )
                return;
              setEditing(true);
              setRevealed(true);
            }}
            onKeyDown={(e) => {
              // 焦点在内层按钮（eye/copy）时，Enter/Space 归内层处理
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setEditing(true);
                setRevealed(true);
              }
            }}
          >
            <span className="hub-api-key-mask-value font-mono">
              {revealed ? value : maskKey(value)}
            </span>
            <span className="hub-api-key-actions">
              <Button
                variant="ghost"
                size="icon"
                aria-label={
                  revealed
                    ? getString("hub-settings-key-hide")
                    : getString("hub-settings-key-show")
                }
                onClick={(e) => {
                  e.stopPropagation();
                  setRevealed((r) => !r);
                }}
              >
                {revealed ? (
                  <EyeOffIconSvgIfPresent size={ICON.base} />
                ) : (
                  <EyeIconSvgIfPresent size={ICON.base} />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={getString("hub-settings-key-copy")}
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopy();
                }}
              >
                {copied ? (
                  <CheckIconSvg size={ICON.base} />
                ) : (
                  <CopyIconSvg size={ICON.base} />
                )}
              </Button>
            </span>
          </div>
        ) : (
          <>
            <Input
              className="hub-api-key-input"
              type={inputType}
              value={draft}
              placeholder={placeholder}
              aria-label={label}
              spellCheck={false}
              autoComplete="off"
              readOnly={readOnly}
              onChange={(e) => {
                setDraft(e.target.value);
                if (!editing) setEditing(true);
              }}
              onFocus={() => setEditing(true)}
              onBlur={handleCommit}
              onKeyDown={(e) => {
                if (isIMEComposing(e)) return; // IME：合成期回车=确认候选词，非提交
                if (e.key === "Enter") {
                  (e.target as HTMLInputElement).blur();
                }
                if (e.key === "Escape" && editing) {
                  e.preventDefault();
                  setDraft(value);
                  setEditing(false);
                  (e.target as HTMLInputElement).blur();
                }
              }}
            />
            {isPassword && (
              <Button
                variant="ghost"
                size="icon"
                className="hub-api-key-toggle"
                aria-label={
                  revealed
                    ? getString("hub-settings-key-hide")
                    : getString("hub-settings-key-show")
                }
                onMouseDown={(e) => e.preventDefault()} // 防 input blur
                onClick={() => setRevealed((r) => !r)}
              >
                {revealed ? (
                  <EyeOffIconSvgIfPresent size={ICON.base} />
                ) : (
                  <EyeIconSvgIfPresent size={ICON.base} />
                )}
              </Button>
            )}
            {hasValue && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={getString("hub-settings-key-copy")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleCopy}
              >
                {copied ? (
                  <CheckIconSvg size={ICON.base} />
                ) : (
                  <CopyIconSvg size={ICON.base} />
                )}
              </Button>
            )}
            {saveState === "saved" && (
              <span className="hub-api-key-saved" role="status">
                <CheckIconSvg size={ICON.sm} />
                {getString("hub-settings-saved")}
              </span>
            )}
          </>
        )}
        {saveState === "saving" && (
          // UX-L13：saving 态此前从未渲染——复用 saved 反馈的样式槽位，
          // 在 input / mask 两种形态下都给出"保存中"可见指示。
          <span className="hub-api-key-saved" role="status" aria-live="polite">
            {getString("progress-saving")}
          </span>
        )}
      </div>

      {!isConfigured && !editing && (
        <span className="hub-api-key-empty">
          {getString("hub-settings-key-empty")}
        </span>
      )}
      {badAscii && (
        <span className="hub-api-key-warn">
          {getString("hub-settings-bad-ascii")}
        </span>
      )}
    </div>
  );
}
