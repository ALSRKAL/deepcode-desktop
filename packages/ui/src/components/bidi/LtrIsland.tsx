import type { CSSProperties, ReactNode } from "react";

/**
 * 双向文字隔离原语（docs/plan/01 §5.3）。
 *
 * - LtrIsland：编辑器、diff、终端、文件树路径、API 键、URL、模型 id、shell 命令
 *   等内容永远 LTR，即便整体界面是 RTL。unicode-bidi: isolate 保证方向不外泄。
 * - AutoDir：聊天正文等自然语言内容按首字符自动判向；代码块由外层强制 LTR。
 */

const ltrStyle: CSSProperties = {
  direction: "ltr",
  unicodeBidi: "isolate",
  textAlign: "left",
};

export function LtrIsland({
  children,
  className,
  style,
  as: Tag = "div",
  ...rest
}: {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  as?: "div" | "span" | "pre" | "code" | "kbd";
} & Omit<React.HTMLAttributes<HTMLElement>, "style" | "className" | "children">) {
  return (
    <Tag className={className} style={{ ...ltrStyle, ...style }} dir="ltr" {...rest}>
      {children}
    </Tag>
  );
}

export function AutoDir({
  children,
  className,
  as: Tag = "span",
  ...rest
}: {
  children?: ReactNode;
  className?: string;
  as?: "span" | "div" | "p";
} & Omit<React.HTMLAttributes<HTMLElement>, "className" | "children">) {
  return (
    <Tag className={className} dir="auto" {...rest}>
      {children}
    </Tag>
  );
}
