import {
  cloneElement,
  forwardRef,
  type InputHTMLAttributes,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from "react";

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>;
  className?: string;
}

/** Wires a label, hint and error message to its control for screen readers. */
export function Field({ label, hint, error, children, className }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id: children.props.id ?? id,
        "aria-describedby": [hintId, errId].filter(Boolean).join(" ") || undefined,
        "aria-invalid": error ? true : undefined,
      })
    : children;
  return (
    <div className={["field", className].filter(Boolean).join(" ")}>
      <label className="field__label" htmlFor={children.props.id ?? id}>
        {label}
      </label>
      {control}
      {hint && !error && (
        <span className="field__hint" id={hintId}>
          {hint}
        </span>
      )}
      {error && (
        <span className="field__error" id={errId} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { size_?: "sm" }>(
  function Input({ className, size_, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={["input", size_ === "sm" && "input--sm", className].filter(Boolean).join(" ")}
        {...rest}
      />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...rest },
  ref,
) {
  return <select ref={ref} className={["select", className].filter(Boolean).join(" ")} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={["textarea", className].filter(Boolean).join(" ")} {...rest} />;
  },
);

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <label className="switch">
      <input
        id={id}
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch__track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; icon?: ReactNode }[];
  label: string;
}) {
  return (
    <fieldset className="segmented">
      <legend className="sr-only">{label}</legend>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </fieldset>
  );
}
