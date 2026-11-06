import { JOB_STATUS_LABEL, RUN_STATUS_LABEL, type JobStatus, type RunStatus } from "@/lib/automacao/types";

const JOB_CLS: Record<JobStatus, string> = {
  pending: "",
  running: "pill-info",
  waiting_sync: "pill-pending",
  done: "pill-approved",
  failed: "pill-refunded",
  skipped: "pill-canceled",
};

const RUN_CLS: Record<RunStatus, string> = {
  queued: "",
  running: "pill-info",
  done: "pill-approved",
  failed: "pill-refunded",
  canceled: "pill-canceled",
};

export function JobPill({ status }: { status: JobStatus }) {
  return <span className={`pill ${JOB_CLS[status] ?? ""} ${status === "running" ? "pill-live" : ""}`}>{JOB_STATUS_LABEL[status] ?? status}</span>;
}

export function RunPill({ status }: { status: RunStatus }) {
  return <span className={`pill ${RUN_CLS[status] ?? ""} ${status === "running" ? "pill-live" : ""}`}>{RUN_STATUS_LABEL[status] ?? status}</span>;
}
