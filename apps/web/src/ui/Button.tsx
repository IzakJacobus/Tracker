import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";

export type ButtonVariant = "default" | "primary" | "live" | "danger" | "ghost" | "soft";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  /** Icon-only button: `label` becomes the accessible name. */
  iconOnly?: boolean;
  label?: string;
  block?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "default",
    size = "md",
    icon,
    iconOnly,
    label,
    block,
    loading,
    className,
    children,
    type,
    disabled,
    ...rest
  },
  ref,
) {
  const cls = [
    "btn",
    variant !== "default" && `btn--${variant}`,
    size !== "md" && `btn--${size}`,
    iconOnly && "btn--icon",
    block && "btn--block",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cls}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : rest.title}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {icon}
      {!iconOnly && children}
    </button>
  );
});
