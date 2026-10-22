"use client";
import { useFormStatus } from "react-dom";

export default function SubmitButton({
  children,
  pendingText,
  confirm,
  className = "btn",
  name,
  value,
}: {
  children: React.ReactNode;
  pendingText?: string;
  confirm?: string;
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      className={className}
      disabled={pending}
      name={name}
      value={value}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? pendingText ?? "Aguarde…" : children}
    </button>
  );
}
