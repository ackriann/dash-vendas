"use client";
import { useRouter } from "next/navigation";
import MediaUploader from "@/components/automacao/MediaUploader";

export default function Uploader() {
  const router = useRouter();
  return <MediaUploader onUploaded={() => router.refresh()} />;
}
